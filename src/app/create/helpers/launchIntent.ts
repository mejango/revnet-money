import { legacyIntents } from "@/lib/legacy-intents";
import { writeHolds } from "@/lib/write-hold";
import {
  getJBContractAddress,
  revDeployerAbi,
  RevnetCoreContracts,
  type JBChainId,
} from "@bananapus/nana-sdk-core";
import {
  intent,
  launchIntent,
  type IntentValue,
  type WriteHoldClient,
  type WriteHoldHandle,
} from "@bananapus/nana-sdk-core/review";
import { getAbiItem, keccak256, stringToHex, type Hex, type PublicClient } from "viem";

/** The user's launch config as stable text: object keys sorted, bigints in decimal. */
function canonical(config: unknown): string {
  return JSON.stringify(config, (_key, item: unknown) => {
    if (typeof item === "bigint") return item.toString();
    if (item && typeof item === "object" && !Array.isArray(item))
      return Object.fromEntries(
        Object.entries(item as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : 1)),
      );
    return item;
  });
}

/** The hash of the user's launch config, as stable text. */
export function launchConfigHash(config: unknown): Hex {
  return keccak256(stringToHex(canonical(config)));
}

/**
 * The launch input every launch key is built from: the form exactly as the user submitted it,
 * copied, so metadata the page refreshes later (a token's symbol) never changes the intent, the
 * salt or the saved-launch lookup.
 */
export function launchInputOf<T>(form: T): T {
  try {
    return structuredClone(form);
  } catch {
    // A value structuredClone can't copy: a plain copy of its data, which is all a key reads.
    return JSON.parse(
      JSON.stringify(form, (_key, item: unknown) =>
        typeof item === "bigint" ? item.toString() : item,
      ),
    ) as T;
  }
}

/**
 * The launch input as the SDK's launchIntent reads it: addresses and bytes tagged, numbers that
 * aren't whole as text, undefined fields left out. What the page generates for each attempt (the
 * salt, the default stage start, the metadata pin) is never in it.
 */
export function launchConfigOf(input: unknown): IntentValue {
  if (typeof input === "string")
    return /^0x[0-9a-fA-F]{40}$/.test(input)
      ? intent.address(input)
      : /^0x([0-9a-fA-F]{2})*$/.test(input)
        ? intent.hex(input)
        : input;
  if (typeof input === "number") return Number.isSafeInteger(input) ? input : String(input);
  if (typeof input === "bigint" || typeof input === "boolean" || input === null) return input;
  if (Array.isArray(input)) return input.map((item) => launchConfigOf(item ?? null));
  if (input && typeof input === "object")
    return Object.fromEntries(
      Object.entries(input)
        .filter(([, item]) => item !== undefined && typeof item !== "function")
        .map(([key, item]) => [key, launchConfigOf(item)]),
    );
  return null;
}

const saltKey = (account: string, chainId: number, config: unknown) =>
  `revnet:launch-salt:${account.toLowerCase()}:${chainId}:${launchConfigHash(config)}`;

/** A single-chain launch saved before it confirmed: its salt and the block it was sent after. */
type SavedLaunch = { salt: Hex; fromBlock?: string };

/** The saved launch of `config` from `account` on `chainId`, if one is kept. */
export function savedLaunchOf(
  account: string,
  chainId: number,
  config: unknown,
): SavedLaunch | undefined {
  return savedAt(saltKey(account, chainId, config));
}

function savedAt(key: string): SavedLaunch | undefined {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return undefined;
    const saved = JSON.parse(raw) as SavedLaunch;
    return /^0x[0-9a-f]{64}$/i.test(saved?.salt ?? "") ? saved : undefined;
  } catch {
    return undefined;
  }
}

function saveLaunch(account: string, chainId: number, config: unknown, saved: SavedLaunch) {
  try {
    window.localStorage.setItem(saltKey(account, chainId, config), JSON.stringify(saved));
  } catch {
    // Storage refused: the write hold, in this tab's memory, still holds the attempt.
  }
}

/**
 * The salt for launching `config` from `account` on `chainId`: the one an earlier, unsettled
 * attempt used, kept across retries and reloads, else a new one. It names that attempt on chain
 * (the DeployRevnet event carries it), so a reload can find a launch whose reply was lost. It does
 * not make the chain refuse a retry: the stage starts are fresh, and so is the configuration's
 * hash. The write hold, keyed by the config, is what stops a second launch.
 */
export function launchSalt(
  account: string,
  chainId: number,
  config: unknown,
  create: () => Hex,
): Hex {
  const saved = savedLaunchOf(account, chainId, config);
  if (saved) return saved.salt;
  const salt = create();
  saveLaunch(account, chainId, config, { salt });
  return salt;
}

/** The launch is about to be sent: the first block its DeployRevnet event can be in. */
export function noteLaunchSent(
  account: string,
  chainId: number,
  config: unknown,
  fromBlock: bigint,
): void {
  const saved = savedLaunchOf(account, chainId, config);
  if (saved && saved.fromBlock === undefined)
    saveLaunch(account, chainId, config, { ...saved, fromBlock: fromBlock.toString() });
}

/**
 * The saved launch is done: it confirmed, nothing of it reached the wallet, or the user checked it
 * and chose to launch again. The next launch of the same config is a new one, with a new salt.
 */
export function settleLaunchSalt(account: string, chainId: number, config: unknown): void {
  removeSaved(saltKey(account, chainId, config));
}

function removeSaved(key: string): void {
  try {
    window.localStorage.removeItem(key);
  } catch {
    // Nothing kept.
  }
}

/** The Center RPC's getLogs window, and the most blocks a reload scans for a saved launch. */
const SCAN_WINDOW = 500n;
const SCAN_RANGE = 50_000n;

/**
 * Whether the saved launch of `config` already happened: REVDeployer's DeployRevnet event from
 * `account` with its salt, scanned in 500-block windows from the block it was sent after, at most
 * 50,000 blocks, stopping at the first match. A match clears the salt and names the revnet. A scan
 * that finds none, or fails, proves nothing (a node may answer [] for a window with logs): the salt
 * stays for a retry. It never releases the write hold; only the SDK's evidence or the user's exit
 * does.
 */
export async function checkSavedLaunch(
  client: Pick<PublicClient, "getBlockNumber" | "getLogs">,
  chainId: number,
  account: string,
  config: unknown,
): Promise<{ launched: bigint | "unknown" }> {
  return checkSavedAt(client, chainId, account, saltKey(account, chainId, config));
}

/**
 * The account's saved launches, from any config: the first one a scan finds already launched,
 * with its chain. Reads each saved launch's own chain; a launch it can't find stays saved.
 */
export async function checkSavedLaunches(
  clientFor: (chainId: number) => Pick<PublicClient, "getBlockNumber" | "getLogs"> | undefined,
  account: string,
): Promise<{ chainId: number; revnetId: bigint } | undefined> {
  const prefix = `revnet:launch-salt:${account.toLowerCase()}:`;
  let keys: string[] = [];
  try {
    keys = Object.keys(window.localStorage).filter((key) => key.startsWith(prefix));
  } catch {
    return undefined;
  }
  for (const key of keys) {
    const chainId = Number(key.slice(prefix.length).split(":")[0]);
    const client = Number.isSafeInteger(chainId) ? clientFor(chainId) : undefined;
    if (!client) continue;
    const { launched } = await checkSavedAt(client, chainId, account, key);
    if (launched !== "unknown") return { chainId, revnetId: launched };
  }
  return undefined;
}

async function checkSavedAt(
  client: Pick<PublicClient, "getBlockNumber" | "getLogs">,
  chainId: number,
  account: string,
  key: string,
): Promise<{ launched: bigint | "unknown" }> {
  const saved = savedAt(key);
  if (!saved?.fromBlock || !/^\d+$/.test(saved.fromBlock)) return { launched: "unknown" };
  try {
    const deployer = getJBContractAddress(RevnetCoreContracts.REVDeployer, 6, chainId as JBChainId);
    const head = await client.getBlockNumber();
    const start = BigInt(saved.fromBlock);
    const end = head - start + 1n > SCAN_RANGE ? start + SCAN_RANGE - 1n : head;
    for (let from = start; from <= end; from += SCAN_WINDOW) {
      const to = from + SCAN_WINDOW - 1n > end ? end : from + SCAN_WINDOW - 1n;
      const logs = await client.getLogs({
        address: deployer,
        event: DEPLOY_REVNET,
        fromBlock: from,
        toBlock: to,
      });
      const match = logs.find((log) => !log.removed && sameLaunch(log.args, account, saved.salt));
      if (match?.args.revnetId !== undefined) {
        removeSaved(key);
        return { launched: match.args.revnetId };
      }
    }
  } catch {
    // A chain read that fails is unknown.
  }
  return { launched: "unknown" };
}

const DEPLOY_REVNET = getAbiItem({ abi: revDeployerAbi, name: "DeployRevnet" });

/**
 * Every hold a single-chain launch of `config` can be held by, from either kind of wallet: its SDK
 * intent, and the namespace the build before SDK 2.38's builders held it by.
 */
export function launchHoldsOf(chainId: number, account: Hex, config: unknown): WriteHoldHandle[] {
  const namespaces = [
    launchIntent({ chainId, account, config: launchConfigOf(config) }),
    ...legacyIntents.launch(launchConfigHash(config)),
  ];
  const to = getJBContractAddress(RevnetCoreContracts.REVDeployer, 6, chainId as JBChainId);
  return [false, true].flatMap((safe) =>
    namespaces.map((namespace) =>
      writeHolds.open({ chainId, account, safe, namespace, call: { to, data: "0x" } }),
    ),
  );
}

/** How recovering a saved launch ended. */
export type LaunchRecovery =
  /** Its hold holds it: nothing is counted, and only the hold's exit sends again. */
  | { status: "held" }
  /** The chain shows it launched this revnet: nothing is sent again. */
  | { status: "launched"; revnetId: bigint }
  /** Whether it launched can't be shown: the user checks before anything is sent. */
  | { status: "check" }
  /** Nothing of it can have launched: the launch may be sent. */
  | { status: "clear" };

/**
 * The one recovery rule for a saved single-chain launch, before anything is sent. A hold that holds
 * it decides (`held`). A success a hold settled is reconciled against its exact transaction: its
 * DeployRevnet event with the saved salt names the revnet. With no hold record, the saved salt is
 * scanned for. A settled transaction that can't be read, or a scan that finds nothing or fails,
 * is `check`: never a send. `scan: false` (after a send failed) never scans, and `ignore` is the
 * settlement already there before that send.
 */
export async function recoverSavedLaunch(
  holds: readonly Pick<WriteHoldHandle, "peek" | "state">[],
  client: Pick<PublicClient, "getBlockNumber" | "getLogs" | "getTransactionReceipt"> &
    WriteHoldClient,
  chainId: number,
  account: string,
  config: unknown,
  { scan = true, ignore }: { scan?: boolean; ignore?: Hex } = {},
): Promise<LaunchRecovery> {
  const saved = savedLaunchOf(account, chainId, config);
  if (!saved) return { status: "clear" };
  let settled: Hex | undefined;
  let reverted = false;
  for (const hold of holds) {
    let now = hold.peek();
    // A held attempt is asked of the chain first: one that went through settles here.
    if (now.status !== "clear") now = await hold.state(client).catch(() => now);
    if (now.status !== "clear") return { status: "held" };
    if (now.settled?.result === "failed") reverted = true;
    if (
      now.settled?.result === "success" &&
      now.settled.hash.toLowerCase() !== ignore?.toLowerCase()
    )
      settled ??= now.settled.hash;
  }
  if (settled) {
    try {
      const receipt = await client.getTransactionReceipt({ hash: settled });
      const logs =
        receipt.status === "success"
          ? await client.getLogs({
              address: getJBContractAddress(
                RevnetCoreContracts.REVDeployer,
                6,
                chainId as JBChainId,
              ),
              event: DEPLOY_REVNET,
              blockHash: receipt.blockHash,
            })
          : [];
      const revnetId = logs.find(
        (log) =>
          !log.removed &&
          log.transactionHash?.toLowerCase() === settled.toLowerCase() &&
          sameLaunch(log.args, account, saved.salt),
      )?.args.revnetId;
      if (revnetId !== undefined) {
        settleLaunchSalt(account, chainId, config);
        return { status: "launched", revnetId };
      }
      // Its transaction launched with another salt: an earlier launch, already shown.
    } catch {
      return { status: "check" };
    }
  }
  // Its last attempt reverted (final), or nothing of it was ever sent or reached the wallet.
  if (reverted || !scan || !saved.fromBlock) return { status: "clear" };
  const { launched } = await checkSavedLaunch(client, chainId, account, config);
  return launched === "unknown" ? { status: "check" } : { status: "launched", revnetId: launched };
}

/** Whether a DeployRevnet event's arguments are `account`'s launch with `salt`. */
function sameLaunch(
  args: { caller?: string; configuration?: { description: { salt?: string } } },
  account: string,
  salt: Hex,
): boolean {
  return (
    args.caller?.toLowerCase() === account.toLowerCase() &&
    args.configuration?.description.salt?.toLowerCase() === salt.toLowerCase()
  );
}
