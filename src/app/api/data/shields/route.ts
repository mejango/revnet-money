import { ShieldGroupOperation, ShieldProjectOperation } from "@/lib/bendystraw/operations";
import { queryBendystraw } from "@/lib/bendystraw/query.server";
import { NextResponse } from "next/server";

type ChainId = 1 | 10 | 8453 | 42161;

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

  let totalBalance = 0;
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

      projectName = items[0]?.name ?? projectName;
      for (const item of items) {
        const itemBalance = Number(item.balance ?? 0) / 1e18;
        totalBalance += itemBalance;

        results.push({
          chainId: item.chainId,
          balance: itemBalance,
          supporters: item.participants?.totalCount ?? 0,
          name: JB_CHAINS[item.chainId as ChainId]?.name ?? "Unknown",
          metadata: item.metadata,
          participants: item.participants?.items ?? [],
        });
      }
    } catch {
      return NextResponse.json({ error: "Error fetching data" }, { status: 500 });
    }
  }

  // Fetch ETH price
  let ethPrice = 0;
  try {
    const priceRes = await fetch(
      "https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd",
    );
    const priceJson = await priceRes.json();
    ethPrice = priceJson.ethereum.usd;
  } catch {}

  const usdTvl = totalBalance * ethPrice;

  const host = req.headers.get("host");
  if (!host) {
    return NextResponse.json({ error: "Missing host header" }, { status: 500 });
  }
  const publicBase = `https://${host}`;
  const publicUrl = `${publicBase}/api/data/shields?projectId=${projectId}${chainIds.length === 1 ? `&chainId=${chainIds[0]}` : ""}`;
  const badgeUrl = `https://img.shields.io/badge/dynamic/json?url=${encodeURIComponent(publicUrl)}&query=%24.message&label=${encodeURIComponent(projectName)}&cacheSeconds=3600`;

  const markdown = `[![revnet badge](${badgeUrl})](${publicBase}/base:${projectId})`;

  return NextResponse.json({
    label: "Current value",
    message: `${usdTvl.toLocaleString("en-US", { maximumFractionDigits: 0 })} USD • ${totalBalance.toFixed(4)} ETH`,
    tvlUsd: usdTvl,
    tvlEth: totalBalance,
    color: totalBalance > 1 ? "green" : totalBalance > 0.1 ? "yellow" : "red",
    chains: results,
    badgeUrl,
    markdown,
  });
}
