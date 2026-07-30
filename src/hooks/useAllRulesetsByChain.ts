"use client";

import { useJBContractContext } from "@/lib/nana/project";
import { readAllProjectRulesets, type RawRuleset } from "@/lib/nana/rulesets";
import type { JBChainId } from "@/lib/nana/types";
import { wagmiConfig } from "@/lib/wagmiConfig";
import { JBCoreContracts } from "@bananapus/nana-sdk-core";
import { useQuery } from "@tanstack/react-query";
import { getPublicClient } from "wagmi/actions";

export function useAllRulesetsByChain(
  projects: readonly { chainId: JBChainId; projectId: number }[],
) {
  const { contractAddress } = useJBContractContext();
  const key = projects
    .map((p) => `${p.chainId}:${p.projectId}`)
    .sort()
    .join("|");

  return useQuery({
    queryKey: ["all-rulesets-by-chain", key],
    enabled: projects.length > 0,
    staleTime: 60_000,
    queryFn: async (): Promise<Map<number, RawRuleset[]>> => {
      const entries = await Promise.all(
        projects.map(async (project) => {
          const client = getPublicClient(wagmiConfig, { chainId: project.chainId });
          if (!client) throw new Error(`No public client for chain ${project.chainId}.`);
          const rulesets = await readAllProjectRulesets(
            client,
            contractAddress(JBCoreContracts.JBRulesets, project.chainId),
            BigInt(project.projectId),
          );
          return [Number(project.chainId), rulesets.slice().reverse()] as const;
        }),
      );
      return new Map(entries);
    },
  });
}
