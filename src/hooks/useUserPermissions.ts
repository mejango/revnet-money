import { ProjectWithPermissionsOperation, useBendystrawQuery } from "@/lib/bendystraw";
import { useJBChainId, useJBContractContext } from "@/lib/nana/project";
import { JBPermissionIdsV6 } from "@bananapus/nana-sdk-core/v6";
import { useMemo } from "react";
import { useAccount } from "wagmi";

type JBPermissionKey = keyof typeof JBPermissionIdsV6;

export function useUserPermissions() {
  const { projectId } = useJBContractContext();
  const chainId = useJBChainId();
  const { address } = useAccount();

  const { data, isLoading } = useBendystrawQuery(
    ProjectWithPermissionsOperation,
    {
      chainId: Number(chainId),
      projectId: Number(projectId),
      version: 6,
    },
    {
      enabled: !!chainId && !!projectId && !!address,
    },
  );

  const userPermissions = useMemo(() => {
    if (!address || !data?.project) return [];

    const permissionHolders = data.project.permissionHolders?.items || [];
    const userHolder = permissionHolders.find(
      (holder) => holder.operator?.toLowerCase() === address.toLowerCase(),
    );

    return userHolder?.permissions || [];
  }, [address, data?.project]);

  const hasPermission = useMemo(
    () => (permission: JBPermissionKey) => {
      const permissionId = JBPermissionIdsV6[permission as keyof typeof JBPermissionIdsV6];
      return permissionId !== undefined && userPermissions.includes(permissionId);
    },
    [userPermissions],
  );

  return {
    hasPermission,
    permissions: userPermissions,
    isLoading,
  };
}
