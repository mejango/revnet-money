import { readAllProjectRulesets } from "@/lib/nana/rulesets";
import { getViemPublicClient } from "@/lib/wagmiTransports";
import {
  getJBContractAddress,
  JBChainId,
  JBCoreContracts,
  jbRulesetsAbi,
  WeightCutPercent,
} from "@bananapus/nana-sdk-core";
import { unstable_cache } from "next/cache";
import { getContract } from "viem";

export type Ruleset = {
  id: number;
  start: number;
  duration: number;
  weight: string;
  weightCutPercent: number;
};

export const getRulesets = unstable_cache(
  async (projectId: string, chainId: JBChainId): Promise<Ruleset[]> => {
    const client = getViemPublicClient(chainId);
    const contract = getContract({
      address: getJBContractAddress(JBCoreContracts.JBRulesets, 6, chainId),
      abi: jbRulesetsAbi,
      client,
    });

    const data = await readAllProjectRulesets(client, contract.address, BigInt(projectId));

    return data
      .map((r) => ({
        id: r.id,
        start: r.start,
        duration: r.duration,
        weight: r.weight.toString(),
        weightCutPercent: new WeightCutPercent(r.weightCutPercent).toFloat(),
      }))
      .sort((a, b) => a.start - b.start);
  },
  ["rulesets"],
  { revalidate: 300 },
);
