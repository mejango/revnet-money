import "server-only";

import { PermissionHoldersOperation } from "@/lib/bendystraw/operations";
import { queryBendystraw } from "@/lib/bendystraw/query.server";
import { fetchProfile } from "@/lib/profile";
import { unstable_cache } from "next/cache";

export const getProjectOperator = unstable_cache(
  async (projectId: number, chainId: number) => {
    const address = await getProjectOperatorAddress(projectId, chainId);
    return address ? await fetchProfile(address) : null;
  },
  ["project-operator"],
  {
    revalidate: 24 * 60 * 60, // 24 hours in seconds
  },
);

async function getProjectOperatorAddress(projectId: number, chainId: number) {
  try {
    const items: Array<{ operator: string; permissions: number[] | null }> = [];
    let totalCount = 0;
    do {
      const result = await queryBendystraw(chainId, PermissionHoldersOperation, {
        where: { chainId, projectId, version: 6, isRevnetOperator: true },
        limit: 250,
        offset: items.length,
      });
      const page = result.permissionHolders?.items ?? [];
      totalCount = result.permissionHolders?.totalCount ?? page.length;
      items.push(...page);
      if (!page.length) break;
    } while (items.length < totalCount);

    return items.find((item) => (item.permissions?.length ?? 0) > 0)?.operator ?? null;
  } catch (err) {
    console.error((err as Error).message);
    return null;
  }
}
