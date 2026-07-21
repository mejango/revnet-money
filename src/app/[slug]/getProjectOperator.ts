import "server-only";

import {
  ProjectOperatorDocument,
  ProjectOperatorQuery,
  ProjectOperatorQueryVariables,
} from "@/generated/graphql";
import { getBendystrawClient } from "@/graphql/bendystrawClient";
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
    const client = getBendystrawClient(chainId);
    const result = await client.request<ProjectOperatorQuery, ProjectOperatorQueryVariables>(
      ProjectOperatorDocument,
      { chainId, projectId, version: 6 },
    );

    return result.permissionHolders?.items?.[0]?.operator ?? null;
  } catch (err) {
    console.error((err as any).message);
    return null;
  }
}
