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
  type WriteHeldState,
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

const PREFIX = "revnet:launch-salt:";
const accountPrefix = (account: string) => `${PREFIX}${account.toLowerCase()}:`;

/** Where the single-chain launch of `config` from `account` on `chainId` is journaled. */
export function launchKeyOf(account: string, chainId: number, config: unknown): string {
  return `${accountPrefix(account)}${chainId}:${launchConfigHash(config)}`;
}

/**
 * A single-chain launch the hold reserved for the wallet: its salt (the DeployRevnet event carries
 * it), the block it was sent after, the holds it is held by and the settlements they already showed
 * before it. The main-era build saved only the salt and the block.
 */
type SavedLaunch = {
  salt: Hex;
  fromBlock?: string;
  namespaces?: string[];
  before?: string[];
  /** The success a hold settled for it, journaled before anything about it was read. */
  settled?: { result: "success"; hash: Hex };
};

/** The launch journaled at `key`, if one is kept. */
export function savedLaunchAt(key: string): SavedLaunch | undefined {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return undefined;
    const saved = JSON.parse(raw) as SavedLaunch;
    return /^0x[0-9a-f]{64}$/i.test(saved?.salt ?? "") ? saved : undefined;
  } catch {
    return undefined;
  }
}

function persist(key: string, saved: SavedLaunch): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(saved));
  } catch {
    // Storage refused: the hold still carries the settlement this pass followed.
  }
}

/** Journal the attempt the hold just reserved for the wallet. */
export function saveLaunchAttempt(
  key: string,
  attempt: { salt: Hex; fromBlock?: bigint; namespaces: string[]; before: Hex[] },
): void {
  persist(key, {
    salt: attempt.salt,
    namespaces: attempt.namespaces,
    before: attempt.before,
    ...(attempt.fromBlock !== undefined ? { fromBlock: attempt.fromBlock.toString() } : {}),
  });
}

/**
 * The journaled launch is over: its settlement was shown, the hold proved it reverted or never
 * reached the wallet, or the user took its exit or checked it. The next launch is a new one.
 */
export function retireLaunch(key: string): void {
  try {
    window.localStorage.removeItem(key);
  } catch {
    // Nothing kept.
  }
}

/**
 * The user's check or exit releases the journaled launch, read again right here: a success any tab
 * journaled for it is never released (false), and is followed instead.
 */
export function releaseLaunch(key: string): boolean {
  if (savedLaunchAt(key)?.settled) return false;
  retireLaunch(key);
  return true;
}

/** The keys of every launch `account` has journaled, on any chain. */
export function savedLaunchKeys(account: string): string[] {
  try {
    return Object.keys(window.localStorage).filter((key) => key.startsWith(accountPrefix(account)));
  } catch {
    return [];
  }
}

/** The Center RPC's getLogs window, and the most blocks recovery scans for a saved launch. */
const SCAN_WINDOW = 500n;
const SCAN_RANGE = 50_000n;

/**
 * The revnet the saved launch's salt made: REVDeployer's DeployRevnet event from `account` with its
 * salt, scanned in 500-block windows from the block it was sent after, at most 50,000 blocks,
 * stopping at the first match. None found (a node may answer [] for a window with logs) is
 * undefined: it proves nothing.
 */
async function scanForLaunch(
  client: Pick<PublicClient, "getBlockNumber" | "getLogs">,
  chainId: number,
  account: string,
  saved: SavedLaunch & { fromBlock: string },
): Promise<bigint | undefined> {
  const deployer = deployerOf(chainId);
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
    if (match?.args.revnetId !== undefined) return match.args.revnetId;
  }
  return undefined;
}

const DEPLOY_REVNET = getAbiItem({ abi: revDeployerAbi, name: "DeployRevnet" });
const deployerOf = (chainId: number) =>
  getJBContractAddress(RevnetCoreContracts.REVDeployer, 6, chainId as JBChainId);

/** The namespaces a single-chain launch of `config` is held by: its SDK intent, then the main era's. */
export function launchNamespacesOf(chainId: number, account: Hex, config: unknown): string[] {
  return [
    launchIntent({ chainId, account, config: launchConfigOf(config) }),
    ...legacyIntents.launch(launchConfigHash(config)),
  ];
}

/** Every hold a launch held by `namespaces` can be held by, from either kind of wallet. */
export function launchHoldsOf(
  chainId: number,
  account: string,
  namespaces: readonly string[],
): WriteHoldHandle[] {
  const to = deployerOf(chainId);
  return [false, true].flatMap((safe) =>
    namespaces.map((namespace) =>
      writeHolds.open({
        chainId,
        account: account as Hex,
        safe,
        namespace,
        call: { to, data: "0x" },
      }),
    ),
  );
}

/** Every settlement `holds` show now: what a new attempt journals as already there before it. */
export function settlementsOf(holds: readonly Pick<WriteHoldHandle, "peek">[]): Hex[] {
  return holds.flatMap((hold) => {
    const now = hold.peek();
    return now.status === "clear" && now.settled && "hash" in now.settled ? [now.settled.hash] : [];
  });
}

/** How recovering a saved launch ended. */
export type LaunchRecovery =
  /** No launch is journaled: a new one may be prepared. */
  | { status: "none" }
  /** Its hold holds it: nothing is counted; `state` is what the hold's exit is offered on. */
  | { status: "held"; hold: WriteHoldHandle; state: WriteHeldState }
  /** The chain shows it launched this revnet: nothing is sent again. */
  | { status: "launched"; revnetId: bigint }
  /** It went through (`hash`), but its revnet can't be read yet: looked at again, never resent. */
  | { status: "confirming"; hash: Hex }
  /** What became of it can't be shown: the user checks it before anything is sent. */
  | { status: "check" }
  /** The hold proved it reverted at a final block: retired, a new one may be prepared. */
  | { status: "clear" };

type LaunchClient = Pick<PublicClient, "getBlockNumber" | "getLogs" | "getTransactionReceipt"> &
  WriteHoldClient;

/**
 * The one recovery rule for the launch journaled at `key`, run before anything else is prepared:
 * a hold that still holds it decides (asked of the chain first). A success a hold settled after it
 * was journaled always wins: it is journaled before anything about it is read, and from then on is
 * followed: its own DeployRevnet event with the saved salt names the revnet, and anything less (a
 * read that fails, empty logs, another salt) is `confirming`, never a check, discard or send. With no
 * hold record, the saved salt is scanned for; nothing found, no sent block, or any failure is
 * `check`. Only a shown settlement or a final revert retires it here; never throws.
 */
export async function recoverLaunch(
  key: string,
  account: string,
  client: LaunchClient,
  open: typeof launchHoldsOf = launchHoldsOf,
): Promise<LaunchRecovery> {
  const saved = savedLaunchAt(key);
  if (!saved) return { status: "none" };
  const [chainText, configHash] = key.slice(accountPrefix(account).length).split(":");
  const chainId = Number(chainText);
  /** Follows a success that went through: the revnet, or still confirming. */
  const follow = async (hash: Hex): Promise<LaunchRecovery> => {
    const revnetId = await launchOfTransaction(client, chainId, account, saved.salt, hash).catch(
      () => undefined,
    );
    if (revnetId === undefined) return { status: "confirming", hash };
    retireLaunch(key);
    return { status: "launched", revnetId };
  };
  if (saved.settled) return follow(saved.settled.hash);
  try {
    const namespaces = saved.namespaces ?? legacyIntents.launch(configHash as Hex);
    const before = new Set((saved.before ?? []).map((hash) => hash.toLowerCase()));
    let success: Hex | undefined;
    let reverted = false;
    for (const hold of open(chainId, account, namespaces)) {
      let now = hold.peek();
      if (now.status !== "clear") now = await hold.state(client).catch(() => now);
      if (now.status !== "clear") return { status: "held", hold, state: now };
      const settled = now.settled;
      if (!settled || !("hash" in settled) || before.has(settled.hash.toLowerCase())) continue;
      if (settled.result === "success") success ??= settled.hash;
      else reverted = true;
    }
    if (success) {
      // Journaled first: whatever the reads below say, this success is never discarded.
      persist(key, { ...saved, settled: { result: "success", hash: success } });
      return follow(success);
    }
    if (reverted) {
      retireLaunch(key);
      return { status: "clear" };
    }
    if (!saved.fromBlock || !/^\d+$/.test(saved.fromBlock)) return { status: "check" };
    const revnetId = await scanForLaunch(client, chainId, account, {
      ...saved,
      fromBlock: saved.fromBlock,
    });
    if (revnetId === undefined) return { status: "check" };
    retireLaunch(key);
    return { status: "launched", revnetId };
  } catch {
    return { status: "check" };
  }
}

/** The revnet `hash` launched for `account` with `salt`: its own DeployRevnet event, if found. */
async function launchOfTransaction(
  client: Pick<PublicClient, "getLogs" | "getTransactionReceipt">,
  chainId: number,
  account: string,
  salt: Hex,
  hash: Hex,
): Promise<bigint | undefined> {
  const receipt = await client.getTransactionReceipt({ hash });
  if (receipt.status !== "success") return undefined;
  const logs = await client.getLogs({
    address: deployerOf(chainId),
    event: DEPLOY_REVNET,
    blockHash: receipt.blockHash,
  });
  return logs.find(
    (log) =>
      !log.removed &&
      log.transactionHash?.toLowerCase() === hash.toLowerCase() &&
      sameLaunch(log.args, account, salt),
  )?.args.revnetId;
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
