import EtherscanLink from "@/components/EtherscanLink";
import { ProjectCreateEventOperation, useBendystrawQuery } from "@/lib/bendystraw";
import { useJBChainId, useJBContractContext } from "@/lib/nana/project";
import { format } from "date-fns";

export function Creation() {
  const { projectId } = useJBContractContext();
  const chainId = useJBChainId();

  const { data: projectCreateEvent } = useBendystrawQuery(
    ProjectCreateEventOperation,
    {
      where: { projectId: Number(projectId), chainId: Number(chainId), version: 6 },
    },
    { chainId: Number(chainId) },
  );

  const { txHash, timestamp } = projectCreateEvent?.projectCreateEvents.items?.[0] ?? {};

  return timestamp && txHash ? (
    <EtherscanLink value={txHash} type="tx" className="text-zinc-500 text-sm">
      Since {format(timestamp * 1000, "MMM dd, yyyy")}
    </EtherscanLink>
  ) : null;
}
