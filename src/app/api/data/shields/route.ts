import { usdFromScaled } from "@/app/[slug]/components/v6/extras/projectPayers";
import { ShieldGroupOperation, ShieldProjectOperation } from "@/lib/bendystraw/operations";
import { queryBendystraw } from "@/lib/bendystraw/query.server";
import type { ShieldGroupQuery } from "@/lib/bendystraw/types";
import { deploymentTokenBalances, formatProjectPreviewBalance } from "@/lib/project-link-preview";
import { tokenKindOf } from "@/lib/tokenUtils";
import { NextResponse } from "next/server";
import { formatUnits } from "viem";

type ChainId = 1 | 10 | 8453 | 42161;
type ShieldDeployment = NonNullable<
  NonNullable<ShieldGroupQuery["suckerGroup"]>["projects"]
>["items"][number];

/** The deployments' holdings as one number, only when they hold a single kind of token. */
function singleTokenAmount(deployments: readonly ShieldDeployment[]): number | null {
  const rows = deployments.flatMap(deploymentTokenBalances);
  const kinds = new Set(rows.map(tokenKindOf));
  if (kinds.size !== 1 || !rows[0]?.tokenSymbol || rows[0].decimals == null) return null;
  const decimals = rows[0].decimals;
  return rows.reduce((sum, row) => sum + Number(formatUnits(BigInt(row.balance), decimals)), 0);
}

const JB_CHAINS: Record<ChainId, { name: string }> = {
  1: { name: "Ethereum" },
  10: { name: "Optimism" },
  8453: { name: "Base" },
  42161: { name: "Arbitrum" },
};

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const projectId = parseInt(searchParams.get("projectId") ?? "");

  const chainIdParam = searchParams.get("chainId");
  const parsedChainId = chainIdParam ? Number(chainIdParam) : undefined;
  if (parsedChainId !== undefined && !(parsedChainId in JB_CHAINS)) {
    return NextResponse.json({ error: "Unsupported chainId" }, { status: 400 });
  }
  const chainIds: ChainId[] =
    parsedChainId !== undefined
      ? [parsedChainId as ChainId]
      : (Object.keys(JB_CHAINS).map(Number) as ChainId[]);

  if (isNaN(projectId)) {
    return NextResponse.json({ error: "Missing or invalid projectId" }, { status: 400 });
  }

  let totalUsd: number | null = null;
  const deployments: ShieldDeployment[] = [];
  const results = [];
  let projectName = "Revnet"; // default fallback
  const visitedGroups = new Set<string>();

  for (const chainId of chainIds) {
    try {
      const project = await queryBendystraw(chainId, ShieldProjectOperation, {
        chainId,
        projectId,
      });
      const suckerGroupId = project.project?.suckerGroupId;
      if (!suckerGroupId) {
        return NextResponse.json({ error: "Project not found on BendyStraw" }, { status: 404 });
      }
      if (visitedGroups.has(suckerGroupId)) continue;
      visitedGroups.add(suckerGroupId);

      const surplus = await queryBendystraw(chainId, ShieldGroupOperation, { id: suckerGroupId });
      const items = surplus.suckerGroup?.projects?.items ?? [];
      const groupUsd = usdFromScaled(surplus.suckerGroup?.balanceUsd);
      if (groupUsd !== null) totalUsd = (totalUsd ?? 0) + groupUsd;

      projectName = items[0]?.name ?? projectName;
      for (const item of items) {
        deployments.push(item);
        results.push({
          chainId: item.chainId,
          balance: singleTokenAmount([item]),
          supporters: item.participants?.totalCount ?? 0,
          name: JB_CHAINS[item.chainId as ChainId]?.name ?? "Unknown",
          metadata: item.metadata,
          participants: item.participants?.items ?? [],
          // The list is capped; `supporters` above is the true count. Without this flag a
          // consumer reading `participants` has no way to tell a complete list from a page of
          // one — and this payload is public.
          participantsTruncated:
            (item.participants?.items?.length ?? 0) < (item.participants?.totalCount ?? 0),
        });
      }
    } catch {
      return NextResponse.json({ error: "Error fetching data" }, { status: 500 });
    }
  }

  // Each token is labeled in its own units; a treasury holding several has no one-token total.
  const totalBalance = singleTokenAmount(deployments);
  const denomination =
    totalBalance === null
      ? "tokens"
      : (deployments.flatMap(deploymentTokenBalances)[0]?.tokenSymbol ?? "tokens");

  const host = req.headers.get("host");
  if (!host) {
    return NextResponse.json({ error: "Missing host header" }, { status: 500 });
  }
  const publicBase = `https://${host}`;
  const publicUrl = `${publicBase}/api/data/shields?projectId=${projectId}${chainIds.length === 1 ? `&chainId=${chainIds[0]}` : ""}`;
  const badgeUrl = `https://img.shields.io/badge/dynamic/json?url=${encodeURIComponent(publicUrl)}&query=%24.message&label=${encodeURIComponent(projectName)}&cacheSeconds=3600`;

  const markdown = `[![revnet badge](${badgeUrl})](${publicBase}/base:${projectId})`;

  const balanceLabel = formatProjectPreviewBalance(deployments);
  const colorValue = totalBalance ?? totalUsd ?? 0;
  return NextResponse.json({
    label: "Current value",
    message:
      totalUsd !== null
        ? `${totalUsd.toLocaleString("en-US", { maximumFractionDigits: 0 })} USD • ${balanceLabel}`
        : balanceLabel,
    tvlUsd: totalUsd,
    /** The treasury in its one token, named by `denomination`; null when it holds several. */
    tvlBalance: totalBalance,
    denomination,
    color: colorValue > 1 ? "green" : colorValue > 0.1 ? "yellow" : "red",
    chains: results,
    badgeUrl,
    markdown,
  });
}
