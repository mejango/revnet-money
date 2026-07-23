"use client";

import { MAX_RULESET_COUNT } from "@/app/constants";
import { ButtonWithWallet } from "@/components/ButtonWithWallet";
import { ChainLogo } from "@/components/ChainLogo";
import { EthereumAddress } from "@/components/EthereumAddress";
import EtherscanLink from "@/components/EtherscanLink";
import { TableSkeleton } from "@/components/loading/LoadingSkeletons";
import { CheckIcon } from "@/components/ui/icons";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { toast } from "@/components/ui/use-toast";
import {
  submittedViaSafe,
  useWaitForTransactionReceipt,
  useWriteContract,
} from "@/hooks/useReviewedWriteContract";
import {
  useBendystrawQuery,
  V6AutoIssueEventsOperation,
  V6StoredAutoIssuancesOperation,
} from "@/lib/bendystraw";
import { formatShortDateTime } from "@/lib/date";
import { useJBContractContext, useJBTokenContext } from "@/lib/nana/project";
import type { JBChainId } from "@/lib/nana/types";
import { commaNumber } from "@/lib/number";
import { formatTokenSymbol } from "@/lib/utils";
import { formatUnits, JB_CHAINS, JBCoreContracts, jbRulesetsAbi } from "@bananapus/nana-sdk-core";
import { buildAutoIssueTx } from "@bananapus/nana-sdk-core/v6";
import { useEffect, useState } from "react";
import { useReadContracts } from "wagmi";
import { ProjectItem } from "../shared";

/**
 * Auto issuance across every chain in the group: Chain | Stage | Account |
 * Amount | Unlock date | Distribute. Stage numbers and unlock dates come from
 * each CHAIN'S OWN ruleset ids (they differ per chain even when the stages are
 * economically aligned).
 */
export function V6AutoIssuanceSubtab({ projects }: { projects: ProjectItem[] }) {
  const { contractAddress } = useJBContractContext();
  const { token } = useJBTokenContext();
  const tokenSymbol = formatTokenSymbol(token);
  const now = Math.floor(Date.now() / 1000);

  const chains = projects
    .filter((p) => Boolean(JB_CHAINS[p.chainId as JBChainId]))
    .map((p) => ({ chainId: p.chainId as JBChainId, projectId: p.projectId }));

  // One project can have different ids per chain — OR the exact pairs.
  const where = {
    version: 6,
    OR: chains.map((c) => ({ chainId: Number(c.chainId), projectId: c.projectId })),
  };
  const stored = useBendystrawQuery(
    V6StoredAutoIssuancesOperation,
    { where },
    { enabled: chains.length > 0, chainId: Number(chains[0]?.chainId ?? 1) },
  );
  const issued = useBendystrawQuery(
    V6AutoIssueEventsOperation,
    { where },
    { enabled: chains.length > 0, chainId: Number(chains[0]?.chainId ?? 1) },
  );

  // Each chain's ruleset list, chronological, for stage numbers + unlock dates.
  const rulesetReads = useReadContracts({
    contracts: chains.map((c) => ({
      chainId: c.chainId,
      address: contractAddress(JBCoreContracts.JBRulesets, c.chainId),
      abi: jbRulesetsAbi,
      functionName: "allOf" as const,
      args: [BigInt(c.projectId), 0n, BigInt(MAX_RULESET_COUNT)] as const,
    })),
    query: { enabled: chains.length > 0 },
  });
  const rulesetsByChain = new Map<number, { id: number; start: number }[]>();
  chains.forEach((c, i) => {
    const result = rulesetReads.data?.[i];
    if (result?.status === "success") {
      rulesetsByChain.set(
        Number(c.chainId),
        (result.result as readonly { id: number; start: number }[]).slice().reverse(),
      );
    }
  });

  const [pendingId, setPendingId] = useState<string | null>(null);
  const { writeContractAsync, isPending, data: txHash } = useWriteContract();
  const { isLoading: isTxLoading, isSuccess } = useWaitForTransactionReceipt({ hash: txHash });

  useEffect(() => {
    if (isSuccess) {
      toast({ title: "Auto issuance distributed!", description: "Transaction confirmed." });
      setPendingId(null);
      issued.refetch();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSuccess]);

  const rows = (stored.data?.storeAutoIssuanceAmountEvents.items ?? [])
    .map((row) => {
      const rulesets = rulesetsByChain.get(row.chainId) ?? [];
      const stageIdx = rulesets.findIndex((r) => String(r.id) === row.stageId);
      const distributed = issued.data?.autoIssueEvents.items.find(
        (event) =>
          event.chainId === row.chainId &&
          event.stageId === row.stageId &&
          event.beneficiary.toLowerCase() === row.beneficiary.toLowerCase() &&
          event.count === row.count,
      );
      return {
        ...row,
        stage: stageIdx >= 0 ? stageIdx + 1 : undefined,
        startsAt: stageIdx >= 0 ? Number(rulesets[stageIdx].start) : undefined,
        distributedTxn: distributed ? distributed.id.split("-")[1] : undefined,
      };
    })
    .sort((a, b) => (a.stage ?? 99) - (b.stage ?? 99) || a.chainId - b.chainId);

  if (stored.isLoading || rulesetReads.isLoading) {
    return <TableSkeleton rows={4} columns={6} />;
  }
  if (rows.length === 0) return <div className="text-center text-zinc-400">No auto issuances</div>;

  return (
    <div>
      <p className="text-md text-black font-light italic mb-2">
        Auto issuance mints a fixed amount to a preset account when a stage starts. Anyone can
        trigger the distribution once its unlock date passes.
      </p>
      <div className="mb-4 max-h-96 overflow-auto">
        <div className="flex flex-col">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Chain</TableHead>
                <TableHead>Stage</TableHead>
                <TableHead>Account</TableHead>
                <TableHead>Amount</TableHead>
                <TableHead>Unlock date</TableHead>
                <TableHead>Distribute</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell>
                    <ChainLogo chainId={row.chainId as JBChainId} />
                  </TableCell>
                  <TableCell>{row.stage ?? "—"}</TableCell>
                  <TableCell>
                    <EthereumAddress
                      address={row.beneficiary as `0x${string}`}
                      chain={JB_CHAINS[row.chainId as JBChainId]?.chain}
                      short
                      withEnsAvatar
                      withEnsName
                    />
                  </TableCell>
                  <TableCell>
                    {commaNumber(formatUnits(BigInt(row.count), 18))} {tokenSymbol}
                  </TableCell>
                  <TableCell>
                    {row.startsAt ? formatShortDateTime(row.startsAt * 1000) : "—"}
                  </TableCell>
                  <TableCell>
                    {row.distributedTxn ? (
                      <div className="flex items-center gap-1 text-zinc-400">
                        <EtherscanLink
                          value={row.distributedTxn}
                          type="tx"
                          chain={JB_CHAINS[row.chainId as JBChainId]?.chain}
                          truncateTo={4}
                        />
                        <CheckIcon className="w-4 h-4 text-teal-500" />
                      </div>
                    ) : (
                      <ButtonWithWallet
                        targetChainId={row.chainId as JBChainId}
                        variant="outline"
                        size="sm"
                        disabled={(row.startsAt ?? 0) >= now}
                        loading={(isPending || isTxLoading) && pendingId === row.id}
                        onClick={async () => {
                          setPendingId(row.id);
                          try {
                            const hash = await writeContractAsync(
                              buildAutoIssueTx({
                                chainId: row.chainId as JBChainId,
                                revnetId: BigInt(row.projectId),
                                stageId: BigInt(row.stageId),
                                beneficiary: row.beneficiary as `0x${string}`,
                              }),
                            );
                            if (submittedViaSafe(hash)) {
                              toast({
                                title: "Safe proposal submitted",
                                description:
                                  "Auto issuance is awaiting Safe approvals and execution.",
                              });
                              setPendingId(null);
                            }
                          } catch (error) {
                            toast({
                              variant: "destructive",
                              title: "Could not distribute auto issuance",
                              description: error instanceof Error ? error.message : "Unknown error",
                            });
                            setPendingId(null);
                          }
                        }}
                      >
                        {(row.startsAt ?? 0) >= now ? "Locked" : "Distribute"}
                      </ButtonWithWallet>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>
    </div>
  );
}
