"use client";

import { ChainLogo } from "@/components/ChainLogo";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useToast } from "@/components/ui/use-toast";
import {
  addStepsToBatch,
  clearBatch,
  composeBatch,
  contractAddressOn,
  describeStep,
  mirrorBatch,
  queuedBatchCalls,
  useSafeBatches,
  type BatchStep,
} from "@/lib/safe-batch";
import { stepResolverFor } from "@/lib/safe-batch-presets";
import { readBoundedSafeNonce } from "@/lib/cross-chain-authority";
import {
  listPendingSafeTransactions,
  safeQueueLink,
  safeTransactionLink,
  usableSafeConfirmations,
  type SafeQueuedTransaction,
} from "@/lib/safe-queue";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import type { Address } from "viem";
import { chainName, publicClientFor, type ChainProjectRow } from "./operatorLib";
import { OperatorSection } from "./OperatorSection";
import { SafeBatchDialog } from "./SafeBatchDialog";
import { SafeBatchPresetDialog } from "./SafeBatchPresetDialog";
import { useLiveRevnetOperators } from "./useLiveRevnetOperators";

/** The calls as an order-free key, so a reordered tray still matches its proposal. */
function callsKey(calls: readonly { to: Address; data: string; value: bigint }[]): string {
  return calls
    .map((call) => `${call.to.toLowerCase()}:${call.data.toLowerCase()}:${call.value}`)
    .sort()
    .join("|");
}

/** The pending Safe proposal whose MultiSend holds exactly these queued steps, if one is queued. */
function useProposedBatch(
  chainId: number,
  authority: Address | undefined,
  steps: readonly BatchStep[],
): SafeQueuedTransaction | null {
  const key = steps.length ? callsKey(composeBatch(steps).calls) : null;
  const query = useQuery({
    queryKey: ["revnet-safe-batch-proposed", chainId, authority, key],
    enabled: !!authority && !!key && !!safeQueueLink(chainId, authority),
    staleTime: 15_000,
    refetchInterval: 15_000,
    queryFn: async () => {
      const client = publicClientFor(chainId as ChainProjectRow["chainId"]);
      const nonce = await readBoundedSafeNonce(client, authority!);
      if (nonce === null) return null;
      const pending = await listPendingSafeTransactions(chainId, authority!, Number(nonce));
      return (
        pending.find((tx) => {
          const calls = queuedBatchCalls(tx);
          return !!calls && callsKey(calls) === key;
        }) ?? null
      );
    },
  });
  return query.data ?? null;
}

/**
 * The batch card at the top of the Operator tab: one tab per chain with
 * queued steps (review opens that chain's batch confirm), the presets, a copy
 * of the active chain's batch onto the project's other chains, and Clear.
 * Steps live in browser storage, so the card survives tab switches and reloads.
 */
export function SafeBatchTray({
  rows,
  fallbackOperator,
  fallbackProject,
}: {
  rows: ChainProjectRow[];
  fallbackOperator?: string;
  fallbackProject?: ChainProjectRow;
}) {
  const batches = useSafeBatches(rows);
  const { operatorByChain } = useLiveRevnetOperators(
    rows,
    fallbackProject ? { ...fallbackProject, address: fallbackOperator } : undefined,
  );
  const { toast } = useToast();
  const [dialog, setDialog] = useState<
    { kind: "batch"; chainId: number } | { kind: "presets" } | null
  >(null);
  const [mirroring, setMirroring] = useState(false);
  const [activeChainId, setActiveChainId] = useState<number | null>(null);

  const queued = rows.filter((row) => (batches.get(row.chainId)?.length ?? 0) > 0);
  const presetsAvailable = rows.some((row) =>
    contractAddressOn("JBBuybackHookRegistry", row.chainId),
  );
  // The batch shown in the active tab is the one mirrored to the other chains. Before a tab
  // is picked, the page's chain is "current" when it has steps; otherwise the first that does.
  const source =
    queued.find((row) => row.chainId === activeChainId) ??
    queued.find((row) => row.chainId === fallbackProject?.chainId) ??
    queued[0];
  const steps = source ? (batches.get(source.chainId) ?? []) : [];
  const sourceOperator = source ? operatorByChain.get(source.chainId) : undefined;
  const proposed = useProposedBatch(source?.chainId ?? 0, sourceOperator, steps);
  const proposedLink =
    proposed && source && sourceOperator && proposed.safeTxHash
      ? safeTransactionLink(source.chainId, sourceOperator, proposed.safeTxHash)
      : null;
  if (!queued.length && !presetsAvailable) return null;

  const mirror = async () => {
    if (!source || mirroring) return;
    setMirroring(true);
    try {
      const steps = batches.get(source.chainId) ?? [];
      const resolve = stepResolverFor((chainId) =>
        publicClientFor(chainId as ChainProjectRow["chainId"]),
      );
      const mirrored: string[] = [];
      const skipped: string[] = [];
      for (const row of rows) {
        if (row.chainId === source.chainId) continue;
        const result = await mirrorBatch(steps, source.chainId, row, resolve);
        if (result.steps.length) {
          addStepsToBatch(result.steps);
          mirrored.push(`${result.steps.length} to ${chainName(row.chainId)}`);
        }
        skipped.push(...result.skipped.map((item) => `${chainName(row.chainId)}: ${item.reason}`));
      }
      toast({
        title: "Copied to every chain",
        description: [
          mirrored.length
            ? `Mirrored from ${chainName(source.chainId)}: ${mirrored.join(", ")}.`
            : `Nothing could be mirrored from ${chainName(source.chainId)}.`,
          ...skipped.map((reason) => `Skipped ${reason}`),
        ].join(" "),
      });
    } finally {
      setMirroring(false);
    }
  };

  const batchRow =
    dialog?.kind === "batch" ? rows.find((row) => row.chainId === dialog.chainId) : null;


  return (
    <OperatorSection title="Batch">
      <p className="text-sm text-zinc-500">
        Actions you add with &ldquo;Add to batch&rdquo; queue here, one Safe proposal per chain.
        Nothing is sent until you review a chain&apos;s batch.
      </p>
      {queued.length && source ? (
        <>
          <div
            className="mt-3 flex gap-5 overflow-x-auto border-b border-zinc-200"
            role="tablist"
            aria-label="Queued chains"
          >
            {queued.map((row) => (
              <button
                key={row.chainId}
                type="button"
                role="tab"
                aria-selected={row.chainId === source.chainId}
                onClick={() => setActiveChainId(row.chainId)}
                className={`flex min-h-10 shrink-0 items-center gap-1.5 whitespace-nowrap border-b-2 text-sm font-medium transition-colors ${
                  row.chainId === source.chainId
                    ? "border-teal-600 text-teal-700"
                    : "border-transparent text-zinc-500 hover:text-zinc-900"
                }`}
              >
                <ChainLogo chainId={row.chainId} width={14} height={14} />
                {chainName(row.chainId)} ({batches.get(row.chainId)?.length ?? 0})
              </button>
            ))}
          </div>
          <div className="mt-3 border border-melon-200">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8">#</TableHead>
                  <TableHead>Action</TableHead>
                  <TableHead>Detail</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {steps.map((step, index) => (
                  <TableRow key={step.id}>
                    <TableCell className="text-zinc-500">{index + 1}</TableCell>
                    <TableCell className="whitespace-nowrap">{step.label}</TableCell>
                    <TableCell className="text-zinc-500">{describeStep(step)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          {proposed ? (
            <p className="mt-3 text-sm text-teal-700" role="status">
              Already proposed on {chainName(source.chainId)} as Safe transaction #
              {proposed.nonce}
              {proposed.confirmationsRequired
                ? ` (${usableSafeConfirmations(proposed).length}/${proposed.confirmationsRequired} signatures)`
                : ""}
              . Sign or execute it under Pending multisig transactions.{" "}
              {proposedLink ? (
                <a href={proposedLink} target="_blank" rel="noreferrer" className="underline">
                  Open in Safe ↗
                </a>
              ) : null}{" "}
              <button
                type="button"
                className="text-zinc-500 underline"
                onClick={() => clearBatch(source.chainId, source.projectId)}
              >
                Remove from the batch
              </button>
            </p>
          ) : (
            <Button
              className="mt-3"
              size="sm"
              onClick={() => setDialog({ kind: "batch", chainId: source.chainId })}
            >
              Review and propose on {chainName(source.chainId)}
            </Button>
          )}
        </>
      ) : (
        <p className="mt-3 text-sm text-zinc-500">
          Nothing queued. Add operator actions with &ldquo;Add to batch&rdquo; or start from a
          preset.
        </p>
      )}
      <div className="mt-3 flex flex-wrap gap-1">
        {presetsAvailable ? (
          <Button variant="ghost" size="sm" onClick={() => setDialog({ kind: "presets" })}>
            Start from a preset
          </Button>
        ) : null}
        {queued.length && rows.length > 1 && source ? (
          <Button variant="ghost" size="sm" disabled={mirroring} onClick={() => void mirror()}>
            {mirroring ? "Copying…" : `Copy the ${chainName(source.chainId)} batch to every chain`}
          </Button>
        ) : null}
        {queued.length ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => rows.forEach((row) => clearBatch(row.chainId, row.projectId))}
          >
            Clear all
          </Button>
        ) : null}
      </div>
      {batchRow ? (
        <SafeBatchDialog
          row={batchRow}
          authority={operatorByChain.get(batchRow.chainId)}
          open
          onOpenChange={(next) => {
            if (!next) setDialog(null);
          }}
        />
      ) : null}
      {dialog?.kind === "presets" ? (
        <SafeBatchPresetDialog
          rows={rows}
          open
          onOpenChange={(next) => {
            if (!next) setDialog(null);
          }}
        />
      ) : null}
    </OperatorSection>
  );
}
