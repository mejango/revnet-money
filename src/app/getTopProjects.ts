import { TopSuckerGroupsOperation } from "@/lib/bendystraw/operations";
import { queryBendystraw } from "@/lib/bendystraw/query.server";
import type { TopSuckerGroupsQuery } from "@/lib/bendystraw/types";
import { fetchEthPrice } from "@/lib/ethPrice";
import { ipfsUriToGatewayUrl } from "@/lib/ipfs";
import { JB_CHAINS, JBChainId } from "@bananapus/nana-sdk-core";
import { unstable_cache } from "next/cache";
import { formatUnits } from "viem";
import { mainnet } from "viem/chains";

export async function getTopProjects() {
  let top: TopSuckerGroupsQuery;
  try {
    top = await fetchTopProjects();
  } catch (error) {
    // Bendystraw is a derivative view. Its availability must never make the
    // canonical landing page unavailable or prevent a production build.
    console.error("Failed to load top projects:", error);
    return [];
  }

  const needsEthPrice = top.suckerGroups.items.some(
    (group) =>
      group.projects?.items[0]?.isRevnet &&
      group.projects.items[0].tokenSymbol?.toUpperCase() === "ETH",
  );
  let ethPrice = 0;
  if (needsEthPrice) {
    try {
      ethPrice = await fetchEthPrice();
    } catch (error) {
      console.error("Failed to load the ETH price for top projects:", error);
      return [];
    }
  }

  return top.suckerGroups.items
    .map((group) => {
      const project = group.projects?.items[0];
      if (!project || !project.isRevnet) return null;

      const symbol = project.tokenSymbol?.toUpperCase();
      if (symbol !== "ETH" && symbol !== "USDC") return null;

      const balance = Number(formatUnits(BigInt(group.balance), project.decimals ?? 18));
      const balanceUsd = symbol === "ETH" ? balance * ethPrice : balance;

      return { project, balanceUsd };
    })
    .filter((item) => item !== null)
    .sort((a, b) => b.balanceUsd - a.balanceUsd)
    .slice(0, 10)
    .map((item, index) => {
      const { project, balanceUsd } = item;
      const chainId = project.chainId as JBChainId;

      return {
        rank: index + 1,
        projectId: project.projectId,
        chainId: chainId,
        chainSlug: JB_CHAINS[chainId]?.slug ?? "eth",
        name: project.name ?? `Project #${project.projectId}`,
        tagline: project.projectTagline,
        logoUrl: project.logoUri ? (ipfsUriToGatewayUrl(project.logoUri) ?? null) : null,
        balanceUsd,
      };
    });
}

const fetchTopProjects = unstable_cache(
  async () => queryBendystraw(mainnet.id, TopSuckerGroupsOperation, {}),
  ["top-projects-v2"],
  { revalidate: 600 }, // 10 minutes
);
