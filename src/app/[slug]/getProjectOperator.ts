import "server-only";

import { PermissionHoldersOperation } from "@/lib/bendystraw/operations";
import { queryBendystraw } from "@/lib/bendystraw/query.server";
import { fetchProfile } from "@/lib/profile";
import { pickRevnetOperator } from "@/lib/revnetOperator";
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

/**
 * The revnet's operator address, or null when the indexer answered and nobody
 * holds the role. A read failure throws: an outage is a different claim than
 * "no operator", and callers render it as unavailable rather than as absent.
 */
async function getProjectOperatorAddress(projectId: number, chainId: number) {
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

  return pickRevnetOperator(items);
}
