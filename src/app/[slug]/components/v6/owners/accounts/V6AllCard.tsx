"use client";

import { ParticipantsDocument, ProjectDocument, SuckerGroupDocument } from "@/generated/graphql";
import { useTotalOutstandingTokens } from "@/hooks/useTotalOutstandingTokens";
import { getTokenConfigForChain, getTokenSymbolFromAddress } from "@/lib/tokenUtils";
import { formatTokenSymbol } from "@/lib/utils";
import {
  useBendystrawQuery,
  useJBChainId,
  useJBContractContext,
  useJBTokenContext,
} from "@bananapus/nana-sdk-react";
import { ParticipantsPieChart } from "../../../../owners/components/ParticipantsPieChart";
import { ParticipantsTable } from "../../../../owners/components/ParticipantsTable";

/**
 * "All" card (website/ parity: renderOwnersAll): the holder distribution pie +
 * table, aggregated per account across every chain in the sucker group.
 */
export function V6AllCard() {
  const chainId = useJBChainId();
  const { projectId, version } = useJBContractContext();
  const { token } = useJBTokenContext();
  const totalOutstandingTokens = useTotalOutstandingTokens();

  const project = useBendystrawQuery(ProjectDocument, {
    projectId: Number(projectId),
    chainId: Number(chainId),
    version,
  });
  const suckerGroupId = project.data?.project?.suckerGroupId;

  const { data: suckerGroupData } = useBendystrawQuery(
    SuckerGroupDocument,
    { id: suckerGroupId ?? "" },
    { enabled: !!suckerGroupId, pollInterval: 10000 },
  );

  const chainTokenConfig = getTokenConfigForChain(suckerGroupData, Number(chainId));
  const baseTokenSymbol = getTokenSymbolFromAddress(chainTokenConfig.token);
  const baseTokenDecimals = chainTokenConfig.decimals;

  const participantsQuery = useBendystrawQuery(ParticipantsDocument, {
    orderBy: "balance",
    orderDirection: "desc",
    where: {
      suckerGroupId,
      balance_gt: 0,
    },
  });

  // Aggregate each account's balance/volume across the chains it holds on.
  const participantsDataAggregate =
    participantsQuery.data?.participants.items?.reduce(
      (acc, participant) => {
        if (!participant) return acc;
        const existingParticipant = acc[participant.address];
        return {
          ...acc,
          [participant.address]: {
            address: participant.address,
            balance: BigInt(existingParticipant?.balance ?? 0) + BigInt(participant.balance ?? 0),
            volume: BigInt(existingParticipant?.volume ?? 0) + BigInt(participant.volume ?? 0),
            chains: [...(acc[participant.address]?.chains ?? []), participant.chainId],
          },
        };
      },
      {} as Record<string, any>,
    ) ?? {};

  return (
    <div>
      <p className="text-md text-black font-light italic mb-2">
        {formatTokenSymbol(token)} owners are accounts who either paid in, received splits, received
        auto issuance, or traded for them on the secondary market.
      </p>
      <div className="flex flex-col sm:items-start items-center">
        <ParticipantsPieChart
          participants={Object.values(participantsDataAggregate)}
          totalSupply={totalOutstandingTokens}
          token={token?.data}
        />
        <div className="overflow-auto p-2 bg-zinc-50 border-zinc-200 border w-full">
          <ParticipantsTable
            participants={Object.values(participantsDataAggregate)}
            token={token?.data}
            totalSupply={totalOutstandingTokens}
            baseTokenSymbol={baseTokenSymbol}
            baseTokenDecimals={baseTokenDecimals}
          />
        </div>
      </div>
    </div>
  );
}
