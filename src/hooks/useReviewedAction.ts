"use client";

import { recordSubmittedWrite, settleSubmittedWrite } from "@/lib/held-rows";
import { revertedStep, ReviewRefusal, type ReviewedRunResult } from "@/lib/reviewed-call";
import { isSafeConnection, safeWalletPeerSettled } from "@/lib/safe-connector";
import { requireNoViewAs } from "@/lib/view-as";
import { answerHeldRefusal, isHeldRefusal, writeHolds } from "@/lib/write-hold";
import type { ReviewedCall } from "@bananapus/nana-sdk-core/review";
import {
  discardReviewedSequence,
  findReviewedSequence,
  openStepHold,
  viemWalletAdapter,
  type WriteHoldClient,
} from "@bananapus/nana-sdk-core/review";
import {
  useReviewedRun,
  type UseReviewedRunDeps,
  type UseReviewedRunResult,
} from "@bananapus/nana-sdk-core/review/react";
import { SAFE_NONCE_GUIDANCE } from "@bananapus/nana-sdk-core/safe-service";
import { useCallback, useMemo, useRef } from "react";
import type { PublicClient } from "viem";
import { useAccount, useConfig } from "wagmi";
import { getAccount, getPublicClient, getWalletClient, switchChain } from "wagmi/actions";

export {
  failedLine,
  isSafeProposalPendingError,
  requireDone,
  requireProposedOrDone,
  reviewedCall,
  ReviewRefusal,
  SAFE_PROPOSAL_PENDING_LINE,
  SAFE_PROPOSAL_UNCONFIRMED_LINE,
  SafeProposalPendingError,
  type ReviewedRunResult,
  type WriteRequest,
} from "@/lib/reviewed-call";
export type { ReviewedCall } from "@bananapus/nana-sdk-core/review";

export const WALLET_CHANGED = "Wallet connection changed. Review the transaction again.";

/**
 * The send engine loads with the first write, not with the page: every send through it (Safe
 * proposals and executions too) takes it from here, never from a static import.
 */
export const loadEngine = () => import("@bananapus/nana-sdk-core/review");

export type ReviewedActionInput = Parameters<UseReviewedRunResult["run"]>[0];

/**
 * revnet's one reviewed send, over core's useReviewedRun: revnet's wallet, chains, write hold and
 * view-as guard. Core reviews, simulates, holds, journals and sends. This hook adds revnet's review
 * copy, refuses a changed wallet connection, answers a held refusal with the hold's dialogs, and
 * journals each sent write for the account page.
 */
export function useReviewedAction() {
  const config = useConfig();
  const { address } = useAccount();
  const deps = useMemo<UseReviewedRunDeps>(
    () => ({
      adapter: viemWalletAdapter({
        walletClient: () => getWalletClient(config),
        account: () => getAccount(config).address,
        chainId: () => getAccount(config).chainId,
        isSafe: () => isSafeConnection(config),
        switchChain: (chainId) => switchChain(config, { chainId } as never),
        // Safe{Wallet} over WalletConnect is known only once its peer check answers.
        ready: safeWalletPeerSettled,
      }),
      clientFor: (chainId) => getPublicClient(config, { chainId } as never) as PublicClient,
      hold: writeHolds,
      account: address,
      guard: requireNoViewAs,
      engine: loadEngine,
    }),
    [config, address],
  );
  const runner = useReviewedRun(deps);
  const latest = useRef(runner);
  latest.current = runner;

  const runOnce = useCallback(
    async (action: ReviewedActionInput): Promise<ReviewedRunResult> => {
      await safeWalletPeerSettled();
      // Connector identity matters even when both wallets name the same account.
      const connector = getAccount(config).connector;
      const safe = isSafeConnection(config);
      // Its sends are journaled under the account it was reviewed for, whatever the wallet shows.
      const account = action.account ?? getAccount(config).address;
      const rows: string[] = [];
      const [first] = action.calls;
      const result = await latest.current.run({
        ...action,
        title:
          action.title ??
          (action.calls.length === 1 && first?.functionName
            ? `Review ${first.functionName}`
            : undefined),
        confirmLabel: safe
          ? "Agree & propose to Safe"
          : (action.confirmLabel ?? "Agree & continue"),
        description:
          [action.description, safe ? SAFE_NONCE_GUIDANCE : undefined, writeHolds.reviewLine()]
            .filter(Boolean)
            .join("\n\n") || undefined,
        assertWriteState: () => {
          requireNoViewAs();
          if (getAccount(config).connector !== connector || isSafeConnection(config) !== safe)
            throw new ReviewRefusal(WALLET_CHANGED);
          action.assertWriteState?.();
        },
        onSubmitted: async (call, step, hash, sent) => {
          if (account && !sent.adopted)
            rows[step] = recordSubmittedWrite(
              call,
              hash,
              account,
              action.title ?? call.label ?? "Transaction",
              sent.safe,
            );
          await action.onSubmitted?.(call, step, hash, sent);
        },
      });
      if (result?.status === "done")
        for (const id of rows) if (id) settleSubmittedWrite(id, "success");
      if (result?.status === "failed") {
        const step = revertedStep(result.failure);
        const id = step === undefined ? undefined : rows[step];
        if (id) settleSubmittedWrite(id, "failed");
      }
      return result;
    },
    [config],
  );

  const run = useCallback(
    async (action: ReviewedActionInput): Promise<ReviewedRunResult> => {
      const account = action.account ?? getAccount(config).address;
      const saved =
        action.scope !== undefined && account ? findReviewedSequence(action.scope, account) : null;
      // A rebuilt plan (fresh deadlines, an approval already spent) replaces an unfinished earlier
      // run of the action; a step of it still held refuses this with its own line.
      if (saved && !sameCalls(saved.calls, action.calls))
        try {
          await discardReviewedSequence(saved);
        } catch (cause) {
          const line = cause instanceof Error ? cause.message : "This action is still pending.";
          return { status: "failed", error: line, failure: new ReviewRefusal(line) };
        }
      for (;;) {
        const result = await runOnce(action);
        if (result?.status !== "failed" || !isHeldRefusal(result.failure)) return result;
        // The hold refused a step: its exit, or sending a success from while away again, is
        // offered as before, and the action is reviewed again once the user's answer allows it.
        const account = getAccount(config).address;
        const safe = isSafeConnection(config);
        const held = account
          ? action.calls
              .map((call) => ({ call, handle: openStepHold(writeHolds, account, safe, call) }))
              .find(
                ({ handle }) => handle.peek().status !== "clear" || handle.unacknowledgedSuccess(),
              )
          : undefined;
        if (!held) return result;
        const client = getPublicClient(config, { chainId: held.call.chainId } as never);
        try {
          await answerHeldRefusal(
            result.failure,
            held.handle,
            client as unknown as WriteHoldClient,
          );
        } catch (cause) {
          return {
            status: "failed",
            error: cause instanceof Error ? cause.message : result.error,
            failure: new ReviewRefusal(cause instanceof Error ? cause.message : result.error),
          };
        }
      }
    },
    [config, runOnce],
  );

  const failure = runner.failure;
  return {
    ...runner,
    run,
    /** The wallet, chains and hold the run sends through, for core's Safe service sends. */
    deps,
    /** The line to show: a site's own refusal as it is, else core's. */
    error: failure instanceof ReviewRefusal ? failure.message : runner.error,
    /** In review, simulating, signing or awaiting a receipt. */
    busy:
      runner.phase === "review" ||
      runner.phase === "simulating" ||
      runner.phase === "signing" ||
      runner.phase === "receipt",
  };
}

export type ReviewedAction = ReturnType<typeof useReviewedAction>;

/** The calls as core compares an unfinished run with a new one (useReviewedRun's `sent`). */
function sameCalls(a: readonly ReviewedCall[], b: readonly ReviewedCall[]): boolean {
  const key = (calls: readonly ReviewedCall[]) =>
    calls
      .map(
        (call) =>
          `${call.chainId}:${call.to.toLowerCase()}:${call.data.toLowerCase()}:${call.value ?? 0n}:${call.gas ?? ""}`,
      )
      .join("|");
  return key(a) === key(b);
}
