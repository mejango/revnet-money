"use client";

import { useJBChainId, useJBContractContext } from "@/lib/nana/project";
import { readAllProjectRulesets } from "@/lib/nana/rulesets";
import { wagmiConfig } from "@/lib/wagmiConfig";
import { JBCoreContracts, RulesetWeight, WeightCutPercent } from "@bananapus/nana-sdk-core";
import { useQuery } from "@tanstack/react-query";
import { getPublicClient } from "wagmi/actions";

export function useRulesets() {
  const { projectId, contractAddress } = useJBContractContext();
  const chainId = useJBChainId();

  const { data, ...rest } = useQuery({
    queryKey: ["all-rulesets", chainId, projectId.toString()],
    enabled: !!chainId,
    staleTime: 60_000,
    queryFn: async () => {
      const client = getPublicClient(wagmiConfig, { chainId });
      if (!client) throw new Error(`No public client for chain ${chainId}.`);
      const rulesets = await readAllProjectRulesets(
        client,
        contractAddress(JBCoreContracts.JBRulesets),
        projectId,
      );
      return rulesets
        .map((ruleset) => ({
          ...ruleset,
          weight: new RulesetWeight(ruleset.weight),
          weightCutPercent: new WeightCutPercent(ruleset.weightCutPercent),
        }))
        .reverse();
    },
  });

  return { rulesets: data, ...rest };
}
