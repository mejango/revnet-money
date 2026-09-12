"use client";

import { ButtonWithWallet } from "@/components/ButtonWithWallet";
import { SummaryRow, TxConfirmDialog } from "@/components/ui/TxConfirmDialog";
import { useMultichainBatch, type BatchResult } from "@/hooks/useMultichainBatch";
import {
  preparePendingRouterPayment,
  readIndexedPendingRouterCalls,
  readPendingRouterPayment,
  type PendingProject,
  type PendingRouterPayment,
} from "@/lib/pending-router-calls";
import { safeQueueLink } from "@/lib/safe-queue";
import { formatWalletError } from "@/lib/utils";
import { getViemPublicClient } from "@/lib/wagmiTransports";
import { JB_CHAINS, type JBChainId } from "@bananapus/nana-sdk-core";
import { useQuery } from "@tanstack/react-query";
import { useState, useSyncExternalStore } from "react";
import { useAccount } from "wagmi";

const subscribe = () => () => {};
const clientSnapshot = () => true;
const serverSnapshot = () => false;
type Prepared = Awaited<ReturnType<typeof preparePendingRouterPayment>>;

export function PendingRoutingPayments({ projects }: { projects: PendingProject[] }) {
  const hydrated = useSyncExternalStore(subscribe, clientSnapshot, serverSnapshot);
  const { address, chainId } = useAccount();
  const { runBatch, getPendingBatch } = useMultichainBatch();
  const identities = projects.filter((project) => project.version === 6);
  const projectKey = identities
    .map((project) => `${project.chainId}:${project.projectId}`)
    .sort()
    .join(",");
  const scope = `pending-routing:${projectKey}`;
  const saved = hydrated ? getPendingBatch(scope) : undefined;
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [reviewed, setReviewed] = useState<Prepared[] | null>(null);
  const [reviewedAccount, setReviewedAccount] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [obsoleteProposals, setObsoleteProposals] = useState<
    NonNullable<BatchResult["obsoleteSafeProposals"]>
  >([]);
  const query = useQuery({
    queryKey: ["pending-routing-payments", projectKey],
    enabled: hydrated && identities.length > 0,
    queryFn: async () => {
      const indexed = (await Promise.all(identities.map(readIndexedPendingRouterCalls))).flat();
      const payments = await Promise.all(
        indexed.map((row) =>
          readPendingRouterPayment(getViemPublicClient(row.chainId as JBChainId), row),
        ),
      );
      return payments.filter((row): row is PendingRouterPayment => row !== null);
    },
    refetchInterval: 30_000,
    staleTime: 10_000,
    retry: 1,
  });
  const payments = query.data ?? [];
  const ready = payments.filter((payment) => payment.ready);

  async function review(selected: PendingRouterPayment[]) {
    setError(null);
    if (saved) {
      setOpen(true);
      return;
    }
    if (!address) return;
    setBusy(true);
    try {
      const prepared = await Promise.all(
        selected.map((payment) =>
          preparePendingRouterPayment(
            getViemPublicClient(payment.indexed.chainId as JBChainId),
            payment.indexed,
            address,
          ),
        ),
      );
      if (!prepared.length) throw new Error("No pending payments are ready to route.");
      setReviewed(prepared);
      setReviewedAccount(address.toLowerCase());
      setProgress(null);
      setOpen(true);
    } catch (cause) {
      setError(formatWalletError(cause));
    } finally {
      setBusy(false);
    }
  }

  async function submit() {
    if (!saved && !reviewed) return;
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
        scope,
        calls: saved ? [] : (reviewed ?? []).map((row) => row.call),
        onProgress: setProgress,
      });
      setObsoleteProposals(result.obsoleteSafeProposals ?? []);
      if (result.status === "pending") return;
      setProgress(
        result.revertedHashes?.length
          ? `${result.revertedHashes.length} routing attempt(s) reverted. Review the refreshed pending payments before trying again.`
          : "Routing review complete. Payments still retained by the gateway remain listed after refresh.",
      );
      setReviewed(null);
      await query.refetch();
    } catch (cause) {
      setError(formatWalletError(cause));
    } finally {
      setBusy(false);
    }
  }

  if (!hydrated || !identities.length) return null;
  if (!payments.length && !saved && !open) {
    return query.isError ? (
      <p role="status" className="mb-4 text-sm text-zinc-500">
        Pending routing payments are temporarily unavailable.{" "}
        <button className="underline" onClick={() => void query.refetch()}>
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
      {query.isError ? (
        <p role="status" className="mt-2 text-sm text-red-600">
          Pending payments could not be refreshed. Review is paused until the current state is
          available.{" "}
          <button className="underline" onClick={() => void query.refetch()}>
            Retry
          </button>
        </p>
      ) : null}
      <div className="mt-3 space-y-3">
        {payments.map((payment) => (
          <div key={payment.id} className="border-t border-teal-100 pt-3">
            <p className="break-all text-sm font-medium">{payment.amountLabel}</p>
            <p className="text-xs text-zinc-600">
              {JB_CHAINS[payment.indexed.chainId as JBChainId]?.name ?? payment.indexed.chainId}
              {" · "}To project {payment.indexed.projectId}
            </p>
            {!payment.ready ? (
              <p className="mt-1 text-xs text-zinc-500">
                Available after {new Date(Number(payment.nextAttemptAt) * 1000).toLocaleString()}.
              </p>
            ) : null}
            <div className="mt-2">
              <ButtonWithWallet
                targetChainId={payment.indexed.chainId as JBChainId}
                variant="outline"
                loading={busy}
                disabled={!payment.ready || Boolean(saved) || query.isError}
                onClick={() => void review([payment])}
              >
                {payment.action === "finalizePendingCall"
                  ? "Review final attempt"
                  : "Review routing"}
              </ButtonWithWallet>
            </div>
          </div>
        ))}
      </div>
      {payments.length > 1 || saved ? (
        <div className="mt-3">
          <ButtonWithWallet
            targetChainId={chainId as JBChainId | undefined}
            variant="outline"
            loading={busy}
            disabled={!saved && (!ready.length || query.isError)}
            onClick={() => void review(ready)}
          >
            {saved
              ? `Continue routing (${saved.completed}/${saved.total} confirmed)`
              : "Batch all pending"}
          </ButtonWithWallet>
          {ready.length < payments.length && !saved ? (
            <p className="mt-1 text-xs text-zinc-500">
              Includes {ready.length} ready payments. Payments in cooldown must wait.
            </p>
          ) : null}
        </div>
      ) : null}
      {error && !open ? (
        <p role="alert" className="mt-2 text-sm text-red-600">
          {error}
        </p>
      ) : null}
      <TxConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title="Route pending payments"
        chainId={(reviewed?.[0]?.payment.indexed.chainId ?? chainId ?? 1) as JBChainId}
        steps={(reviewed ?? []).map(({ payment }) => ({
          title: `${payment.amountLabel} · project ${payment.indexed.projectId}`,
        }))}
        activeIndex={busy ? 0 : -1}
        stepsIntro="Review every selected attempt. Confirmed attempts are saved when execution takes more than one round."
        onConfirm={() => void submit()}
        action={saved ? "Continue" : "Confirm routing"}
        busy={busy}
        error={error}
        status={progress}
        disabled={!saved && !reviewed}
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
                href={safeQueueLink(proposal.chainId, proposal.safe) ?? undefined}
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
            route still fails with the same error. You pay gas only. Calls execute in resumable
            rounds.
          </p>
          {saved ? (
            <SummaryRow label="Saved selection">
              {saved.completed} of {saved.total} attempts confirmed
            </SummaryRow>
          ) : null}
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
