import {
  arbitrum,
  arbitrumSepolia,
  base,
  baseSepolia,
  mainnet,
  optimism,
  optimismSepolia,
  sepolia,
} from "@/lib/chains";
import { cache } from "react";
import { createPublicClient, PublicClient } from "viem";
import { fallback, http, type Transport } from "wagmi";
import { getDwellirRpcUrl } from "./dwellir";

function rpcTransport(chainId: number): Transport {
  const url = getDwellirRpcUrl(chainId);

  // Production builds validate the shared Dwellir key before Next compiles
  // this module. The default keeps isolated unit imports usable without env.
  return fallback(url ? [http(url)] : [http()]);
}

export const SUPPORTED_CHAINS = [
  mainnet,
  optimism,
  arbitrum,
  base,
  sepolia,
  optimismSepolia,
  baseSepolia,
  arbitrumSepolia,
] as const;

export const transports = {
  [sepolia.id]: rpcTransport(sepolia.id),
  [optimismSepolia.id]: rpcTransport(optimismSepolia.id),
  [baseSepolia.id]: rpcTransport(baseSepolia.id),
  [arbitrumSepolia.id]: rpcTransport(arbitrumSepolia.id),
  [mainnet.id]: rpcTransport(mainnet.id),
  [optimism.id]: rpcTransport(optimism.id),
  [base.id]: rpcTransport(base.id),
  [arbitrum.id]: rpcTransport(arbitrum.id),
};

export const getViemPublicClient = cache((chainId: keyof typeof transports) => {
  const transport = transports[chainId];
  if (!transport) throw new Error(`Transport not found for chainId: ${chainId}`);

  return createPublicClient({
    batch: { multicall: true },
    chain: SUPPORTED_CHAINS.find((chain) => chain.id === chainId),
    transport,
  }) as PublicClient;
});
