import EtherscanLink from "@/components/EtherscanLink";
import { ProjectCreateEventDocument } from "@/generated/graphql";
import { useBendystrawQuery, useJBContractContext } from "@bananapus/nana-sdk-react";
import { format } from "date-fns";

export function Creation() {
  const { projectId } = useJBContractContext();

  const { data: projectCreateEvent } = useBendystrawQuery(ProjectCreateEventDocument, {
    where: { projectId: Number(projectId), version: 6 },
  });

  const { txHash, timestamp } = projectCreateEvent?.projectCreateEvents.items?.[0] ?? {};

  return timestamp && txHash ? (
    <EtherscanLink value={txHash} type="tx" className="text-zinc-500 text-sm">
      Since {format(timestamp * 1000, "MMM dd, yyyy")}
    </EtherscanLink>
  ) : null;
}
