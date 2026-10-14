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
  type WriteHeldState,
  type WriteHoldClient,
  type WriteHoldGate,
  type WriteHoldHandle,
  type WriteHoldState,
} from "@bananapus/nana-sdk-core/review";
import { encodeMultiSend, MULTI_SEND_CALL_ONLY } from "@bananapus/nana-sdk-core/safe";
import type { SafeQueuedTransaction } from "@bananapus/nana-sdk-core/safe-service";
import { type Address, type Hex } from "viem";

/** The one write hold for every ordinary wallet write in this app. */
export const writeHolds = createWriteHold();

/**
 * The hold of a Safe proposal, by what it was reviewed to run: one call, or a batch as the one
 * MultiSend call the Safe runs by DELEGATECALL (the SDK's batch identity). A proposal held by an
 * intent also answers for the exact-call holds an earlier build left: its call, and any call of
 * the same function on the same target.
 */
export function safeHoldOf(chainId: number, proposal: ReviewedSafeProposal): WriteHoldHandle {
  const [first] = proposal.calls;
  if (!first) throw new Error("A Safe proposal runs at least one call.");
  const call = proposal.batch
    ? {
        to: MULTI_SEND_CALL_ONLY,
        data: encodeMultiSend(
          proposal.calls.map((item) => ({ ...item, value: BigInt(item.value) })),
        ),
        value: 0n,
      }
    : { to: first.to, data: first.data, value: BigInt(first.value) };
  return writeHolds.open(
    {
      chainId,
      account: proposal.safe,
      safe: true,
      ...(proposal.holdNamespace ? { namespace: proposal.holdNamespace } : {}),
      call,
    },
    proposal.holdNamespace ? { legacy: legacyOf(call, proposal.legacyNamespaces) } : undefined,
  );
}

/**
 * The exact-call holds an earlier build left for a write now held by intent: its own call, and,
 * for an earlier attempt whose calldata a retry regenerates, any call of the same function on the
 * same target (the SDK's matcher).
 */
export function legacyOf(
  call: { to: Address; data: Hex; value?: bigint },
  namespaces: readonly string[] = [],
) {
  return [
    ...namespaces,
    { call },
    { match: { to: call.to, selector: call.data.slice(0, 10) as Hex } },
  ];
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
      if (now && !hidesShownExit(shown, now) && (now.status === "clear" || !now.exit)) {
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

/**
 * Whether `next` would hide the exit `shown` offers without the chain having been checked: a
 * contended answer (`checked: false`) or a replay. Only a checked answer hides it.
 */
export function hidesShownExit(
  shown: WriteHoldState | null | undefined,
  next: WriteHoldState,
): boolean {
  return (
    !!shown &&
    shown.status !== "clear" &&
    shown.exit &&
    next.status !== "clear" &&
    !next.exit &&
    next.checked !== true
  );
}

/**
 * Whether a hold's answer is one to show now: held, with its exit, and not exactly what `shown`
 * already offers. Every flow, direct or Safe, moves to it and keeps checking behind it.
 */
export function offersExit(
  shown: WriteHoldState | null | undefined,
  next: WriteHoldState,
): boolean {
  return next.status !== "clear" && next.exit && JSON.stringify(shown) !== JSON.stringify(next);
}

/** A held state's line, with the hold's notice when holds last only in this tab. */
export function withNotice(state: { line: string; notice?: string }): string {
  return state.notice ? `${state.line} ${state.notice}` : state.line;
}

/** The hash of the success a hold last settled, if any. */
export function settledSuccessOf(hold: Pick<WriteHoldHandle, "peek">): Hex | undefined {
  const now = hold.peek();
  return now.status === "clear" && now.settled?.result === "success"
    ? (now.settled.hash.toLowerCase() as Hex)
    : undefined;
}

/**
 * Sends under the hold. A call that is held shows the SDK's line: with no exit it ends the send;
 * with one, the flow asks the user. A send happens only after the user accepts the exit on a state
 * that is still held and `exit` reports it released. A hold the chain clears while the exit is open
 * ends the attempt without sending, and so does an earlier attempt the send's own check finds went
 * through: a success any of `watched` (the hold and the holds it answers for) settles after the
 * send began is never sent again.
 */
export async function sendUnderHold<T>(
  hold: WriteHoldHandle,
  client: WriteHoldClient,
  run: (gate: WriteHoldGate) => Promise<T>,
  watched: readonly Pick<WriteHoldHandle, "peek">[] = [hold],
): Promise<T> {
  const before = watched.map(settledSuccessOf);
  // Checked right before the hold reserves the wallet: the caller's own refusals come first.
  const unlessWentThrough = (gate: WriteHoldGate) =>
    run({
      ...gate,
      async beforeSend(actualCall) {
        if (watched.some((handle, i) => (settledSuccessOf(handle) ?? before[i]) !== before[i]))
          throw new Error(WENT_THROUGH);
        return gate.beforeSend(actualCall);
      },
    });
  for (;;) {
    try {
      return await hold.send(client, unlessWentThrough);
    } catch (error) {
      // Another window sent this write while its review was open: review it again.
      if (error instanceof WriteHoldStaleReviewError)
        throw new Error(error.settled ? settledLine(error.settled) : WRITE_HOLD_STALE_REVIEW_LINE);
      if (!(error instanceof WriteHeldError)) throw error;
      await takeHeldExit(hold, client, error.state);
    }
  }
}

/**
 * Offers the exit of a held write the user is shown, while the chain is asked again. Returns once
 * the user took it and the hold released the write; otherwise throws the line to show: the hold's
 * own (no exit due, declined, contended) or how the chain ended it meanwhile.
 */
export async function takeHeldExit(
  hold: WriteHoldHandle,
  client: WriteHoldClient,
  state: WriteHeldState,
): Promise<void> {
  const shown = state as WriteHeldState & { notice?: string };
  if (!shown.exit) throw new Error(withNotice(shown));
  const { accepted, closedBy } = await askExit(hold, client, shown);
  if (closedBy) throw new Error(endedLine(closedBy));
  if (!accepted) throw new Error(withNotice(shown));
  // The exit never waits: a contended answer keeps the exit the user saw, to take again.
  const ended = await hold.exit(shown, { checkedWallet: true }, client);
  if (!ended.released)
    throw new Error(
      hidesShownExit(shown, ended.state) ? withNotice(shown) : endedLine(ended.state),
    );
}

const INTENT = Symbol.for("revnet:write-intent");
const LEGACY = Symbol.for("revnet:write-intent-legacy");

/**
 * `write`, sending its variables held by `namespace`: the user action's intent, from one of the
 * SDK's builders (payIntent, cashOutIntent, loanIntent, borrowIntent, bridgeIntent,
 * approvalIntent, launchIntent, liquidityIntent), or writeIntentKey for an action they don't
 * cover. A retry of the action is held by its first attempt; the exact sent call stays in the
 * hold's record.
 */
export function withWriteIntent<F extends (variables: never, ...rest: never[]) => unknown>(
  write: F,
  namespace: string,
  /** The namespaces the build before SDK 2.38's builders held it by (legacy-intents.ts). */
  legacy: readonly string[] = [],
): F {
  return ((variables: object, ...rest: never[]) =>
    write(
      { ...variables, [INTENT]: namespace, [LEGACY]: legacy } as never,
      ...rest,
    )) as unknown as F;
}

/** The previous build's namespaces a write's caller named. REMOVE with legacy-intents.ts. */
export function legacyIntentsOf(write: object): readonly string[] {
  const named = (write as Record<symbol, unknown>)[LEGACY];
  return Array.isArray(named) ? named : [];
}

/** The intent a write's caller held it by, if any; a write without one is held by its call. */
export function writeIntentOf(write: object): string | undefined {
  const named = (write as Record<symbol, unknown>)[INTENT];
  return typeof named === "string" ? named : undefined;
}

/**
 * Approving or executing one queued Safe transaction: the Safe and its safeTxHash, never the
 * signatures collected so far. No SDK builder covers it yet, so it is the one app-side key.
 */
export function safeExecutionIntent(chainId: number, safe: Address, safeTxHash: Hex): string {
  return writeIntentKey("safe-execution", {
    chainId,
    safe: intent.address(safe),
    safeTxHash: intent.hex(safeTxHash),
  });
}
