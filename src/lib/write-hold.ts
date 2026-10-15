"use client";

import { confirmHeldWriteExit, confirmSendAgain } from "@/lib/flow-choice";
import type { ReviewedSafeProposal } from "@/lib/safe-transactions";
import {
  createSavedAttemptRecovery,
  createWriteHold,
  HELD_AWAY_SUCCESS_LINE,
  HELD_POLL_MS,
  HELD_RELEASED_ELSEWHERE_LINE,
  hidesShownExit,
  intent,
  settledLine,
  WRITE_HOLD_STALE_REVIEW_LINE,
  WriteHeldError,
  WriteHoldBusyError,
  WriteHoldStaleReviewError,
  writeIntentKey,
  type WriteHeldState,
  type WriteHoldClient,
  type WriteHoldGate,
  type WriteHoldHandle,
  type WriteHoldState,
} from "@bananapus/nana-sdk-core/review";
import type { HeldSendInput, UseHeldSendResult } from "@bananapus/nana-sdk-core/review/react";
import { encodeMultiSend, MULTI_SEND_CALL_ONLY } from "@bananapus/nana-sdk-core/safe";
import { type Address, type Hex } from "viem";

/** The one write hold for every ordinary wallet write in this app. */
export const writeHolds = createWriteHold();

/** The one recovery of saved attempts (launches, Markee steps, Relayr sessions) over it. */
export const savedAttempts = createSavedAttemptRecovery({ hold: writeHolds });

/** One held write's hold, as the SDK's held send and held write take it. */
export type HoldInput = HeldSendInput;

/**
 * The hold of a Safe proposal, by what it was reviewed to run: one call, or a batch as the one
 * MultiSend call the Safe runs by DELEGATECALL (the SDK's batch identity). A proposal held by an
 * intent also answers for the exact-call holds an earlier build left: its call, and any call of
 * the same function on the same target.
 */
export function safeHoldInputOf(chainId: number, proposal: ReviewedSafeProposal): HoldInput {
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
  return {
    chainId,
    account: proposal.safe,
    safe: true,
    call,
    ...(proposal.holdNamespace
      ? {
          namespace: proposal.holdNamespace,
          legacy: legacyOf(call, proposal.legacyNamespaces),
        }
      : {}),
  };
}

/** A direct write's hold as its activity row keeps it: JSON, its value in decimal. */
export type StoredHold = {
  namespace?: string;
  /** The namespaces an earlier build held it by. REMOVE with legacy-intents.ts. */
  legacyNamespaces?: string[];
  call: { to: Address; data: Hex; value: string };
};

/** What a direct write's row keeps of its hold. */
export function storedHoldOf(input: HoldInput): StoredHold {
  const legacyNamespaces = (input.legacy ?? []).filter(
    (key): key is string => typeof key === "string",
  );
  return {
    ...(input.namespace ? { namespace: input.namespace } : {}),
    ...(legacyNamespaces.length ? { legacyNamespaces } : {}),
    call: { to: input.call.to, data: input.call.data, value: String(input.call.value ?? 0n) },
  };
}

/** A row's hold: its Safe proposal's, or the direct write's it kept. */
export function holdInputOf(row: {
  chainId?: number;
  account?: Address;
  safeProposal?: ReviewedSafeProposal;
  directHold?: StoredHold;
}): HoldInput | undefined {
  if (!row.chainId) return undefined;
  if (row.safeProposal) return safeHoldInputOf(row.chainId, row.safeProposal);
  const stored = row.directHold;
  if (!stored || !row.account) return undefined;
  const call = { ...stored.call, value: BigInt(stored.call.value) };
  return {
    chainId: row.chainId,
    account: row.account,
    safe: false,
    call,
    ...(stored.namespace
      ? { namespace: stored.namespace, legacy: legacyOf(call, stored.legacyNamespaces) }
      : {}),
  };
}

/** The hold handle of `input`, as the SDK's views open it. */
export function holdOf(input: HoldInput): WriteHoldHandle {
  const { chainId, account, safe = false, namespace, legacy, call } = input;
  return writeHolds.open(
    { chainId, account, safe, call, ...(namespace ? { namespace } : {}) },
    legacy ? { legacy } : undefined,
  );
}

/** The hold handle of a Safe proposal. */
export function safeHoldOf(chainId: number, proposal: ReviewedSafeProposal): WriteHoldHandle {
  return holdOf(safeHoldInputOf(chainId, proposal));
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

/** A held state's or view's line, with the hold's notice when holds last only in this tab. */
export function heldLineOf(view: { line: string | null; notice?: string }): string | undefined {
  return [view.line, view.notice].filter(Boolean).join(" ") || undefined;
}

/**
 * The exit of a held write, offered in the flow's dialog while the hold is asked again at the
 * SDK's poll: an answer that takes the exit away closes it. True once the user took it and the
 * hold released the exact state they saw.
 */
async function takeExit(
  handle: WriteHoldHandle,
  client: WriteHoldClient,
  shown: WriteHeldState,
): Promise<{ released: boolean; state?: WriteHoldState }> {
  const open = new AbortController();
  let closedBy: WriteHoldState | undefined;
  const watching = (async () => {
    while (!open.signal.aborted) {
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, HELD_POLL_MS);
        open.signal.addEventListener("abort", () => (clearTimeout(timer), resolve()), {
          once: true,
        });
      });
      if (open.signal.aborted) return;
      const now = await handle.state(client).catch(() => null);
      // Only a checked answer takes an exit away.
      if (now && !hidesShownExit(shown, now) && (now.status === "clear" || !now.exit)) {
        closedBy = now;
        open.abort();
      }
    }
  })();
  try {
    const accepted = await confirmHeldWriteExit(shown, open.signal);
    open.abort();
    await watching;
    if (closedBy) return { released: false, state: closedBy };
    if (!accepted) return { released: false };
    return await handle.exit(shown, { checkedWallet: true }, client);
  } finally {
    open.abort();
    await watching;
  }
}

/** The line a refused send ends with: the hold's own, or how the chain ended it meanwhile. */
function endedLine(state: WriteHoldState): string | undefined {
  if (state.status !== "clear") return heldLineOf(state);
  return state.settled ? settledLine(state.settled) : HELD_RELEASED_ELSEWHERE_LINE;
}

/**
 * One send through the SDK's held send (`send`, from useHeldSend), with the flow's dialogs on its
 * refusals: a held write offers the hold's exit (the review reopens after the hold releases it); a
 * success that settled while the user was away asks before sending it again; anything else ends
 * the send with the hold's line.
 */
export async function sendHeld(
  send: UseHeldSendResult["send"],
  input: HoldInput,
  client: WriteHoldClient,
  run: (gate: WriteHoldGate) => Promise<Hex>,
): Promise<Hex> {
  for (;;) {
    try {
      return await send(input, run);
    } catch (error) {
      const handle = holdOf(input);
      if (error instanceof Error && error.message === HELD_AWAY_SUCCESS_LINE) {
        const success = handle.unacknowledgedSuccess();
        if (!success || !(await confirmSendAgain())) throw error;
        await handle.acknowledge(success);
        continue;
      }
      // Another window sent this write while its review was open: review it again.
      if (error instanceof WriteHoldStaleReviewError)
        throw new Error(error.settled ? settledLine(error.settled) : WRITE_HOLD_STALE_REVIEW_LINE);
      // Busy with this tab's own read of the same write: the hold's line says why.
      if (error instanceof WriteHoldBusyError) {
        const now = handle.peek();
        if (now.status !== "clear") throw new Error(heldLineOf(now));
      }
      if (!(error instanceof WriteHeldError)) throw error;
      if (!error.state.exit) throw new Error(heldLineOf(error.state));
      const ended = await takeExit(handle, client, error.state);
      if (ended.released) continue;
      throw new Error((ended.state && endedLine(ended.state)) ?? heldLineOf(error.state));
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
