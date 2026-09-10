"use client";

import { ChainLogo } from "@/components/ChainLogo";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/use-toast";
import {
  addStepsToBatch,
  clearBatch,
  contractAddressOn,
  mirrorBatch,
  useSafeBatches,
} from "@/lib/safe-batch";
import { stepResolverFor } from "@/lib/safe-batch-presets";
import { useState } from "react";
import { chainName, publicClientFor, type ChainProjectRow } from "./operatorLib";
import { SafeBatchDialog } from "./SafeBatchDialog";
import { SafeBatchPresetDialog } from "./SafeBatchPresetDialog";
import { useLiveRevnetOperators } from "./useLiveRevnetOperators";

/**
 * The queued-steps strip at the top of the Operator tab: one chip per chain
 * with steps (opens that chain's batch confirm), the presets, a mirror of the
 * current chain's batch onto the project's other chains, and Clear. Steps
 * live in browser storage, so the strip survives tab switches and reloads.
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

  const queued = rows.filter((row) => (batches.get(row.chainId)?.length ?? 0) > 0);
  const presetsAvailable = rows.some((row) =>
    contractAddressOn("JBBuybackHookRegistry", row.chainId),
  );
  if (!queued.length && !presetsAvailable) return null;

  // The page's chain is "current" when it has steps; otherwise the first chain that does.
  const source = queued.find((row) => row.chainId === fallbackProject?.chainId) ?? queued[0];

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
        title: "Same on every chain",
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
    <div
      className="flex max-w-screen-sm flex-wrap items-center gap-2 border border-melon-200 bg-white p-3"
      aria-label="Batch"
    >
      <span className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Batch</span>
      {queued.length ? (
        queued.map((row) => {
          const count = batches.get(row.chainId)?.length ?? 0;
          return (
            <Button
              key={row.chainId}
              variant="secondary"
              size="sm"
              className="gap-1.5"
              onClick={() => setDialog({ kind: "batch", chainId: row.chainId })}
            >
              <ChainLogo chainId={row.chainId} width={14} height={14} />
              {count} queued · {chainName(row.chainId)}
            </Button>
          );
        })
      ) : (
        <span className="text-sm text-zinc-500">Nothing queued.</span>
      )}
      <span className="ml-auto flex flex-wrap gap-1">
        {presetsAvailable ? (
          <Button variant="ghost" size="sm" onClick={() => setDialog({ kind: "presets" })}>
            Presets
          </Button>
        ) : null}
        {queued.length && rows.length > 1 ? (
          <Button variant="ghost" size="sm" disabled={mirroring} onClick={() => void mirror()}>
            Same on every chain
          </Button>
        ) : null}
        {queued.length ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => rows.forEach((row) => clearBatch(row.chainId, row.projectId))}
          >
            Clear
          </Button>
        ) : null}
      </span>
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
    </div>
  );
}
