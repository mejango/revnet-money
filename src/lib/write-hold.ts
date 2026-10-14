"use client";

import { confirmHeldWriteExit } from "@/lib/flow-choice";
import type { ReviewedSafeProposal } from "@/lib/safe-transactions";
import {
  createWriteHold,
  WRITE_HOLD_REVERTED_LINE,
  WriteHeldError,
  type WriteHeldState,
  type WriteHoldClient,
  type WriteHoldGate,
  type WriteHoldHandle,
} from "@bananapus/nana-sdk-core/review";
import type { SafeQueuedTransaction } from "@bananapus/nana-sdk-core/safe-service";
import { keccak256, stringToHex, type Address, type Hex } from "viem";

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

/**
 * The holds this account saved by exact calldata, before writes were held by intent, for a call
 * of `selector` on `to`: an earlier attempt of an action now held by intent, with calldata a
 * retry no longer repeats. The SDK can't move a hold to another key without releasing it, so a
 * send under an intent asks each of these first, and only their own exits release them.
 */
export function exactCalldataHoldsOf(
  chainId: number,
  account: Address,
  to: Address,
  selector: Hex,
): WriteHoldHandle[] {
  // The SDK's key for a write held by its exact call: v2:chain:account:to:value:calldata hash.
  const prefix = `nana-sdk:reviewed-write:v2:${chainId}:${account}:${to}:`.toLowerCase();
  const holds: WriteHoldHandle[] = [];
  try {
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (!key || !key.toLowerCase().startsWith(prefix) || key.split(":").length !== 8) continue;
      const record = JSON.parse(localStorage.getItem(key) ?? "null") as {
        safe?: boolean;
        call?: { to: Address; data: Hex; value?: string };
      } | null;
      const call = record?.call;
      if (!call || call.data.slice(0, 10).toLowerCase() !== selector.toLowerCase()) continue;
      holds.push(
        writeHolds.open({
          chainId,
          account,
          safe: record.safe === true,
          call: { to: call.to, data: call.data, value: BigInt(call.value ?? 0) },
        }),
      );
    }
  } catch {
    // Storage refused: holds then live in this tab's memory, keyed as they were sent.
  }
  return holds;
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
const holdsByHash = new Map<string, { hold: WriteHoldHandle; client: WriteHoldClient }>();

/** Remember the hold `hash` was sent under. */
export function rememberHold(hash: Hex, hold: WriteHoldHandle, client: WriteHoldClient): void {
  holdsByHash.set(hash.toLowerCase(), { hold, client });
}

/** The hold `hash` was sent under in this tab, if any. */
export function holdOfHash(
  hash: Hex | undefined,
): { hold: WriteHoldHandle; client: WriteHoldClient } | undefined {
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
  if (state.status !== "clear") return state.line;
  return state.settled?.result === "failed" ? WRITE_HOLD_REVERTED_LINE : WENT_THROUGH;
}

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
      if (!(error instanceof WriteHeldError)) throw error;
      const shown = error.state;
      if (!shown.exit) throw new Error(shown.line);
      const { accepted, closedBy } = await askExit(hold, client, shown);
      if (closedBy) throw new Error(endedLine(closedBy));
      if (!accepted) throw new Error(shown.line);
      const { released, state } = await hold.exit(shown, { checkedWallet: true }, client);
      if (!released) throw new Error(endedLine(state));
    }
  }
}
