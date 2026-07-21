import { HasPermissionDocument } from "@/generated/graphql";
import { getRevnetLoanContract, JBChainId } from "@bananapus/nana-sdk-core";
import { useBendystrawQuery } from "@bananapus/nana-sdk-react";

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

  const { data } = useBendystrawQuery(HasPermissionDocument, {
    skip: querySkip,
    account: address as string,
    chainId: chainId as number,
    projectId: Number(projectId),
    operator: operator as string,
    version: 6,
  });

  return data?.permissionHolder?.permissions?.includes(1) ?? undefined;
}
