import { usdFromScaled } from "@/app/[slug]/components/v6/extras/projectPayers";
import { ShieldGroupOperation, ShieldProjectOperation } from "@/lib/bendystraw/operations";
import { queryBendystraw } from "@/lib/bendystraw/query.server";
import type { ShieldGroupQuery } from "@/lib/bendystraw/types";
import { deploymentTokenBalances, formatProjectPreviewBalance } from "@/lib/project-link-preview";
import { slugFor } from "@/lib/slug";
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

/** Each token one deployment holds, in its own units, for consumers that need more than the label. */
function tokenBalances(deployment: ShieldDeployment) {
  return deploymentTokenBalances(deployment).flatMap((row) =>
    row.token && row.decimals != null
      ? [
          {
            token: row.token,
            tokenSymbol: row.tokenSymbol ?? null,
            balance: Number(formatUnits(BigInt(row.balance), row.decimals)),
            balanceUsd: usdFromScaled(row.balanceUsd),
          },
        ]
      : [],
  );
}

// The badge links to this chain's project page when no chainId is given.
const DEFAULT_CHAIN_ID: ChainId = 8453;

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const projectId = parseInt(searchParams.get("projectId") ?? "");

  const chainIdParam = searchParams.get("chainId");
  const chainId = chainIdParam ? Number(chainIdParam) : DEFAULT_CHAIN_ID;
  if (!(chainId in JB_CHAINS)) {
    return NextResponse.json({ error: "Unsupported chainId" }, { status: 400 });
  }

  if (isNaN(projectId)) {
    return NextResponse.json({ error: "Missing or invalid projectId" }, { status: 400 });
  }

  // One project: its sucker group already spans every chain it is deployed on. The same
  // project number on another chain is usually a different project.
  let items: ShieldDeployment[];
  let totalUsd: number | null;
  try {
    const project = await queryBendystraw(chainId, ShieldProjectOperation, { chainId, projectId });
    const suckerGroupId = project.project?.suckerGroupId;
    if (!suckerGroupId) {
      return NextResponse.json({ error: "Project not found on BendyStraw" }, { status: 404 });
    }
    const group = await queryBendystraw(chainId, ShieldGroupOperation, { id: suckerGroupId });
    items = group.suckerGroup?.projects?.items ?? [];
    totalUsd = usdFromScaled(group.suckerGroup?.balanceUsd);
  } catch {
    return NextResponse.json({ error: "Error fetching data" }, { status: 500 });
  }

  const projectName = items[0]?.name ?? "Revnet";
  const results = items.map((item) => ({
    chainId: item.chainId,
    balance: singleTokenAmount([item]),
    balances: tokenBalances(item),
    supporters: item.participants?.totalCount ?? 0,
    name: JB_CHAINS[item.chainId as ChainId]?.name ?? "Unknown",
    metadata: item.metadata,
    participants: item.participants?.items ?? [],
    // The list is capped; `supporters` above is the true count. Without this flag a
    // consumer reading `participants` has no way to tell a complete list from a page of
    // one — and this payload is public.
    participantsTruncated:
      (item.participants?.items?.length ?? 0) < (item.participants?.totalCount ?? 0),
  }));

  // Each token is labeled in its own units; a treasury holding several has no one-token total.
  const totalBalance = singleTokenAmount(items);
  const denomination =
    totalBalance === null
      ? "tokens"
      : (items.flatMap(deploymentTokenBalances)[0]?.tokenSymbol ?? "tokens");

  const host = req.headers.get("host");
  if (!host) {
    return NextResponse.json({ error: "Missing host header" }, { status: 500 });
  }
  const publicBase = `https://${host}`;
  const publicUrl = `${publicBase}/api/data/shields?projectId=${projectId}&chainId=${chainId}`;
  const badgeUrl = `https://img.shields.io/badge/dynamic/json?url=${encodeURIComponent(publicUrl)}&query=%24.message&label=${encodeURIComponent(projectName)}&cacheSeconds=3600`;

  const markdown = `[![revnet badge](${badgeUrl})](${publicBase}/${slugFor(chainId, projectId)})`;

  const balanceLabel = formatProjectPreviewBalance(items);
  return NextResponse.json({
    label: "Current value",
    message:
      totalUsd !== null
        ? `${totalUsd.toLocaleString("en-US", { maximumFractionDigits: 0 })} USD • ${balanceLabel}`
        : balanceLabel,
    tvlUsd: totalUsd,
    /** The treasury in its one token, named by `denomination`; null when it holds several (see `chains[].balances`). */
    tvlBalance: totalBalance,
    denomination,
    color: badgeColor(totalUsd, totalBalance),
    chains: results,
    badgeUrl,
    markdown,
  });
}

/**
 * Green, yellow or red by the treasury's USD value, so every token is judged on one
 * scale. ponytail: thresholds are round numbers, not tuned. A treasury the indexer has not
 * priced falls back to its one-token amount (1 and 0.1 whole tokens, as before).
 */
function badgeColor(usd: number | null, oneTokenAmount: number | null) {
  if (usd !== null) return usd >= 1000 ? "green" : usd >= 100 ? "yellow" : "red";
  const amount = oneTokenAmount ?? 0;
  return amount > 1 ? "green" : amount > 0.1 ? "yellow" : "red";
}
