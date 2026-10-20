import { usdFromScaled } from "@/app/[slug]/components/v6/extras/projectPayers";
import { TopSuckerGroupsOperation } from "@/lib/bendystraw/operations";
import { queryBendystraw } from "@/lib/bendystraw/query.server";
import type { TopSuckerGroupsQuery } from "@/lib/bendystraw/types";
import { mainnet } from "@/lib/chains";
import { ipfsUriToAppUrl } from "@/lib/ipfs";
import { getIssuanceFingerprint } from "@/lib/issuanceFingerprint.server";
import { fillIndexedMetadata } from "@/lib/projectMetadataFill.server";
import { JB_CHAINS, JBChainId } from "@bananapus/nana-sdk-core";
import { unstable_cache } from "next/cache";

export async function getTopProjects(limit = 8, offset = 0) {
  let top: TopSuckerGroupsQuery;
  try {
    top = await fetchTopProjects();
  } catch (error) {
    // Bendystraw is a derivative view. Its availability must never make the
    // canonical landing page unavailable or prevent a production build.
    console.error("Failed to load top projects:", error);
    return [];
  }

  const ranked = top.suckerGroups.items
    .map((group) => {
      const project = group.projects?.items[0];
      const balanceUsd = usdFromScaled(group.balanceUsd);
      if (!project?.isRevnet || balanceUsd === null) return null;
      return { project, balanceUsd };
    })
    .filter((item) => item !== null)
    .sort((a, b) => b.balanceUsd - a.balanceUsd)
    .slice(offset, offset + limit);

  const projects = await fillIndexedMetadata(ranked.map((item) => item.project));

  return Promise.all(
    ranked.map(async ({ balanceUsd }, index) => {
      const project = projects[index]!;
      const chainId = project.chainId as JBChainId;

      return {
        rank: offset + index + 1,
        projectId: project.projectId,
        chainId: chainId,
        chainSlug: JB_CHAINS[chainId]?.slug ?? "eth",
        name: project.name ?? `Project #${project.projectId}`,
        tagline: project.projectTagline ?? null,
        logoUri: ipfsUriToAppUrl(project.logoUri) ? project.logoUri : null,
        balanceUsd,
        issuanceFingerprint: await getIssuanceFingerprint(project.projectId, chainId),
      };
    }),
  );
}

const fetchTopProjects = unstable_cache(
  async () => {
    const items: TopSuckerGroupsQuery["suckerGroups"]["items"] = [];
    let totalCount = 0;
    do {
      const page = await queryBendystraw(mainnet.id, TopSuckerGroupsOperation, {
        limit: 1000,
        offset: items.length,
      });
      const pageItems = page.suckerGroups.items ?? [];
      totalCount = page.suckerGroups.totalCount ?? pageItems.length;
      items.push(...pageItems);
      if (!pageItems.length) break;
    } while (items.length < totalCount);
    return { suckerGroups: { items, totalCount } };
  },
  ["top-projects-v4"],
  { revalidate: 600 }, // 10 minutes
);

export async function getHomepageSuckerGroups() {
  try {
    return (await fetchTopProjects()).suckerGroups.items;
  } catch {
    return [];
  }
}
