import { ProjectDocument, SuckerGroupDocument } from "@/generated/graphql";
import { useBendystrawQuery, useJBChainId, useJBContractContext } from "@bananapus/nana-sdk-react";

export function useTotalOutstandingTokens() {
  const { projectId } = useJBContractContext();
  const chainId = useJBChainId();

  const { data } = useBendystrawQuery(ProjectDocument, {
    projectId: Number(projectId),
    chainId: Number(chainId),
    version: 6,
  });

  const suckerGroupId = data?.project?.suckerGroupId;
  const { data: suckerGroup } = useBendystrawQuery(
    SuckerGroupDocument,
    { id: suckerGroupId ?? "" },
    { enabled: !!suckerGroupId },
  );

  return BigInt(suckerGroup?.suckerGroup?.tokenSupply ?? 0);
}
