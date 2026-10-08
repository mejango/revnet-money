"use client";

import { ButtonWithWallet } from "@/components/ButtonWithWallet";
import { SummaryRow, TxConfirmDialog } from "@/components/ui/TxConfirmDialog";
import { TxError } from "@/components/ui/TxError";
import { useHydrated } from "@/hooks/useHydrated";
import { useMultichainBatch, type BatchResult } from "@/hooks/useMultichainBatch";
import { mapConcurrentChecks } from "@/lib/concurrent-checks";
import {
  describeSavedRoutingCall,
  preparePendingRouterPayment,
  readIndexedPendingRouterCalls,
  readPendingRouterPayment,
  type PendingProject,
  type PendingRouterPayment,
} from "@/lib/pending-router-calls";
import { formatTransactionMessage, formatWalletError } from "@/lib/utils";
import { getViemPublicClient } from "@/lib/wagmiTransports";
import { JB_CHAINS, type JBChainId } from "@bananapus/nana-sdk-core";
import { safeQueueUrl } from "@bananapus/nana-sdk-core/safe-service";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { useAccount } from "wagmi";

type Prepared = Awaited<ReturnType<typeof preparePendingRouterPayment>>;

export function PendingRoutingPayments({ projects }: { projects: PendingProject[] }) {
  const hydrated = useHydrated();
  const { address, chainId } = useAccount();
  const queryClient = useQueryClient();
  const { runBatch, getPendingBatch, recheckPendingRoutingBatch } = useMultichainBatch();
  const identities = projects.filter((project) => project.version === 6);
  const projectKey = identities
    .map((project) => `${project.chainId}:${project.projectId}`)
    .sort()
    .join(",");
  const scope = `pending-routing:destination:${projectKey}`;
  const saved = hydrated ? getPendingBatch(scope, identities) : undefined;
  const resume = saved && !saved.replaceableDraft && !saved.refreshable ? saved : undefined;
  const [savedSelection, setSavedSelection] = useState<NonNullable<
    ReturnType<typeof getPendingBatch>
  > | null>(null);
  const [replacementId, setReplacementId] = useState<string | undefined>();
  const [refreshBatchId, setRefreshBatchId] = useState<string | undefined>();
  const [needsReview, setNeedsReview] = useState(false);
  const [checkingSaved, setCheckingSaved] = useState(false);
  const [savedCheck, setSavedCheck] = useState<{ id: string; reason: string } | null>(null);
  const lastChecked = useRef<string | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [reviewed, setReviewed] = useState<Prepared[] | null>(null);
  // The routing round ended. The confirm keeps listing what it routed and ends on Done.
  const [routed, setRouted] = useState(false);
  const [reviewedAccount, setReviewedAccount] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [obsoleteProposals, setObsoleteProposals] = useState<
    NonNullable<BatchResult["obsoleteSafeProposals"]>
  >([]);
  const queryKey = ["pending-routing-payments", "destination", projectKey];
  const inventory = useQuery({
    queryKey: [...queryKey, "inventory"],
    enabled: hydrated && identities.length > 0,
    queryFn: async () =>
      (await mapConcurrentChecks(identities, readIndexedPendingRouterCalls)).flat(),
    refetchInterval: 30_000,
    staleTime: 10_000,
    retry: 1,
  });
  const query = useQuery({
    queryKey: [...queryKey, "verification", inventory.data],
    enabled: hydrated && Boolean(inventory.data),
    queryFn: async () =>
      mapConcurrentChecks(inventory.data ?? [], async (indexed) => {
        try {
          return {
            indexed,
            payment: await readPendingRouterPayment(
              getViemPublicClient(indexed.chainId as JBChainId),
              indexed,
            ),
            error: null,
          };
        } catch (cause) {
          return { indexed, payment: null, error: formatWalletError(cause) };
        }
      }),
    refetchInterval: 30_000,
    staleTime: 10_000,
    retry: 1,
  });
  const rows = (inventory.data ?? []).flatMap((indexed, index) => {
    const result = query.data?.[index];
    // A cleared on-chain commitment means this indexed payment already resolved.
    return result && !result.payment && !result.error ? [] : [{ indexed, result }];
  });
  const payments = (query.data ?? []).flatMap(({ payment }) => (payment ? [payment] : []));
  const ready = payments.filter((payment) => payment.ready);
  const checking = inventory.isPending || (!inventory.isError && query.isPending);
  const unavailable =
    inventory.isError || query.isError || rows.some(({ result }) => result?.error);
  async function refresh() {
    await queryClient.invalidateQueries({ queryKey });
  }

  async function checkSaved() {
    if (!saved || checkingSaved) return;
    setCheckingSaved(true);
    try {
      const checked = await recheckPendingRoutingBatch(scope, identities);
      setSavedCheck({
        id: saved.id,
        reason: checked?.recoveryReason ?? "The saved batch no longer needs recovery.",
      });
      if (open && savedSelection?.id === saved.id) {
        if (checked?.id === savedSelection.id) setSavedSelection(checked);
        else {
          setNeedsReview(true);
          setError("The saved batch changed. Review the current payments again.");
        }
      }
    } catch (cause) {
      setSavedCheck({ id: saved.id, reason: formatWalletError(cause) });
    } finally {
      setCheckingSaved(false);
    }
  }
  // A read-only check resolves stale quote reservations before presenting a recovery-only action.
  useEffect(() => {
    if (!resume || !recheckPendingRoutingBatch) return;
    const key = `${address}:${resume.id}`;
    if (lastChecked.current === key) return;
    lastChecked.current = key;
    void checkSaved();
  });
  const savedReason = savedCheck?.id === saved?.id ? savedCheck?.reason : saved?.recoveryReason;
  const savedDetails = (savedSelection?.calls ?? []).map((call) => {
    try {
      const detail = describeSavedRoutingCall(call);
      return {
        ...detail,
        amountLabel:
          payments.find((payment) => payment.id === detail.id)?.amountLabel ?? detail.amountLabel,
      };
    } catch {
      return {
        id: `${call.chainId}:${call.data}`,
        chainId: call.chainId,
        projectId: "unknown",
        sourceProjectId: "unknown",
        amountLabel: "Saved payment details could not be verified",
        beneficiary: call.address,
        pendingCallId: "unknown",
        hash: call.hash,
        state: call.state,
      };
    }
  });

  async function review(selected: PendingRouterPayment[]) {
    setError(null);
    setRefreshBatchId(undefined);
    if (resume) {
      setNeedsReview(false);
      setSavedSelection(resume);
      setReplacementId(undefined);
      setReviewed(null);
      setOpen(true);
      return;
    }
    if (!address) return;
    setBusy(true);
    try {
      const prepared = await mapConcurrentChecks(selected, (payment) =>
        preparePendingRouterPayment(
          getViemPublicClient(payment.indexed.chainId as JBChainId),
          payment.indexed,
          address,
        ),
      );
      if (!prepared.length) throw new Error("No pending payments are ready to route.");
      setNeedsReview(false);
      setSavedSelection(null);
      setReplacementId(saved?.replaceableDraft ? saved.id : undefined);
      setRefreshBatchId(saved?.refreshable ? saved.id : undefined);
      setReviewed(prepared);
      setReviewedAccount(address.toLowerCase());
      setProgress(null);
      setRouted(false);
      setOpen(true);
    } catch (cause) {
      setError(formatWalletError(cause));
    } finally {
      setBusy(false);
    }
  }

  async function submit() {
    if (!savedSelection && !reviewed) return;
    setBusy(true);
    setError(null);
    try {
      if (reviewed && address?.toLowerCase() !== reviewedAccount) {
        throw new Error(
          "The connected account changed. Reconnect the wallet used for this review.",
        );
      }
      const result = await runBatch({
        label: "Route pending payments",
        scope: savedSelection?.scope ?? scope,
        expectedBatchId: savedSelection?.id,
        replaceDraftId: savedSelection ? undefined : replacementId,
        refreshBatchId: savedSelection ? undefined : refreshBatchId,
        calls: savedSelection ? [] : (reviewed ?? []).map((row) => row.call),
        onProgress: setProgress,
      });
      setObsoleteProposals(result.obsoleteSafeProposals ?? []);
      if (result.status === "pending") return;
      setProgress(
        result.revertedHashes?.length
          ? `${result.revertedHashes.length} routing attempt(s) reverted. Review the refreshed pending payments before trying again.`
          : "Routing review complete. Payments still retained by the gateway remain listed after refresh.",
      );
      setRouted(true);
      await refresh();
    } catch (cause) {
      setError(formatWalletError(cause));
      if (replacementId || refreshBatchId) setNeedsReview(true);
    } finally {
      setBusy(false);
    }
  }

  if (!hydrated || !identities.length) return null;
  if (!rows.length && !resume && !open && !checking) {
    return unavailable ? (
      <p role="status" className="mb-4 text-sm text-zinc-500">
        Pending routing payments are temporarily unavailable.{" "}
        <button className="underline" onClick={() => void refresh()}>
          Retry
        </button>
      </p>
    ) : null;
  }

  return (
    <section aria-labelledby="pending-routing-heading" className="mb-6 border border-teal-200 p-3">
      <h3 id="pending-routing-heading" className="text-base font-medium">
        Payments awaiting routing
      </h3>
      <p className="mt-1 text-sm text-zinc-600">
        These payments are held by the router gateway. Anyone can retry them; they are not part of
        this project's spendable balance.
      </p>
      {unavailable ? (
        <p role="status" className="mt-2 text-sm text-red-600">
          Pending payments could not be refreshed. Review is paused until the current state is
          available.{" "}
          <button className="underline" onClick={() => void refresh()}>
            Retry
          </button>
        </p>
      ) : null}
      {checking ? (
        <p role="status" className="mt-2 text-sm text-zinc-600">
          {inventory.isPending
            ? "Loading payments awaiting routing…"
            : `Found ${inventory.data?.length ?? 0} payments. Checking current status…`}
        </p>
      ) : !unavailable ? (
        <p role="status" className="mt-2 text-sm text-zinc-600">
          {payments.length} payments awaiting routing. {ready.length} ready
        </p>
      ) : null}
      {rows.length > 1 || resume ? (
        <div className="mt-3">
          <ButtonWithWallet
            targetChainId={chainId as JBChainId | undefined}
            variant="outline"
            loading={busy}
            disabled={!resume && (!ready.length || checking || unavailable)}
            onClick={() => void review(ready)}
          >
            {resume
              ? "Resume saved batch"
              : checking
                ? "Checking pending payments…"
                : "Batch all pending"}
          </ButtonWithWallet>
          {resume ? (
            <p className="mt-1 text-xs text-zinc-500">
              Saved batch: {resume.completed} of {resume.total} attempts handled.{" "}
              {savedReason && formatTransactionMessage(savedReason)}
            </p>
          ) : null}
          {resume ? (
            <button
              type="button"
              className="mt-2 text-sm underline"
              disabled={checkingSaved || busy}
              onClick={() => void checkSaved()}
            >
              {checkingSaved ? "Checking saved status…" : "Re-check saved status"}
            </button>
          ) : null}
          {ready.length < payments.length && !resume ? (
            <p className="mt-1 text-xs text-zinc-500">
              Includes {ready.length} ready payments. Payments in cooldown must wait.
            </p>
          ) : null}
        </div>
      ) : null}
      <div className="mt-3 space-y-3">
        {rows.map(({ indexed, result }) => {
          const payment = result?.payment;
          return (
            <div
              key={`${indexed.chainId}:${indexed.gateway}:${indexed.pendingCallId}`}
              className="border-t border-teal-100 pt-3"
            >
              <p className="break-all text-sm font-medium">
                {payment?.amountLabel ?? `${indexed.amount} base units of ${indexed.token}`}
              </p>
              <p className="text-xs text-zinc-600">
                To project {indexed.projectId} on{" "}
                {JB_CHAINS[indexed.chainId as JBChainId]?.name ?? indexed.chainId}
              </p>
              {!result ? (
                <p className="mt-1 text-xs text-zinc-500">Checking payment status…</p>
              ) : result.error ? (
                <p className="mt-1 text-xs text-red-600">
                  Could not verify payment: {result.error}
                </p>
              ) : payment && !payment.ready ? (
                <p className="mt-1 text-xs text-zinc-500">
                  Available after {new Date(Number(payment.nextAttemptAt) * 1000).toLocaleString()}.
                </p>
              ) : null}
              <div className="mt-2">
                <ButtonWithWallet
                  targetChainId={indexed.chainId as JBChainId}
                  variant="outline"
                  loading={busy}
                  disabled={!payment?.ready || Boolean(resume) || checking || unavailable}
                  onClick={() => payment && void review([payment])}
                >
                  {!result
                    ? "Checking payment…"
                    : payment?.action === "finalizePendingCall"
                      ? "Review final attempt"
                      : "Review routing"}
                </ButtonWithWallet>
              </div>
            </div>
          );
        })}
      </div>
      <TxError error={open ? null : error} />
      <TxConfirmDialog
        open={open}
        onClose={() => {
          setOpen(false);
          if (!routed) return;
          setRouted(false);
          setReviewed(null);
        }}
        title="Route pending payments"
        steps={
          savedSelection
            ? savedDetails.map((payment) => ({
                title: `${payment.amountLabel} to project ${payment.projectId}`,
              }))
            : (reviewed ?? []).map(({ payment }) => ({
                title: `${payment.amountLabel} to project ${payment.indexed.projectId}`,
              }))
        }
        activeIndex={busy ? 0 : -1}
        stepsIntro="Eligible wallet batches use one network-fee payment for all selected attempts. Each attempt keeps its own result."
        onConfirm={() => (needsReview ? void review(ready) : void submit())}
        action={needsReview ? "Review again" : savedSelection ? "Continue" : "Confirm routing"}
        busy={busy}
        error={error}
        status={progress}
        actionDisabled={
          needsReview
            ? !resume && (checking || unavailable || !ready.length)
            : !savedSelection && !reviewed
        }
        complete={routed}
      >
        <div className="max-h-80 space-y-4 overflow-y-auto">
          {obsoleteProposals.map((proposal) => (
            <p
              key={`${proposal.chainId}:${proposal.hash}`}
              className="break-all text-sm text-zinc-600"
            >
              Payment already resolved. The obsolete Safe proposal was removed from this routing
              batch. Cancel or replace nonce {proposal.nonce} in Safe before executing later
              proposals.{" "}
              <a
                className="underline"
                href={safeQueueUrl(proposal.chainId, proposal.safe) ?? undefined}
                target="_blank"
                rel="noreferrer"
              >
                Safe proposal {proposal.hash}
              </a>
            </p>
          ))}
          <p className="text-sm text-zinc-600">
            Routing uses the original amount, destination and beneficiary. A retry can remain
            pending. A final attempt may return the payment to its source project's balance if the
            route still fails with the same error. You pay network fees only. Eligible wallet
            batches are submitted together; Safe proposals and unsupported networks use direct
            submission. Progress is saved so you can resume.
          </p>
          {savedSelection ? (
            <SummaryRow label="Saved selection">
              {savedSelection.completed} of {savedSelection.total} attempts handled
            </SummaryRow>
          ) : null}
          {savedSelection ? (
            <p className="text-sm text-zinc-600">
              {savedSelection.recoveryReason &&
                formatTransactionMessage(savedSelection.recoveryReason)}
            </p>
          ) : null}
          {savedDetails.map((payment) => (
            <div key={payment.id} className="space-y-2 border-t border-teal-100 pt-3 text-sm">
              <SummaryRow label="Amount">
                <span className="break-all">{payment.amountLabel}</span>
              </SummaryRow>
              <SummaryRow label="On">
                {JB_CHAINS[payment.chainId as JBChainId]?.name ?? payment.chainId}
              </SummaryRow>
              <SummaryRow label="To">Project {payment.projectId}</SummaryRow>
              <SummaryRow label="Source">Project {payment.sourceProjectId}</SummaryRow>
              <SummaryRow label="Saved state">{payment.state}</SummaryRow>
              <SummaryRow label="Payment ID">
                <span className="break-all">{payment.pendingCallId}</span>
              </SummaryRow>
              <SummaryRow label="Beneficiary">
                <span className="break-all">{payment.beneficiary}</span>
              </SummaryRow>
              {payment.hash ? (
                <SummaryRow label="Transaction">
                  <span className="break-all">{payment.hash}</span>
                </SummaryRow>
              ) : null}
            </div>
          ))}
          {(reviewed ?? []).map(({ payment }) => (
            <div key={payment.id} className="space-y-2 border-t border-teal-100 pt-3 text-sm">
              <SummaryRow label="Amount">
                <span className="break-all">{payment.amountLabel}</span>
              </SummaryRow>
              <SummaryRow label="On">
                {JB_CHAINS[payment.indexed.chainId as JBChainId]?.name}
              </SummaryRow>
              <SummaryRow label="To">Project {payment.indexed.projectId}</SummaryRow>
              <SummaryRow label="Source">Project {payment.indexed.sourceProjectId}</SummaryRow>
              <SummaryRow label="Action">
                {payment.action === "finalizePendingCall"
                  ? "Final attempt; may refund"
                  : "Retry routing"}
              </SummaryRow>
              <SummaryRow label="Beneficiary">
                <span className="break-all">{payment.indexed.beneficiary}</span>
              </SummaryRow>
              <SummaryRow label="Original payer">
                <span className="break-all">{payment.indexed.refundTo}</span>
              </SummaryRow>
            </div>
          ))}
        </div>
      </TxConfirmDialog>
    </section>
  );
}
