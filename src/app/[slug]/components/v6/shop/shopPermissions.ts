import { jb721TiersHookAbi, type JBChainId } from "@bananapus/nana-sdk-core";
import { hasPermissions, JBPermissionIdsV6 } from "@bananapus/nana-sdk-core/v6";
import type { Address, PublicClient } from "viem";

/**
 * Mirrors JB721TiersHook's live adjustTiers authorization. This deliberately
 * reads the hook instead of relying on indexed project roles, which can lag and
 * do not include hook-level delegates.
 */
export async function canAdjust721Tiers(
  client: PublicClient,
  {
    chainId,
    projectId,
    hook,
    operator,
  }: {
    chainId: JBChainId;
    projectId: bigint;
    hook: Address;
    operator: Address;
  },
): Promise<boolean> {
  const owner = await client.readContract({
    address: hook,
    abi: jb721TiersHookAbi,
    functionName: "owner",
    args: [],
  });

  if (owner.toLowerCase() === operator.toLowerCase()) return true;

  return hasPermissions(client, {
    chainId,
    operator,
    account: owner,
    projectId,
    permissionIds: [JBPermissionIdsV6.ADJUST_721_TIERS],
  });
}
