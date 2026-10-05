import "server-only";

import { PROJECT_HANDLE_CHAIN_ID, readExactProjectHandle } from "@/lib/projectHandles";
import { getViemPublicClient } from "@/lib/wagmiTransports";
import { unstable_cache } from "next/cache";
import { getIndexedProjectOperatorAddresses } from "./getProjectOperator";
import { getSuckerGroup } from "./getSuckerGroup";

/**
 * The verified handle names the revnet, so it is the canonical URL for every
 * route that reaches it — each chain's slug and the handle itself. The
 * registry keys handles by (chainId, projectId), so every deployment in the
 * group is checked, and only the operator (the callable authority) counts as
 * a trusted setter. handleOf() already enforces the bidirectional ENS check.
 */
async function readCanonicalHandle(
  chainId: number,
  projectId: number,
  suckerGroupId: string | null,
): Promise<string | null> {
  const operators = await getIndexedProjectOperatorAddresses(projectId, chainId).catch(() => []);
  if (!operators.length) return null;
  const deployments: [number, number][] = [[chainId, projectId]];
  if (suckerGroupId) {
    const group = await getSuckerGroup(suckerGroupId, chainId);
    for (const sibling of group?.projects?.items ?? []) {
      const pair: [number, number] = [Number(sibling.chainId), Number(sibling.projectId)];
      if (!deployments.some(([chain, id]) => chain === pair[0] && id === pair[1])) {
        deployments.push(pair);
      }
    }
  }
  const client = getViemPublicClient(PROJECT_HANDLE_CHAIN_ID);
  const handles = await Promise.all(
    deployments.flatMap(([chain, id]) =>
      operators.map((operator) => readExactProjectHandle(client, chain, id, operator)),
    ),
  );
  return handles.find((handle) => handle) ?? null;
}

export const lookupCanonicalHandle = unstable_cache(
  readCanonicalHandle,
  ["project-canonical-handle"],
  { revalidate: 900 },
);
