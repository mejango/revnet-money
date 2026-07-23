import { ProjectAccountingContextOperation, useBendystrawQuery } from "@/lib/bendystraw";
import { useJBChainId, useJBContractContext } from "@/lib/nana/project";

export function useProjectAccountingContext() {
  const { projectId } = useJBContractContext();
  const chainId = useJBChainId();

  return useBendystrawQuery(ProjectAccountingContextOperation, {
    chainId: Number(chainId),
    projectId: Number(projectId),
    version: 6,
  });
}
