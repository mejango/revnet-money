"use client";

import { HeldWriteDialog } from "@/components/HeldWriteDialog";
import { LoadingText } from "@/components/ui/LoadingText";

import {
  ReviewScopeContext,
  type TransactionReviewScope,
} from "@/components/TransactionReviewScope";
import { ModalDialog } from "@/components/ui/ModalShell";
import { registerHeldWriteHandler, type HeldWritePrompt } from "@/lib/held-write";
import {
  registerFundingChainSelectionHandler,
  registerTransactionReviewHandler,
  type FundingChainOption,
  type TransactionReviewRequest,
} from "@/lib/transaction-review";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ComponentType,
  type PropsWithChildren,
} from "react";
import type { Address } from "viem";
import { useAccount } from "wagmi";

export type PendingReview = {
  scope?: TransactionReviewScope | null;
  kind: "review";
  id: number;
  request: TransactionReviewRequest;
  resolve: (approved: boolean) => void;
};

export type PendingFundingChainSelection = {
  scope?: TransactionReviewScope | null;
  kind: "funding";
  id: number;
  options: readonly FundingChainOption[];
  initialChainId: number | null;
  resolve: (chainId: number | null) => void;
};

/** An earlier write of the same call has no confirmed result: send again, or not. */
export type PendingHeldWrite = {
  scope?: TransactionReviewScope | null;
  kind: "held";
  id: number;
  prompt: HeldWritePrompt;
  resolve: (sendAgain: boolean) => void;
};

export type PendingDialog = PendingReview | PendingFundingChainSelection | PendingHeldWrite;

/** The dialogs the lazily loaded review module draws. */
export type PendingReviewDialog = PendingReview | PendingFundingChainSelection;

export type TransactionReviewDialogProps = {
  pending: PendingReviewDialog;
  onFinish: (result: boolean | number | null) => void;
  projectCheckPending?: boolean;
};

function cancelPendingDialog(pending: PendingDialog) {
  if (pending.kind === "funding") pending.resolve(null);
  else pending.resolve(false);
}

/**
 * Global, promise-based modal queue. Every low-level transaction boundary
 * registers with this one provider, so simultaneous multichain flows review
 * sequentially and each approval applies to one immutable call snapshot.
 */
export function TransactionReviewProvider({ children }: PropsWithChildren) {
  const { address } = useAccount();
  const accountRef = useRef<Address | undefined>(address);
  accountRef.current = address;
  const nextId = useRef(1);
  const scopeRef = useRef<TransactionReviewScope | null>(null);
  const [checkingScopeId, setCheckingScopeId] = useState<number | null>(null);
  const activeRef = useRef<PendingDialog | null>(null);
  const queueRef = useRef<PendingDialog[]>([]);
  const [active, setActive] = useState<PendingDialog | null>(null);
  const [Dialog, setDialog] = useState<ComponentType<TransactionReviewDialogProps> | null>(null);

  const enqueueDialog = useCallback((pending: PendingDialog) => {
    if (activeRef.current) {
      queueRef.current.push(pending);
      return;
    }
    activeRef.current = pending;
    setActive(pending);
  }, []);

  const enqueue = useCallback(
    (request: TransactionReviewRequest) =>
      new Promise<boolean>((resolve) => {
        const snapshot: TransactionReviewRequest = {
          ...request,
          calls: request.calls.map((call) => ({
            ...call,
            // The connected wallet sends a transaction. An authorization is sent
            // by a relayer, a Safe or a sponsor, so only a call that names its
            // own sender shows one.
            from: call.from ?? (request.kind === "authorization" ? undefined : accountRef.current),
            args: call.args ? [...call.args] : undefined,
          })),
        };
        const pending: PendingReview = {
          kind: "review",
          scope: scopeRef.current,
          id: nextId.current++,
          request: snapshot,
          resolve,
        };
        enqueueDialog(pending);
      }),
    [enqueueDialog],
  );

  const enqueueFundingChainSelection = useCallback(
    (options: readonly FundingChainOption[], initialChainId: number | null) =>
      new Promise<number | null>((resolve) => {
        enqueueDialog({
          kind: "funding",
          scope: scopeRef.current,
          id: nextId.current++,
          options: options.map((option) => ({ ...option })),
          initialChainId,
          resolve,
        });
      }),
    [enqueueDialog],
  );

  const enqueueHeldWrite = useCallback(
    (prompt: HeldWritePrompt) =>
      new Promise<boolean>((resolve) => {
        enqueueDialog({
          kind: "held",
          scope: scopeRef.current,
          id: nextId.current++,
          prompt: { ...prompt },
          resolve,
        });
      }),
    [enqueueDialog],
  );

  useEffect(() => registerTransactionReviewHandler(enqueue), [enqueue]);
  useEffect(() => registerHeldWriteHandler(enqueueHeldWrite), [enqueueHeldWrite]);
  useEffect(
    () => registerFundingChainSelectionHandler(enqueueFundingChainSelection),
    [enqueueFundingChainSelection],
  );

  useEffect(
    () => () => {
      if (activeRef.current) cancelPendingDialog(activeRef.current);
      queueRef.current.forEach(cancelPendingDialog);
      activeRef.current = null;
      queueRef.current = [];
    },
    [],
  );

  const registerScope = useCallback((scope: TransactionReviewScope) => {
    scopeRef.current = scope;
    return () => {
      if (scopeRef.current === scope) scopeRef.current = null;
      const cancelled = queueRef.current.filter((dialog) => dialog.scope === scope);
      queueRef.current = queueRef.current.filter((dialog) => dialog.scope !== scope);
      cancelled.forEach(cancelPendingDialog);
      if (activeRef.current?.scope === scope) {
        cancelPendingDialog(activeRef.current);
        activeRef.current = queueRef.current.shift() ?? null;
        setActive(activeRef.current);
      }
    };
  }, []);

  const finish = useCallback(async (id: number, result: boolean | number | null) => {
    const current = activeRef.current;
    if (!current || current.id !== id) return;
    const approving = result === true || typeof result === "number";
    if (approving && current.scope) {
      setCheckingScopeId(id);
      let verified = false;
      try {
        verified = await current.scope.verify();
      } catch {
        /* A failed proof never approves. */
      }
      setCheckingScopeId((checking) => (checking === id ? null : checking));
      // Cancellation, navigation and a different queued review can all race the check.
      if (activeRef.current !== current) return;
      if (!verified || scopeRef.current !== current.scope) result = null;
    }
    if (activeRef.current !== current) return;
    const next = queueRef.current.shift() ?? null;
    activeRef.current = next;
    setActive(next);
    if (current.kind === "funding") current.resolve(typeof result === "number" ? result : null);
    else current.resolve(result === true);
  }, []);

  // Keep the global queue ready immediately, but fetch the full decoder and
  // review UI only when a request arrives. Loading never authorizes a call;
  // cancellation, unmount, or a failed download resolves it as declined.
  useEffect(() => {
    if (!active || active.kind === "held" || Dialog) return;
    let cancelled = false;
    void import("./TransactionReviewDialog").then(
      (module) => {
        if (!cancelled) setDialog(() => module.TransactionReviewDialog);
      },
      () => {
        if (!cancelled) finish(active.id, null);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [active, Dialog, finish]);

  return (
    <ReviewScopeContext.Provider value={registerScope}>
      {children}
      {active?.kind === "held" ? (
        <HeldWriteDialog
          key={active.id}
          id={active.id}
          prompt={active.prompt}
          onFinish={(sendAgain) => finish(active.id, sendAgain)}
        />
      ) : active ? (
        Dialog ? (
          <Dialog
            key={active.id}
            pending={active}
            projectCheckPending={checkingScopeId === active.id}
            onFinish={(result) => finish(active.id, result)}
          />
        ) : (
          <ModalDialog
            key={active.id}
            onClose={() => finish(active.id, null)}
            labelledBy={`transaction-review-loading-${active.id}`}
            className="items-start justify-center px-3 py-5 sm:px-6 sm:py-10"
          >
            <div className="w-full max-w-lg border border-melon-700 bg-melon-25 p-5 shadow-2xl">
              <p id={`transaction-review-loading-${active.id}`} role="status">
                <LoadingText text="Loading transaction review…" />
              </p>
              <button
                type="button"
                onClick={() => finish(active.id, null)}
                className="mt-4 min-h-[44px] border border-melon-600 px-5 text-sm"
              >
                Cancel
              </button>
            </div>
          </ModalDialog>
        )
      ) : null}
    </ReviewScopeContext.Provider>
  );
}
