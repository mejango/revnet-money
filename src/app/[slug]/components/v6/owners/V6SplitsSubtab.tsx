"use client";

import { RESERVED_TOKEN_SPLIT_GROUP_ID } from "@/app/constants";
import { ChainLogo } from "@/components/ChainLogo";
import { EthereumAddress } from "@/components/EthereumAddress";
import { TableSkeleton } from "@/components/loading/LoadingSkeletons";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useAllRulesetsByChain } from "@/hooks/useAllRulesetsByChain";
import { useCompleteProjectPermissions } from "@/hooks/useCompleteBendystrawLists";
import { useJBChainId, useJBContractContext, useJBTokenContext } from "@/lib/nana/project";
import type { JBChainId } from "@/lib/nana/types";
import { pickRevnetOperator } from "@/lib/revnetOperator";
import { formatTokenSymbol } from "@/lib/utils";
import {
  formatUnits,
  JB_CHAINS,
  jbControllerAbi,
  JBCoreContracts,
  jbSplitsAbi,
  SPLITS_TOTAL_PERCENT,
} from "@bananapus/nana-sdk-core";
import { useState } from "react";
import { twJoin } from "tailwind-merge";
import { zeroAddress } from "viem";
import { useReadContracts } from "wagmi";
import { ChangeSplitRecipientsDialog } from "../../../owners/components/ChangeSplitRecipientsDialog";
import { DistributeReservedTokensButton } from "../../../owners/components/DistributeReservedTokensButton";
import { currentStageIndex, effectiveSplitPercent } from "../../../owners/components/splitsLib";
import { ProjectItem } from "../shared";

const BURN_SENTINEL = "0x000000000000000000000000000000000000dead";

type Split = {
  beneficiary: `0x${string}`;
  hook: `0x${string}`;
  percent: number;
};

/**
 * Splits subtab, every chain inline (jbm-v6 presentation, website/
 * renderOwnersSplits data): the operator, stage tabs, and per-chain split
 * tables for the selected stage. A split routed to a hook shows the hook's
 * address (the beneficiary is unused there); the 0xdead beneficiary is the
 * burn sentinel.
 */
export function V6SplitsSubtab({ projects }: { projects: ProjectItem[] }) {
  const { projectId, contractAddress } = useJBContractContext();
  const chainId = useJBChainId();
  const { token } = useJBTokenContext();
  const tokenSymbol = formatTokenSymbol(token);

  const [selectedStageIdx, setSelectedStageIdx] = useState(0);

  const chains = projects
    .filter((p) => Boolean(JB_CHAINS[p.chainId as JBChainId]))
    .map((p) => ({ chainId: p.chainId as JBChainId, projectId: p.projectId }));

  // The real operator (bendystraw permissionHolders isRevnetOperator) — NOT the
  // first split's beneficiary, which is zero when the split routes to a hook.
  const operatorQuery = useCompleteProjectPermissions({
    chainId: Number(chainId),
    projectId: Number(projectId),
    version: 6,
    isRevnetOperator: true,
  });
  const operator = pickRevnetOperator(operatorQuery.data ?? []);

  // Each chain's ruleset list (chronological). Stage tabs follow the context
  // chain; per-chain reads use each chain's own ruleset id at that index.
  const rulesetReads = useAllRulesetsByChain(chains);

  type RulesetRow = { id: number; start: number; metadata: bigint };
  const rulesetsByChain = new Map<number, RulesetRow[]>();
  chains.forEach((c) => {
    const result = rulesetReads.data?.[Number(c.chainId)];
    if (result) {
      rulesetsByChain.set(Number(c.chainId), result as unknown as RulesetRow[]);
    }
  });

  const homeRulesets = rulesetsByChain.get(Number(chainId)) ?? [];
  const currentStageIdx = currentStageIndex(homeRulesets);

  // Reserved percent (the stage's split limit) comes from the ruleset metadata:
  // bits 4-19 hold reservedPercent out of 10_000, so 2.5% is 250. It stays in
  // those units until the last division so fractional limits survive.
  const splitLimitBps = (() => {
    const metadata = homeRulesets[selectedStageIdx]?.metadata;
    if (metadata === undefined) return undefined;
    return (metadata >> 4n) & 0xffffn;
  })();
  const splitLimitLabel = splitLimitBps === undefined ? undefined : formatUnits(splitLimitBps, 2);

  // Only chains that actually HAVE a ruleset at the selected index can be read.
  // `useReadContracts` cannot disable an individual entry, so a `?? 0n` id would not
  // "disable the read" — it would execute `splitsOf(pid, 0, …)`, and ruleset 0 is the
  // FALLBACK group. Stage tabs index off the home chain's list, and another chain's list
  // can be shorter (or empty), so building the batch from the resolved ids is the only
  // way to keep a different group's recipients from rendering as this stage's splits.
  const readableChains = chains.filter(
    (c) => rulesetsByChain.get(Number(c.chainId))?.[selectedStageIdx] !== undefined,
  );
  const readIndexByChain = new Map(readableChains.map((c, index) => [Number(c.chainId), index]));

  // Per-chain splits + pending balances for the selected stage.
  const splitReads = useReadContracts({
    contracts: readableChains.flatMap((c) => {
      const ruleset = rulesetsByChain.get(Number(c.chainId))![selectedStageIdx];
      return [
        {
          chainId: c.chainId,
          address: contractAddress(JBCoreContracts.JBSplits, c.chainId),
          abi: jbSplitsAbi,
          functionName: "splitsOf" as const,
          args: [BigInt(c.projectId), BigInt(ruleset.id), RESERVED_TOKEN_SPLIT_GROUP_ID] as const,
        },
        {
          chainId: c.chainId,
          address: contractAddress(JBCoreContracts.JBController, c.chainId),
          abi: jbControllerAbi,
          functionName: "pendingReservedTokenBalanceOf" as const,
          args: [BigInt(c.projectId)] as const,
        },
      ];
    }),
    query: { enabled: readableChains.length > 0 },
  });

  if (rulesetReads.isLoading) return <TableSkeleton rows={4} columns={3} />;

  return (
    <div>
      <p className="text-md text-black font-light italic mb-2">
        Splits can be adjusted by the revnet operator at any time, within the permanent split limit
        of a stage.
      </p>

      <div className="text-sm font-medium text-zinc-500 mt-2 border-l border-zinc-300 pl-2 py-1">
        Revnet operator is currently{" "}
        {operator ? (
          <EthereumAddress
            address={operator as `0x${string}`}
            chain={chainId ? JB_CHAINS[chainId].chain : undefined}
            short
            withEnsName
          />
        ) : (
          <Skeleton className="inline-block h-3 w-28 align-middle" />
        )}
      </div>

      <div className="flex gap-4 my-2">
        {homeRulesets.map((ruleset, idx) => (
          <Button
            variant={selectedStageIdx === idx ? "tab-selected" : "bottomline"}
            className={twJoin("text-md text-zinc-400", selectedStageIdx === idx && "text-inherit")}
            key={String(ruleset.id)}
            onClick={() => setSelectedStageIdx(idx)}
          >
            Stage {idx + 1}
            {idx === currentStageIdx && (
              <span className="rounded-full h-2 w-2 bg-orange-400 border-[2px] border-orange-200 ml-1" />
            )}
          </Button>
        ))}
      </div>

      {splitLimitLabel !== undefined && (
        <div className="text-sm font-medium text-zinc-500 mb-4">
          The split limit for this stage is {splitLimitLabel}%
        </div>
      )}

      <div className="flex flex-col gap-6">
        {chains.map((c) => {
          const readIdx = readIndexByChain.get(Number(c.chainId));
          const hasStage = readIdx !== undefined;
          const splitsResult = hasStage ? splitReads.data?.[readIdx * 2] : undefined;
          const pendingResult = hasStage ? splitReads.data?.[readIdx * 2 + 1] : undefined;
          const splits =
            splitsResult?.status === "success" ? (splitsResult.result as readonly Split[]) : null;
          const pending =
            pendingResult?.status === "success" ? (pendingResult.result as bigint) : undefined;

          return (
            <div key={c.chainId}>
              <div className="flex items-center gap-2 mb-2 text-sm font-medium">
                <ChainLogo chainId={c.chainId} />
                {JB_CHAINS[c.chainId].name}
              </div>
              <div className="overflow-auto">
                <div>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-auto md:w-1/2">Account</TableHead>
                        <TableHead>Percentage</TableHead>
                        <TableHead>Pending splits</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {!hasStage ? (
                        <TableRow>
                          <TableCell colSpan={3} className="text-center text-zinc-400">
                            This chain has no stage {selectedStageIdx + 1}.
                          </TableCell>
                        </TableRow>
                      ) : splitReads.isLoading ? (
                        Array.from({ length: 3 }, (_, index) => (
                          <TableRow key={index}>
                            <TableCell>
                              <Skeleton className="h-3 w-32" />
                            </TableCell>
                            <TableCell>
                              <Skeleton className="h-3 w-24" />
                            </TableCell>
                            <TableCell>
                              <Skeleton className="h-3 w-28" />
                            </TableCell>
                          </TableRow>
                        ))
                      ) : !splits ? (
                        <TableRow>
                          <TableCell colSpan={3} className="text-center text-zinc-400">
                            Couldn&apos;t load this chain&apos;s splits.
                          </TableCell>
                        </TableRow>
                      ) : splits.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={3} className="text-center text-zinc-400">
                            No splits on this chain.
                          </TableCell>
                        </TableRow>
                      ) : (
                        splits.map((split, i) => {
                          const routesToHook = split.hook.toLowerCase() !== zeroAddress;
                          const isBurn = split.beneficiary.toLowerCase() === BURN_SENTINEL;
                          const shown = routesToHook ? split.hook : split.beneficiary;
                          return (
                            <TableRow key={`${shown}-${i}`}>
                              <TableCell>
                                <span className="inline-flex items-center gap-2 text-sm">
                                  <EthereumAddress
                                    address={shown}
                                    chain={JB_CHAINS[c.chainId].chain}
                                    short
                                    withEnsAvatar
                                    withEnsName
                                  />
                                  {routesToHook && <span className="text-zinc-400">(hook)</span>}
                                  {isBurn && !routesToHook && (
                                    <span className="text-zinc-400">(burn)</span>
                                  )}
                                </span>
                              </TableCell>
                              <TableCell>
                                {splitLimitBps !== undefined ? (
                                  <>
                                    {effectiveSplitPercent(BigInt(split.percent), splitLimitBps)}%
                                    <span className="text-zinc-500 ml-2">
                                      ({formatUnits(BigInt(split.percent), 7)}% of limit)
                                    </span>
                                  </>
                                ) : (
                                  `${formatUnits(BigInt(split.percent), 7)}% of limit`
                                )}
                              </TableCell>
                              <TableCell>
                                {pending !== undefined
                                  ? // THIS split's share of the chain's pending reserved
                                    // balance — the column previously repeated the chain
                                    // total on every row, so each looked like the whole.
                                    `${Number(
                                      formatUnits(
                                        (pending * BigInt(split.percent)) /
                                          BigInt(SPLITS_TOTAL_PERCENT),
                                        18,
                                      ),
                                    ).toLocaleString("en-US", {
                                      maximumFractionDigits: 2,
                                    })} ${tokenSymbol}`
                                  : "—"}
                              </TableCell>
                            </TableRow>
                          );
                        })
                      )}
                    </TableBody>
                  </Table>
                </div>
              </div>
              {pending !== undefined && pending > 0n && (
                <div className="mt-2">
                  <DistributeReservedTokensButton
                    chainId={c.chainId}
                    projectId={BigInt(c.projectId)}
                    pending={pending}
                    tokenSymbol={tokenSymbol}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>

      {chainId && homeRulesets[selectedStageIdx] && (
        <div className="mt-4">
          <ChangeSplitRecipientsDialog
            stageIdx={selectedStageIdx}
            initialChainId={chainId}
            splitLimit={splitLimitLabel === undefined ? undefined : `${splitLimitLabel}%`}
          />
        </div>
      )}
    </div>
  );
}
