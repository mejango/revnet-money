"use client";

import { ChainLogo } from "@/components/ChainLogo";
import { SkeletonLines } from "@/components/ui/skeleton";
import { dedupeToHighestVersion, projectRefKey, projectRefsWhere } from "@/lib/accountHoldings";
import {
  AccountTokenBalancesOperation,
  ProjectsByOwnerOperation,
  useBendystrawQuery,
} from "@/lib/bendystraw";
import type { AccountTokenBalanceRow, OwnedProjectRow } from "@/lib/bendystraw/types";
import type { JBChainId } from "@/lib/nana/types";
import { slugFor } from "@/lib/slug";
import { formatTokenSymbol } from "@/lib/utils";
import { formatUnits, JB_CHAINS } from "@bananapus/nana-sdk-core";
import Link from "next/link";
import { useMemo } from "react";
import type { Address } from "viem";
import { mainnet } from "viem/chains";

const FETCH_LIMIT = 1000;

type HoldingRow = AccountTokenBalanceRow & { project: OwnedProjectRow | undefined };

type HoldingGroup = {
  key: string;
  name: string;
  /** The v6 project route when the group has one — this app routes v6 in-site. */
  slug: string | undefined;
  /** Highest version in the group, badged when there's no v6 route. */
  version: number;
  symbol: string;
  total: bigint;
  rows: HoldingRow[];
};

/**
 * Group deduped balances by project across chains (sucker group when the
 * indexer knows it), newest-biggest first.
 */
function groupHoldings(rows: HoldingRow[]): HoldingGroup[] {
  const groups = new Map<string, HoldingGroup>();
  for (const row of rows) {
    const key = row.project?.suckerGroupId ?? `${row.chainId}:${row.projectId}:${row.version}`;
    const group = groups.get(key) ?? {
      key,
      name: `Project #${row.projectId}`,
      slug: undefined,
      version: row.version,
      symbol: "tokens",
      total: 0n,
      rows: [],
    };
    if (row.project?.name || row.project?.handle) {
      group.name = row.project.name ?? row.project.handle ?? group.name;
    }
    if (row.project?.tokenSymbol) group.symbol = formatTokenSymbol(row.project.tokenSymbol);
    if (row.version === 6) group.slug ??= slugFor(row.chainId, row.projectId);
    group.version = Math.max(group.version, row.version);
    group.total += BigInt(row.balance);
    group.rows.push(row);
    groups.set(key, group);
  }
  return [...groups.values()]
    .map((group) => ({
      ...group,
      rows: [...group.rows].sort((a, b) => a.chainId - b.chainId),
    }))
    .sort((a, b) => (b.total > a.total ? 1 : b.total < a.total ? -1 : 0));
}

export function TokenHoldings({ address }: { address: Address }) {
  const balancesQuery = useBendystrawQuery(
    AccountTokenBalancesOperation,
    { account: address.toLowerCase(), limit: FETCH_LIMIT },
    { chainId: mainnet.id },
  );

  // Balance rows duplicate per indexed protocol version — keep the highest
  // version per (chainId, projectId).
  const holdings = useMemo(
    () =>
      dedupeToHighestVersion(
        (balancesQuery.data?.participants.items ?? []).filter(
          (row) => !!JB_CHAINS[row.chainId as JBChainId] && BigInt(row.balance) > 0n,
        ),
      ),
    [balancesQuery.data],
  );

  // Name/symbol/sucker-group lookup for exactly the held (chainId, projectId,
  // version) refs — projectId alone names different projects across versions.
  const refsWhere = useMemo(() => projectRefsWhere(holdings), [holdings]);
  const projectsQuery = useBendystrawQuery(
    ProjectsByOwnerOperation,
    { where: refsWhere ?? {} },
    { chainId: mainnet.id, enabled: !!refsWhere },
  );
  const projectByRef = useMemo(() => {
    const map = new Map<string, OwnedProjectRow>();
    for (const project of projectsQuery.data?.projects.items ?? []) {
      map.set(projectRefKey(project), project);
    }
    return map;
  }, [projectsQuery.data]);

  const groups = useMemo(
    () =>
      groupHoldings(
        holdings.map((row) => ({ ...row, project: projectByRef.get(projectRefKey(row)) })),
      ),
    [holdings, projectByRef],
  );

  const isLoading = balancesQuery.isLoading || (holdings.length > 0 && projectsQuery.isLoading);

  return (
    <section>
      <h2 className="mb-2 text-base font-semibold text-zinc-700">Tokens</h2>
      {isLoading ? (
        <SkeletonLines lines={3} className="mt-3" />
      ) : balancesQuery.isError ? (
        <p className="text-sm text-zinc-500">Could not read token balances.</p>
      ) : groups.length === 0 ? (
        <p className="text-sm text-zinc-500">This account holds no project tokens.</p>
      ) : (
        <div className="divide-y divide-melon-200 bg-melon-50 px-4">
          {groups.map((group) => (
            <div key={group.key} className="py-3">
              <div className="flex flex-wrap items-center gap-2">
                {group.slug ? (
                  <Link href={`/${group.slug}`} className="text-sm font-medium hover:underline">
                    {group.name}
                  </Link>
                ) : (
                  <span className="text-sm font-medium">{group.name}</span>
                )}
                {group.slug ? null : (
                  <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] font-medium text-zinc-600">
                    V{group.version}
                  </span>
                )}
              </div>
              <div className="mt-1.5 flex flex-col gap-1">
                {group.rows.map((row) => (
                  <div
                    key={`${row.chainId}:${row.projectId}:${row.version}`}
                    className="flex items-center justify-between gap-3 text-sm"
                  >
                    <span className="flex items-center gap-2 text-xs text-zinc-500">
                      <ChainLogo chainId={row.chainId as JBChainId} width={16} height={16} />
                      {JB_CHAINS[row.chainId as JBChainId]?.name ?? `Chain ${row.chainId}`}
                    </span>
                    <span className="tabular-nums text-zinc-800">
                      {formatUnits(BigInt(row.balance), 18, { fractionDigits: 5 })} {group.symbol}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
