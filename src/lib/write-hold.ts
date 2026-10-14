"use client";

import { confirmHeldWriteExit } from "@/lib/flow-choice";
import type { ReviewedSafeProposal } from "@/lib/safe-transactions";
import {
  createWriteHold,
  intent,
  WRITE_HOLD_REVERTED_LINE,
  WRITE_HOLD_STALE_REVIEW_LINE,
  WriteHeldError,
  WriteHoldStaleReviewError,
  writeIntentKey,
  type IntentValue,
  type WriteHeldState,
  type WriteHoldClient,
  type WriteHoldGate,
  type WriteHoldHandle,
} from "@bananapus/nana-sdk-core/review";
import type { SafeQueuedTransaction } from "@bananapus/nana-sdk-core/safe-service";
import {
  decodeAbiParameters,
  encodeFunctionData,
  keccak256,
  stringToHex,
  type Abi,
  type Address,
  type Hex,
} from "viem";

/** The one write hold for every ordinary wallet write in this app. */
export const writeHolds = createWriteHold();

/**
 * The hold of a Safe proposal, by what it was reviewed to run: one call, or a batch, held by its
 * first call within the batch's own scope.
 */
export function safeHoldOf(chainId: number, proposal: ReviewedSafeProposal): WriteHoldHandle {
  const [first] = proposal.calls;
  if (!first) throw new Error("A Safe proposal runs at least one call.");
  const batch = proposal.calls.map((call) => `${call.to}:${BigInt(call.value)}:${call.data}`);
  return writeHolds.open({
    chainId,
    account: proposal.safe,
    safe: true,
    ...(proposal.holdNamespace
      ? { namespace: proposal.holdNamespace }
      : proposal.batch
        ? { namespace: `batch:${keccak256(stringToHex(batch.join("|"))).slice(2)}` }
        : {}),
    call: { to: first.to, data: first.data, value: BigInt(first.value) },
  });
}

/**
 * Gives the hold a write the app's own journal saved with `hash`: a proposal saved before the hold
 * held it, or a lost wallet reply the user recovered for this exact call. A Safe proposal's
 * `proposal` (the transaction it hashes to) carries its nonce. A hold that holds an ordinary write
 * with no hash attaches the hash under its lock, once the chain authenticates it as this attempt;
 * one it refuses keeps its explicit exit. A hold that holds anything else, or already settled
 * this hash, keeps it. True once the hold holds or settled the call.
 */
export async function adoptIntoHold(
  hold: WriteHoldHandle,
  client: WriteHoldClient,
  hash: Hex,
  proposal?: SafeQueuedTransaction,
): Promise<boolean> {
  const now = hold.peek();
  if (now.status === "held-no-hash") {
    if (!now.record.safe) await hold.attachHash(client, hash).catch(() => undefined);
    return true;
  }
  if (
    now.status !== "clear" ||
    (now.settled && "hash" in now.settled && now.settled.hash.toLowerCase() === hash.toLowerCase())
  )
    return true;
  try {
    await hold.send(client, async (gate) => {
      await gate.beforeSend();
      gate.afterSubmit(hash, proposal);
    });
    return true;
  } catch {
    return hold.peek().status !== "clear";
  }
}

/** Whether the hold holds `hash` for its call, or settled it. */
export function holdsHash(hold: WriteHoldHandle, hash: Hex): boolean {
  const now = hold.peek();
  const named = now.status === "clear" ? now.settled : now.record;
  return !!named && "hash" in named && named.hash?.toLowerCase() === hash.toLowerCase();
}

/**
 * The hold each hash this tab sent was sent under, with the client it was sent through, so a
 * screen that shows the hash can watch it.
 */
const holdsByHash = new Map<
  string,
  { hold: WriteHoldHandle; client: WriteHoldClient; reservation?: string }
>();

/** Remember the hold `hash` was sent under. */
export function rememberHold(hash: Hex, hold: WriteHoldHandle, client: WriteHoldClient): void {
  // The reservation the send made: an observer of this hash ignores any other one's states.
  holdsByHash.set(hash.toLowerCase(), { hold, client, reservation: hold.peek().reservation });
}

/** The hold `hash` was sent under in this tab, if any. */
export function holdOfHash(
  hash: Hex | undefined,
): { hold: WriteHoldHandle; client: WriteHoldClient; reservation?: string } | undefined {
  return hash ? holdsByHash.get(hash.toLowerCase()) : undefined;
}

/** The held write confirmed while the user was deciding: nothing is sent again. */
export const WENT_THROUGH = "Your earlier transaction went through.";
/** How often an open exit asks the chain again, so a confirmation closes it. */
const HELD_RECHECK_MS = 3_000;

/**
 * Asks the exit while the chain is asked again: a confirmation closes it. Returns the state the
 * user's answer was given on, or the state that closed it.
 */
async function askExit(
  hold: WriteHoldHandle,
  client: WriteHoldClient,
  shown: WriteHeldState,
): Promise<{ accepted: boolean; closedBy?: Awaited<ReturnType<WriteHoldHandle["state"]>> }> {
  const open = new AbortController();
  let closedBy: Awaited<ReturnType<WriteHoldHandle["state"]>> | undefined;
  const recheck = (async () => {
    while (!open.signal.aborted) {
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, HELD_RECHECK_MS);
        open.signal.addEventListener("abort", () => (clearTimeout(timer), resolve()), {
          once: true,
        });
      });
      if (open.signal.aborted) return;
      // A poll in flight when the user answers is still kept: a settlement it returns decides.
      const now = await hold.state(client).catch(() => null);
      if (now && (now.status === "clear" || !now.exit)) {
        closedBy ??= now;
        open.abort();
      }
    }
  })();
  let accepted = false;
  try {
    accepted = await confirmHeldWriteExit(shown, open.signal);
  } finally {
    open.abort();
    await recheck;
  }
  return { accepted, closedBy };
}

/** The line for a hold the chain ended while the exit was open, or the state that closed it. */
function endedLine(state: Awaited<ReturnType<WriteHoldHandle["state"]>>): string {
  if (state.status !== "clear") return withNotice(state);
  return settledLine(state.settled);
}

/** The line for a write another attempt settled. */
function settledLine(settled: { result: string } | undefined): string {
  return settled?.result === "failed" ? WRITE_HOLD_REVERTED_LINE : WENT_THROUGH;
}

/** A held state's line, with the hold's notice when holds last only in this tab. */
function withNotice(state: { line: string; notice?: string }): string {
  return state.notice ? `${state.line} ${state.notice}` : state.line;
}

/** How long a contended exit waits between asks, and how many it makes. */
const EXIT_RETRY_MS = 250;
const EXIT_TRIES = 8;

/**
 * Sends under the hold. A call that is held shows the SDK's line: with no exit it ends the send;
 * with one, the flow asks the user. A send happens only after the user accepts the exit on a state
 * that is still held and `exit` reports it released. A hold the chain clears while the exit is open
 * ends the attempt without sending.
 */
export async function sendUnderHold<T>(
  hold: WriteHoldHandle,
  client: WriteHoldClient,
  run: (gate: WriteHoldGate) => Promise<T>,
): Promise<T> {
  for (;;) {
    try {
      return await hold.send(client, run);
    } catch (error) {
      // Another window sent this write while its review was open: review it again.
      if (error instanceof WriteHoldStaleReviewError)
        throw new Error(error.settled ? settledLine(error.settled) : WRITE_HOLD_STALE_REVIEW_LINE);
      if (!(error instanceof WriteHeldError)) throw error;
      const shown = error.state as WriteHeldState & { notice?: string };
      if (!shown.exit) throw new Error(withNotice(shown));
      const { accepted, closedBy } = await askExit(hold, client, shown);
      if (closedBy) throw new Error(endedLine(closedBy));
      if (!accepted) throw new Error(withNotice(shown));
      // The exit never waits: on contention it answers with the state as it is, asked again.
      let ended = await hold.exit(shown, { checkedWallet: true }, client);
      for (
        let tries = 1;
        !ended.released &&
        tries < EXIT_TRIES &&
        ended.state.status === shown.status &&
        "exit" in ended.state &&
        ended.state.exit;
        tries += 1
      ) {
        await new Promise((resolve) => setTimeout(resolve, EXIT_RETRY_MS));
        ended = await hold.exit(shown, { checkedWallet: true }, client);
      }
      if (!ended.released) throw new Error(endedLine(ended.state));
    }
  }
}

/**
 * A write's intent: what the user asked for, without the fields a retry stamps again (a deadline,
 * a Permit2 expiration, collected signatures, a quoted minimum). The write hold is keyed by the
 * SDK's writeIntentKey of it, so a retry of the same action finds the attempt it may repeat and
 * asks for that hold's exit; the exact sent call stays in the hold's record.
 */
const INTENT = Symbol.for("revnet:write-intent");

/**
 * `write`, sending its variables named by the user's intent: `action` and the parameters the user
 * chose (addresses and hex tagged with the SDK's `intent`, amounts as bigint), with no field a
 * retry stamps again.
 */
export function withWriteIntent<F extends (variables: never, ...rest: never[]) => unknown>(
  write: F,
  action: string,
  params: { readonly [name: string]: IntentValue | undefined },
): F {
  const namespace = writeIntentKey(action, params);
  return ((variables: object, ...rest: never[]) =>
    write({ ...variables, [INTENT]: namespace } as never, ...rest)) as unknown as F;
}

/** A decoded ABI value as an intent value: addresses and bytes tagged, numbers kept. */
function abiIntent(value: unknown): IntentValue {
  if (typeof value === "string")
    return /^0x[0-9a-fA-F]{40}$/.test(value)
      ? intent.address(value)
      : /^0x[0-9a-fA-F]*$/.test(value)
        ? intent.hex(value)
        : value;
  if (typeof value === "bigint" || typeof value === "number" || typeof value === "boolean")
    return value;
  if (Array.isArray(value)) return value.map(abiIntent);
  if (value && typeof value === "object")
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, abiIntent(item)]));
  return null;
}

/** Uniswap v4 position actions whose params lead with the position's tokenId. */
const ON_TOKEN = new Set([0x00, 0x01, 0x03, 0x04]);
/** Uniswap v4 mints, whose params lead with the pool key. */
const MINTS = new Set([0x02, 0x05]);
const POOL_KEY = [
  {
    type: "tuple",
    components: [
      { type: "address" },
      { type: "address" },
      { type: "uint24" },
      { type: "int24" },
      { type: "address" },
    ],
  },
] as const;

/**
 * What a `modifyLiquidities` write acts on: the positions (tokenIds) it touches and the pools it
 * mints in, each once, in order. The actions themselves are left out, with their counts, amounts,
 * limits, a mint's range and the settlement actions: the app generates them from the live price
 * (an increase at one price is a decrease at another, a market mints more positions at a corridor
 * edge). An unlockData that can't be read is one write on the whole position manager.
 */
function liquidityTargets(unlockData: unknown): IntentValue {
  try {
    const [actions, params] = decodeAbiParameters(
      [{ type: "bytes" }, { type: "bytes[]" }],
      unlockData as Hex,
    );
    const codes = actions.slice(2).match(/../g) ?? [];
    if (codes.length !== params.length) return "unread";
    const positions = new Set<string>();
    const pools = new Set<string>();
    codes.forEach((hex, index) => {
      const code = parseInt(hex, 16);
      const param = params[index]!;
      if (ON_TOKEN.has(code))
        positions.add(decodeAbiParameters([{ type: "uint256" }], param)[0].toString());
      else if (MINTS.has(code))
        pools.add(JSON.stringify(abiIntent(decodeAbiParameters(POOL_KEY, param)[0])));
    });
    return {
      positions: [...positions].sort().map((id) => BigInt(id)),
      pools: [...pools].sort(),
    };
  } catch {
    return "unread";
  }
}

type Write = {
  address?: Address;
  functionName?: unknown;
  args?: readonly unknown[];
};

/**
 * The intent a write is held by: the one its caller named, or one these calls always carry, whose
 * calldata a retry stamps again. Undefined for a write held by its exact call.
 *
 * - Permit2 `approve(token, spender, amount, expiration)`: the expiration is stamped at send time.
 * - Uniswap v4 `modifyLiquidities(unlockData, deadline)`: the deadline is stamped at send time,
 *   and a reviewed plan's quoted limits change with a fresh review.
 * - Safe `execTransaction(…, signatures)`: the collected signatures grow between attempts.
 */
export function writeIntentOf(write: Write): string | undefined {
  const named = (write as Record<symbol, unknown>)[INTENT];
  if (typeof named === "string") return named;
  const to = write.address ? intent.address(write.address) : null;
  const args = write.args ?? [];
  // One approval per token and spender: its amount may be calculated (a flow's max, a funding
  // amount) and change on a retry.
  if (write.functionName === "approve" && args.length === 2)
    return writeIntentKey("approve", { to, spender: abiIntent(args[0]) });
  // One Permit2 approval per token and spender: its amount may come from a quote.
  if (write.functionName === "approve" && args.length === 4)
    return writeIntentKey("permit2-approve", {
      to,
      token: abiIntent(args[0]),
      spender: abiIntent(args[1]),
    });
  if (write.functionName === "modifyLiquidities")
    return writeIntentKey("lp", { to, targets: liquidityTargets(args[0]) });
  if (write.functionName === "execTransaction" && args.length === 10)
    return writeIntentKey("safe-exec", { to, transaction: abiIntent(args.slice(0, 9)) });
  return undefined;
}

/** The intent of a Safe batch: each call's own intent, or its exact call. */
export function batchIntentOf(calls: readonly (Write & { abi: Abi; value?: bigint })[]): string {
  return writeIntentKey("batch", {
    calls: calls.map(
      (call) =>
        writeIntentOf(call) ?? {
          to: call.address ? intent.address(call.address) : null,
          value: call.value ?? 0n,
          data: intent.hex(
            encodeFunctionData({
              abi: call.abi,
              functionName: call.functionName as string,
              args: call.args as unknown[],
            }),
          ),
        },
    ),
  });
}

/**
 * A payment's intent: the project and the beneficiary alone. Every payment to a project, a checkout
 * or an ordinary pay, shares it: inventory can empty a cart into a pay, the app picks the route,
 * the token may fall back, and the amount and memo follow what the form shows. While one payment
 * to a project is unresolved, another to it from the same account asks for that one's exit.
 */
export function payIntent(payment: {
  projectId: number | bigint;
  beneficiary: string;
  /** Not part of the intent; a checkout's cart, accepted so callers needn't strip it. */
  items?: readonly unknown[];
}): [string, { [name: string]: IntentValue }] {
  return [
    "pay",
    { projectId: BigInt(payment.projectId), beneficiary: intent.address(payment.beneficiary) },
  ];
}

/** A collateral reallocation's intent: its loan alone, as a repay's is. */
export function reallocateIntent(reallocation: {
  loanId: string | number | bigint;
}): [string, { [name: string]: IntentValue }] {
  return ["reallocate", { loanId: BigInt(reallocation.loanId) }];
}

/** A sucker sync's intent: the sucker alone, never the bridge fee it pays. */
export function syncIntent(sucker: string): [string, { [name: string]: IntentValue }] {
  return ["sucker-sync", { sucker: intent.address(sucker) }];
}

/**
 * Typed decimal text as one canonical key: no leading or trailing zeros ("010.50" is "10.5").
 * Text that isn't a decimal is kept as typed.
 */
export function decimalKey(text: string): string {
  const match = /^\s*(\d*)(?:\.(\d*))?\s*$/.exec(text);
  if (!match || (!match[1] && !match[2])) return text;
  const whole = match[1]!.replace(/^0+(?=\d)/, "") || "0";
  const fraction = (match[2] ?? "").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole;
}

/**
 * A cash out's intent: its project, the token reclaimed, the typed amount and the beneficiary.
 * The venue the app picks (a pool sale or a terminal cash out) is never in it.
 */
export function cashOutIntent(cashOut: {
  projectId: number | bigint;
  token: string;
  /** As the user chose it: its parsed value if typed, else its option or seed (useChosen). */
  amount: IntentValue;
  beneficiary: string;
}): [string, { [name: string]: IntentValue }] {
  return [
    "cash-out",
    {
      projectId: BigInt(cashOut.projectId),
      token: intent.address(cashOut.token),
      amount: cashOut.amount,
      beneficiary: intent.address(cashOut.beneficiary),
    },
  ];
}

/**
 * A repay's intent: its loan alone. The collateral returned and the ceiling paid follow the
 * loan's accrual and the form's provenance, so neither is in it; a different repay of the same
 * loan waits for the unresolved one.
 */
export function repayIntent(
  loanId: string | number | bigint,
): [string, { [name: string]: IntentValue }] {
  return ["repay", { loanId: BigInt(loanId) }];
}
