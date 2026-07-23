import EtherscanLink from "@/components/EtherscanLink";
import { ProjectCreateEventOperation, useBendystrawQuery } from "@/lib/bendystraw";
import { formatShortDate } from "@/lib/date";
import { useJBChainId, useJBContractContext } from "@/lib/nana/project";

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
      Since {formatShortDate(timestamp * 1000, true)}
    </EtherscanLink>
  ) : null;
}
