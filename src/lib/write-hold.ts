"use client";

import { confirmHeldWriteExit } from "@/lib/flow-choice";
import {
  createWriteHold,
  WriteHeldError,
  type WriteHeldState,
  type WriteHoldClient,
  type WriteHoldGate,
  type WriteHoldHandle,
} from "@bananapus/nana-sdk-core/review";

/** The one write hold for every ordinary wallet write in this app. */
export const writeHolds = createWriteHold();

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
      const now = await hold.state(client).catch(() => null);
      if (now && !open.signal.aborted && (now.status === "clear" || !now.exit)) {
        closedBy = now;
        open.abort();
      }
    }
  })();
  try {
    return { accepted: await confirmHeldWriteExit(shown, open.signal), closedBy };
  } finally {
    open.abort();
    await recheck;
  }
}

/**
 * Sends under the hold. A call that is held shows the SDK's line: with no exit it ends the send;
 * with one, the flow asks the user, and a release sends again. Every exit names the state the
 * user saw.
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
      if (closedBy) {
        if (closedBy.status === "clear") {
          if (closedBy.settled?.result === "success") throw new Error(WENT_THROUGH);
          continue;
        }
        throw new Error(closedBy.line);
      }
      if (!accepted) throw new Error(shown.line);
      const { released, state } = await hold.exit(shown, { checkedWallet: true }, client);
      if (released) continue;
      if (state.status !== "clear") throw new Error(state.line);
      if (state.settled?.result === "success") throw new Error(WENT_THROUGH);
    }
  }
}
