"use client";

import {
  JBCoreContracts,
  JBProjectToken,
  jbTokensAbi,
  resolveSuckers,
  type JBChainId,
} from "@bananapus/nana-sdk-core";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { getContract } from "viem";
import { useAccount, useConfig, useReadContract } from "wagmi";
import { useJBChainId, useJBContractContext, useJBProject } from "./project";
import type { SuckerPair } from "./types";

const CHAIN_ORDER: readonly JBChainId[] = [1, 8453, 10, 42161, 11155111, 84532, 11155420, 421614];

/**
 * Ensure the active project is represented exactly once and keep chain order
 * deterministic. Bendystraw's sucker-group response historically provided
 * this shape; doing it here preserves every existing caller's assumptions.
 */
export function normalizeSuckerPairs(
  pairs: readonly SuckerPair[],
  current: SuckerPair,
): SuckerPair[] {
  const byChain = new Map<JBChainId, SuckerPair>();
  byChain.set(current.peerChainId, current);
  for (const pair of pairs) {
    if (!byChain.has(pair.peerChainId)) byChain.set(pair.peerChainId, pair);
  }
  return [...byChain.values()].sort((a, b) => {
    const aIndex = CHAIN_ORDER.indexOf(a.peerChainId);
    const bIndex = CHAIN_ORDER.indexOf(b.peerChainId);
    if (aIndex === -1 && bIndex === -1) return a.peerChainId - b.peerChainId;
    if (aIndex === -1) return 1;
    if (bIndex === -1) return -1;
    return aIndex - bIndex;
  });
}

/**
 * Resolve the V6 sucker group on-chain. Server-provided peers seed the cache,
 * removing the duplicate client indexer waterfall on initial render. Manual
 * `refetch` still resolves the live registry after cross-chain edits.
 */
export function useSuckers({ enabled = true }: { enabled?: boolean } = {}) {
  const config = useConfig();
  const chainId = useJBChainId();
  const { projectId } = useJBContractContext();
  const project = useJBProject();
  const current = useMemo(
    () => (chainId ? ({ peerChainId: chainId, projectId } satisfies SuckerPair) : undefined),
    [chainId, projectId],
  );
  const initialData = useMemo(
    () =>
      current
        ? normalizeSuckerPairs(project?.initialSuckers ?? [], current)
        : ([] satisfies SuckerPair[]),
    [current, project?.initialSuckers],
  );

  return useQuery({
    queryKey: ["revnet", "suckers", chainId, projectId.toString()],
    enabled: enabled && !!chainId,
    initialData,
    staleTime: Infinity,
    queryFn: async () => {
      if (!chainId || !current) return [];
      const pairs = await resolveSuckers({
        config,
        chainId,
        projectId,
        version: 6,
      });
      return normalizeSuckerPairs(pairs, current);
    },
  });
}

/**
 * Return the connected account's claimed + credit project-token balance on
 * every chain in the sucker group.
 */
export function useSuckersUserTokenBalance() {
  const config = useConfig();
  const chainId = useJBChainId();
  const { projectId, contractAddress } = useJBContractContext();
  const { address } = useAccount();
  const suckers = useSuckers();

  const currentChain = useReadContract({
    abi: jbTokensAbi,
    functionName: "totalBalanceOf",
    address: chainId ? contractAddress(JBCoreContracts.JBTokens, chainId) : undefined,
    chainId,
    args: address ? [address, projectId] : undefined,
    query: {
      enabled: !!address && !!chainId,
      select: (value) => new JBProjectToken(value),
    },
  });

  const peerKey = (suckers.data ?? [])
    .map((pair) => `${pair.peerChainId}:${pair.projectId}`)
    .join(",");
  const balances = useQuery({
    queryKey: [
      "revnet",
      "suckersUserTokenBalance",
      address,
      chainId,
      projectId.toString(),
      currentChain.data?.value.toString(),
      peerKey,
    ],
    enabled: !!address && !!chainId && !suckers.isLoading,
    queryFn: async () => {
      if (!address || !chainId) return [];
      const pairs = suckers.data ?? [];
      const remotePairs = pairs.filter((pair) => pair.peerChainId !== chainId);
      const remote = await Promise.all(
        remotePairs.map(async (pair) => {
          const tokenStore = getContract({
            address: contractAddress(JBCoreContracts.JBTokens, pair.peerChainId),
            abi: jbTokensAbi,
            client: config.getClient({ chainId: pair.peerChainId }),
          });
          const balance = await tokenStore.read.totalBalanceOf([address, pair.projectId]);
          return {
            balance: new JBProjectToken(balance),
            chainId: pair.peerChainId,
            projectId: pair.projectId,
          };
        }),
      );
      return [
        {
          balance: currentChain.data ?? new JBProjectToken(0n),
          chainId,
          projectId,
        },
        ...remote,
      ];
    },
  });

  return {
    ...balances,
    isLoading: balances.isLoading || suckers.isLoading || currentChain.isLoading,
    isError: balances.isError || suckers.isError || currentChain.isError,
    error: balances.error ?? suckers.error ?? currentChain.error,
  };
}
