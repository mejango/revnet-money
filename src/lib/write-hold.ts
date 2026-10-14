"use client";

import { confirmHeldWriteExit, confirmSendAgain } from "@/lib/flow-choice";
import type { ReviewedSafeProposal } from "@/lib/safe-transactions";
import {
  createHeldWriteView,
  createSavedAttemptRecovery,
  createWriteHold,
  HELD_AWAY_SUCCESS_LINE,
  HELD_POLL_MS,
  intent,
  settledLine,
  WRITE_HOLD_STALE_REVIEW_LINE,
  WriteHeldError,
  WriteHoldBusyError,
  WriteHoldStaleReviewError,
  writeIntentKey,
  type HeldWriteEvidence,
  type HeldWriteView,
  type HeldWriteViewController,
  type WriteHeldState,
  type WriteHoldClient,
  type WriteHoldGate,
  type WriteHoldHandle,
  type WriteHoldSettled,
} from "@bananapus/nana-sdk-core/review";
import { encodeMultiSend, MULTI_SEND_CALL_ONLY } from "@bananapus/nana-sdk-core/safe";
import { type Address, type Hex } from "viem";

/** The one write hold for every ordinary wallet write in this app. */
export const writeHolds = createWriteHold();

/** The one recovery of saved attempts (launches, Markee steps, Relayr sessions) over it. */
export const savedAttempts = createSavedAttemptRecovery({ hold: writeHolds });

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

/** A view's line, with the hold's notice when holds last only in this tab. */
export function heldLineOf(view: Pick<HeldWriteView, "line" | "notice">): string | undefined {
  return [view.line, view.notice].filter(Boolean).join(" ") || undefined;
}

/** Every send's SDK view in this tab, by the hash it sent: what its screens show of it. */
const sent = new Map<string, HeldWriteViewController>();

/** The SDK view `hash` was sent under in this tab, if any. */
export function heldViewOf(hash: Hex | undefined): HeldWriteViewController | undefined {
  return hash ? sent.get(hash.toLowerCase()) : undefined;
}

/** What each view does once it told a settlement: a follower stops, a send in flight refuses. */
const onTold = new WeakMap<HeldWriteViewController, Set<(settled: WriteHoldSettled) => void>>();

function whenTold(
  view: HeldWriteViewController,
  listener: (settled: WriteHoldSettled) => void,
): () => void {
  const listeners = onTold.get(view) ?? new Set();
  onTold.set(view, listeners.add(listener));
  return () => void listeners.delete(listener);
}

/**
 * One held write's SDK view. Its screens show each result from the receipt; a settlement is told
 * once its receipt is read, so one that lands during a send's own check refuses that send before
 * the wallet. `evidence`: a write the app saved before the hold held it, adopted first.
 */
export function heldView(
  handle: WriteHoldHandle,
  client: WriteHoldClient,
  evidence?: HeldWriteEvidence,
): HeldWriteViewController {
  const view: HeldWriteViewController = createHeldWriteView(handle, {
    client,
    onSettled: (settled) => onTold.get(view)?.forEach((listener) => listener(settled)),
    ...(evidence ? { adopt: async () => evidence } : {}),
  });
  return view;
}

/**
 * Follow a held write through its SDK view until the hold settles it (once told, so the success is
 * acknowledged and the next send of the same action goes straight on) or it is released: the
 * view's watch and its shared follower (a Safe proposal's service and chain included) decide.
 * `onView` sees every view it shows. Returns the stop.
 */
export function followHeld(
  view: HeldWriteViewController,
  onView?: (view: HeldWriteView) => void,
): () => void {
  let stop: (() => void) | undefined = view.start();
  const end = () => {
    unsubscribe();
    untold();
    stop?.();
    stop = undefined;
  };
  const untold = whenTold(view, () => queueMicrotask(end));
  const unsubscribe = view.subscribe(() => {
    const now = view.get();
    onView?.(now);
    // Released, or nothing held once any adoption is done.
    if (now.phase === "released" || (now.phase === "clear" && now.state && !now.adopting)) end();
  });
  onView?.(view.get());
  return end;
}

/**
 * The exit of a held write, offered in the flow's dialog while the view asks the chain again at the
 * SDK's poll: an answer that takes the exit away closes it. True once the user took it and the hold
 * released the write. Every read ends before the exit or a resend takes the call's lock.
 */
async function takeExit(view: HeldWriteViewController): Promise<boolean> {
  const open = new AbortController();
  const unsubscribe = view.subscribe(() => {
    if (!view.get().exit) open.abort();
  });
  const watching = (async () => {
    while (!open.signal.aborted) {
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, HELD_POLL_MS);
        open.signal.addEventListener("abort", () => (clearTimeout(timer), resolve()), {
          once: true,
        });
      });
      if (!open.signal.aborted) await view.check();
    }
  })();
  try {
    const accepted = await confirmHeldWriteExit(view.get().state as WriteHeldState, open.signal);
    open.abort();
    await watching;
    return accepted && view.get().exit && (await view.exit());
  } finally {
    open.abort();
    unsubscribe();
    await watching;
  }
}

/**
 * Sends under the hold through one SDK held-write view, which owns the send gate: a held write
 * offers its exit in the flow's dialog (the review reopens after the hold releases it); a success
 * that settled while the user was away asks before sending it again; anything else ends the send
 * with the view's line. A sent write is followed until the hold settles it.
 */
export async function sendHeld(
  handle: WriteHoldHandle,
  client: WriteHoldClient,
  run: (gate: WriteHoldGate) => Promise<Hex>,
  onView?: (hash: Hex, view: HeldWriteView) => void,
): Promise<Hex> {
  const view = heldView(handle, client);
  // The view tells a settlement it first sees during this send's own check, and its gate then
  // lets the send through: a success that lands before the wallet opens is never sent again.
  let landed: WriteHoldSettled | undefined;
  const untold = whenTold(view, (settled) => {
    if (settled.result === "success") landed ??= settled;
  });
  const refuseLanded = () => {
    if (landed) throw new Error(settledLine(landed));
  };
  const guarded = (gate: WriteHoldGate) =>
    run({
      ...gate,
      async beforeSend(actualCall) {
        refuseLanded();
        await gate.beforeSend(actualCall);
        try {
          refuseLanded();
        } catch (error) {
          gate.onRejected();
          throw error;
        }
      },
    });
  try {
    return await sendThrough(view, guarded, onView);
  } finally {
    untold();
  }
}

async function sendThrough(
  view: HeldWriteViewController,
  run: (gate: WriteHoldGate) => Promise<Hex>,
  onView?: (hash: Hex, view: HeldWriteView) => void,
): Promise<Hex> {
  for (;;) {
    try {
      const hash = await view.send(run);
      sent.set(hash.toLowerCase(), view);
      followHeld(view, onView && ((now) => onView(hash, now)));
      return hash;
    } catch (error) {
      // The view refuses a success it never showed before reading it: read, it shows it.
      if (error instanceof Error && error.message === HELD_AWAY_SUCCESS_LINE) await view.check();
      if (view.get().phase === "succeeded") {
        if (!(await confirmSendAgain())) throw new Error(HELD_AWAY_SUCCESS_LINE);
        await view.acknowledge();
        continue;
      }
      // Another window sent this write while its review was open: review it again.
      if (error instanceof WriteHoldStaleReviewError)
        throw new Error(error.settled ? settledLine(error.settled) : WRITE_HOLD_STALE_REVIEW_LINE);
      // Busy with this tab's own read of the same write (its follower): its line says why.
      if (error instanceof WriteHoldBusyError && heldLineOf(view.get()) && view.get().state)
        throw new Error(heldLineOf(view.get()));
      if (!(error instanceof WriteHeldError)) throw error;
      if (view.get().exit && (await takeExit(view))) continue;
      const now = view.get();
      throw new Error(heldLineOf(now) ?? (now.settled ? settledLine(now.settled) : error.message));
    }
  }
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
