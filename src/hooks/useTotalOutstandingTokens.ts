import { ProjectOperation, SuckerGroupOperation, useBendystrawQuery } from "@/lib/bendystraw";
import { useJBChainId, useJBContractContext } from "@/lib/nana/project";

export function useTotalOutstandingTokens() {
  const { projectId } = useJBContractContext();
  const chainId = useJBChainId();

  const { data } = useBendystrawQuery(ProjectOperation, {
    projectId: Number(projectId),
    chainId: Number(chainId),
    version: 6,
  });

  const suckerGroupId = data?.project?.suckerGroupId;
  // The group carries the total supply, which every mint and cash out moves: this display
  // refreshes it. Readers of the group's fixed token fields load it once and share this refresh.
  const { data: suckerGroup } = useBendystrawQuery(
    SuckerGroupOperation,
    { id: suckerGroupId ?? "" },
    { enabled: !!suckerGroupId, chainId: Number(chainId), pollInterval: 30_000 },
  );

  return BigInt(suckerGroup?.suckerGroup?.tokenSupply ?? 0);
}
