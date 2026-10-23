"use client";

import { FlowChoiceDialog } from "@/components/FlowChoiceDialog";
import { LoadingText } from "@/components/ui/LoadingText";

import {
  ReviewScopeContext,
  type TransactionReviewScope,
} from "@/components/TransactionReviewScope";
import { ModalDialog } from "@/components/ui/ModalShell";
import { registerFlowChoiceHandler, type FlowChoice } from "@/lib/flow-choice";
import {
  registerFundingChainSelectionHandler,
  registerTransactionReviewHandler,
  type FundingChainOption,
  type TransactionReviewRequest,
} from "@/lib/transaction-review";
import { registerReviewHandler, type ReviewModel } from "@bananapus/nana-sdk-core/review";
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
  resolve: (approved: boolean) => void;
} &
  /** A boolean review (the Safe, Relayr and authority paths) of the request itself. */
  (
    | { request: TransactionReviewRequest; model?: undefined }
    /** Core's prompt: the model it bound, confirmed only by the confirmation it minted. */
    | { model: ReviewModel; request?: undefined }
  );

export type PendingFundingChainSelection = {
  scope?: TransactionReviewScope | null;
  kind: "funding";
  id: number;
  options: readonly FundingChainOption[];
  initialChainId: number | null;
  resolve: (chainId: number | null) => void;
};

/** A choice a flow asks for mid-action, such as sending a held write again. */
type PendingFlowChoice = {
  scope?: TransactionReviewScope | null;
  kind: "choice";
  id: number;
  choice: FlowChoice;
  resolve: (confirmed: boolean) => void;
};

export type PendingDialog = PendingReview | PendingFundingChainSelection | PendingFlowChoice;

/** The dialogs the lazily loaded review module draws. */
type PendingReviewDialog = PendingReview | PendingFundingChainSelection;

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

  const enqueueFlowChoice = useCallback(
    (choice: FlowChoice, signal?: AbortSignal) =>
      new Promise<boolean>((resolve) => {
        const pending: PendingFlowChoice = {
          kind: "choice",
          scope: scopeRef.current,
          id: nextId.current++,
          choice: { ...choice, lines: [...choice.lines] },
          resolve,
        };
        // Closed unanswered when its caller no longer needs the answer.
        signal?.addEventListener(
          "abort",
          () => {
            if (activeRef.current === pending) {
              activeRef.current = queueRef.current.shift() ?? null;
              setActive(activeRef.current);
            } else {
              queueRef.current = queueRef.current.filter((dialog) => dialog !== pending);
            }
            resolve(false);
          },
          { once: true },
        );
        enqueueDialog(pending);
      }),
    [enqueueDialog],
  );

  useEffect(() => registerTransactionReviewHandler(enqueue), [enqueue]);
  useEffect(
    () =>
      registerReviewHandler(async (prompt) => {
        const approved = await new Promise<boolean>((resolve) =>
          enqueueDialog({
            kind: "review",
            scope: scopeRef.current,
            id: nextId.current++,
            model: prompt.model,
            resolve,
          }),
        );
        return approved ? prompt.confirmation : null;
      }),
    [enqueueDialog],
  );
  useEffect(() => registerFlowChoiceHandler(enqueueFlowChoice), [enqueueFlowChoice]);
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

  // The review UI loads once the page is idle, so the first click opens it with no wait.
  useEffect(() => {
    const load = () => void import("./TransactionReviewDialog").catch(() => undefined);
    if (typeof requestIdleCallback !== "function") return void setTimeout(load, 1_000);
    const id = requestIdleCallback(load, { timeout: 3_000 });
    return () => cancelIdleCallback(id);
  }, []);

  // Keep the global queue ready immediately, but fetch the full decoder and
  // review UI when a request arrives if the idle load hasn't. Loading never authorizes a call;
  // cancellation, unmount, or a failed download resolves it as declined.
  useEffect(() => {
    if (!active || active.kind === "choice" || Dialog) return;
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
      {active?.kind === "choice" ? (
        <FlowChoiceDialog
          key={active.id}
          id={active.id}
          choice={active.choice}
          onFinish={(confirmed) => finish(active.id, confirmed)}
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
