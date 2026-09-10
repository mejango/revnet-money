"use client";

import { CallRow } from "@/components/ExactCallCard";
import { SummaryRow, TxConfirmDialog } from "@/components/ui/TxConfirmDialog";
import { useToast } from "@/components/ui/use-toast";
import { isSafeProposalPendingError } from "@/hooks/useReviewedWriteContract";
import {
  checkBatchOrder,
  describeStep,
  moveStep,
  removeStep,
  shortAddress,
  useSafeBatch,
  writeBatch,
  type BatchStep,
} from "@/lib/safe-batch";
import { formatWalletError } from "@/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { useRef, useState } from "react";
import type { AbiFunction, Address } from "viem";
import { useAccount } from "wagmi";
import { chainName, type ChainProjectRow } from "./operatorLib";
import { useSafeBatchSubmit, type SafeBatchRoute } from "./useSafeBatchSubmit";

function formatArgument(value: unknown): string {
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "string") return value;
  return JSON.stringify(value, (_key, item: unknown) =>
    typeof item === "bigint" ? item.toString() : item,
  );
}

/** The step's call decoded through its ABI: destination, signature, and each argument by name. */
function DecodedCall({ step }: { step: BatchStep }) {
  const fn = step.abi.find(
    (item): item is AbiFunction => item.type === "function" && item.name === step.functionName,
  );
  return (
    <dl className="mt-2 space-y-0.5 text-xs">
      <CallRow label="To">
        {step.contractName} | {step.to}
      </CallRow>
      <CallRow label="Call">
        {fn
          ? `${fn.name}(${fn.inputs.map((input) => input.type).join(", ")})`
          : step.data.slice(0, 10)}
      </CallRow>
      {fn?.inputs.map((input, index) => (
        <CallRow key={`${input.name ?? index}`} label={input.name || `argument ${index + 1}`}>
          {formatArgument(step.args[index])}
        </CallRow>
      ))}
    </dl>
  );
}

function routeSummary(route: SafeBatchRoute | undefined, count: number): string {
  if (!route) return "Checking who can sign…";
  if (route.kind === "safe-app") return "One MultiSend proposal through the Safe app";
  if (route.kind === "safe-signer") {
    return `One MultiSend proposal to the operator Safe (${route.threshold} of ${route.owners.length} signatures)`;
  }
  if (route.kind === "eoa") {
    return `${count} transaction${count === 1 ? "" : "s"} from your wallet, in order`;
  }
  return "Not available";
}

function actionLabel(route: SafeBatchRoute | undefined, count: number): string {
  if (route?.kind === "eoa") return `Send ${count} transaction${count === 1 ? "" : "s"}`;
  return "Propose batch to Safe";
}

/**
 * The batch confirm for one chain: who sends it and how, then the queued
 * steps in order with reorder/remove controls and their decoded calls. A
 * dependency problem is shown on the offending step and blocks the action;
 * nothing is ever reordered silently.
 */
export function SafeBatchDialog({
  row,
  authority,
  open,
  onOpenChange,
}: {
  row: ChainProjectRow;
  /** The chain's live operator; undefined keeps the historical direct path. */
  authority: Address | undefined;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const steps = useSafeBatch(row.chainId, row.projectId);
  const { address } = useAccount();
  const { routeFor, submit } = useSafeBatchSubmit();
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Direct writes land one by one; a failure keeps only what has not been sent.
  const sent = useRef(0);

  const routeQuery = useQuery({
    queryKey: ["safe-batch-route", row.chainId, address ?? "", authority ?? ""],
    enabled: open && !!address,
    staleTime: 15_000,
    queryFn: () => routeFor({ chainId: row.chainId, authority }),
  });
  const route = address ? routeQuery.data : undefined;
  const { problems } = checkBatchOrder(steps);
  const name = chainName(row.chainId);
  const update = (next: BatchStep[]) => writeBatch(row.chainId, row.projectId, next);

  const confirm = async () => {
    if (busy || !route || route.kind === "refused" || !steps.length || problems.length) return;
    setBusy(true);
    setError(null);
    setStatus(null);
    sent.current = 0;
    setActiveIndex(0);
    const submitted = steps;
    try {
      const outcome = await submit({
        chainId: row.chainId,
        steps: submitted,
        route,
        onProgress: setStatus,
        onStep: (index) => {
          sent.current = index;
          setActiveIndex(index);
        },
      });
      update([]);
      const message =
        outcome.kind === "sent"
          ? `Sent ${outcome.transactions} transaction${outcome.transactions === 1 ? "" : "s"} on ${name}.`
          : outcome.kind === "confirmed"
            ? `Your confirmation was added to the identical batch of ${outcome.calls} calls already queued in the Safe on ${name}.`
            : `Proposed to Safe as one batch of ${outcome.calls} call${outcome.calls === 1 ? "" : "s"} on ${name}.`;
      toast({
        title: outcome.kind === "sent" ? "Batch sent" : "Batch proposed",
        description: message,
      });
      onOpenChange(false);
    } catch (cause) {
      if (sent.current > 0) update(submitted.slice(sent.current));
      const message = formatWalletError(cause) || "Could not submit the batch.";
      setError(message);
      toast(
        isSafeProposalPendingError(cause)
          ? { title: "Safe proposal submitted", description: message }
          : { variant: "destructive", title: "Error", description: message },
      );
    } finally {
      setBusy(false);
      setActiveIndex(-1);
    }
  };

  const prompts =
    route?.kind === "eoa"
      ? steps.map((step) => ({ key: step.id, title: step.label, detail: describeStep(step) }))
      : [
          {
            key: "propose",
            title: "Propose batch to Safe",
            detail: `${steps.length} call${steps.length === 1 ? "" : "s"} execute together, in this order, once the Safe's approvals are in.`,
          },
        ];
  const from =
    route && route.kind !== "refused"
      ? route.kind === "safe-signer"
        ? route.safe
        : route.authority
      : (authority ?? address);
  const fromTag =
    route?.kind === "safe-signer" || route?.kind === "safe-app"
      ? "Safe"
      : route?.kind === "eoa"
        ? "EOA"
        : null;

  return (
    <TxConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title={`Batch on ${name}`}
      chainId={row.chainId}
      steps={prompts}
      activeIndex={busy ? activeIndex : -1}
      stepsIntro={
        route?.kind === "eoa"
          ? `Your wallet will ask for ${steps.length} transaction${steps.length === 1 ? "" : "s"}, in this order.`
          : "Your wallet will ask for one signature."
      }
      action={actionLabel(route, steps.length)}
      onConfirm={() => void confirm()}
      busy={busy}
      disabled={!route || route.kind === "refused" || !steps.length || problems.length > 0}
      status={status}
      error={error ?? (route?.kind === "refused" ? route.message : null)}
    >
      <SummaryRow label="On">{name}</SummaryRow>
      <SummaryRow label="From">
        {from ? (
          <span className="font-mono text-xs">
            {shortAddress(from)}
            {fromTag ? <span className="ml-1 font-sans text-zinc-500">{fromTag}</span> : null}
          </span>
        ) : (
          "Connect a wallet"
        )}
      </SummaryRow>
      <SummaryRow label="Route">{routeSummary(route, steps.length)}</SummaryRow>
      {steps.length ? (
        <ol className="space-y-2" aria-label="Batch steps">
          {steps.map((step, index) => {
            const problem = problems.find((item) => item.index === index);
            return (
              <li key={step.id} className="rounded border border-melon-200 bg-melon-50 p-3 text-xs">
                <div className="flex items-start gap-2">
                  <span
                    aria-hidden="true"
                    className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-zinc-300 text-zinc-500"
                  >
                    {index + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-zinc-900">
                      <span className="sr-only">
                        Step {index + 1} of {steps.length}:{" "}
                      </span>
                      {step.label}
                    </p>
                    <p className="text-zinc-500">{describeStep(step)}</p>
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <button
                      type="button"
                      aria-label={`Move step ${index + 1} up`}
                      className="h-6 w-6 border border-melon-300 bg-white hover:bg-melon-100 disabled:opacity-40"
                      disabled={busy || index === 0}
                      onClick={() => update(moveStep(steps, index, index - 1))}
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      aria-label={`Move step ${index + 1} down`}
                      className="h-6 w-6 border border-melon-300 bg-white hover:bg-melon-100 disabled:opacity-40"
                      disabled={busy || index === steps.length - 1}
                      onClick={() => update(moveStep(steps, index, index + 1))}
                    >
                      ↓
                    </button>
                    <button
                      type="button"
                      aria-label={`Remove step ${index + 1}`}
                      className="h-6 w-6 border border-melon-300 bg-white hover:bg-melon-100 disabled:opacity-40"
                      disabled={busy}
                      onClick={() => update(removeStep(steps, index))}
                    >
                      ✕
                    </button>
                  </div>
                </div>
                <DecodedCall step={step} />
                {problem ? (
                  <p role="alert" className="mt-2 text-red-600">
                    {problem.message}
                  </p>
                ) : null}
              </li>
            );
          })}
        </ol>
      ) : (
        <p className="text-sm text-zinc-500">Nothing is queued on {name}.</p>
      )}
    </TxConfirmDialog>
  );
}
