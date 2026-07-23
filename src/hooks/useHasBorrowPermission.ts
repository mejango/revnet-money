import { HasPermissionOperation, useBendystrawQuery } from "@/lib/bendystraw";
import { getRevnetLoanContract, JBChainId } from "@bananapus/nana-sdk-core";

export function useHasBorrowPermission({
  address,
  projectId,
  chainId,
  resolvedPermissionsAddress,
  skip,
}: {
  address?: `0x${string}`;
  projectId: bigint;
  chainId?: JBChainId;
  resolvedPermissionsAddress?: `0x${string}`;
  skip?: boolean;
}) {
  const operator = chainId ? getRevnetLoanContract(6, chainId) : undefined;

  const querySkip =
    skip || !address || !projectId || !chainId || !resolvedPermissionsAddress || !operator;

  const { data } = useBendystrawQuery(
    HasPermissionOperation,
    {
      account: address ?? "",
      chainId: Number(chainId ?? 0),
      projectId: Number(projectId),
      operator: operator ?? "",
      version: 6,
    },
    { enabled: !querySkip, chainId: Number(chainId ?? 0) },
  );

  return data?.permissionHolder?.permissions?.includes(1) ?? undefined;
}
