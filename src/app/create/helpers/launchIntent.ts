import {
  getJBContractAddress,
  revDeployerAbi,
  RevnetCoreContracts,
  type JBChainId,
} from "@bananapus/nana-sdk-core";
import { intent, type IntentValue } from "@bananapus/nana-sdk-core/review";
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
 * A single-chain launch's intent: a hash of the launch config the user filled in. What the page
 * generates for each attempt (the salt, the default stage start, the metadata pin) is left out;
 * the chain and account are the hold's own scope.
 */
export function launchIntent(config: unknown): [string, { [name: string]: IntentValue }] {
  return ["launch", { config: intent.hex(keccak256(stringToHex(canonical(config)))) }];
}

const saltKey = (account: string, chainId: number, config: unknown) =>
  `revnet:launch-salt:${account.toLowerCase()}:${chainId}:${keccak256(stringToHex(canonical(config)))}`;

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

/** The launch confirmed: the next launch of the same config is a new one, with a new salt. */
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
      const match = logs.find(
        (log) =>
          !log.removed &&
          log.args.caller?.toLowerCase() === account.toLowerCase() &&
          log.args.configuration?.description.salt?.toLowerCase() === saved.salt.toLowerCase(),
      );
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
