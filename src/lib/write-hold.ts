"use client";

import { confirmHeldWriteExit } from "@/lib/flow-choice";
import {
  createWriteHold,
  WRITE_HOLD_REVERTED_LINE,
  WriteHeldError,
  type WriteHeldState,
  type WriteHoldClient,
  type WriteHoldGate,
  type WriteHoldHandle,
} from "@bananapus/nana-sdk-core/review";
import type { Hex } from "viem";

/** The one write hold for every ordinary wallet write in this app. */
export const writeHolds = createWriteHold();

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
