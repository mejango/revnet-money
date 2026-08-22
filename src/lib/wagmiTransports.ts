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
import { jbCenterRpcTransport } from "./jbcenter-rpc";

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
  [sepolia.id]: jbCenterRpcTransport(sepolia.id),
  [optimismSepolia.id]: jbCenterRpcTransport(optimismSepolia.id),
  [baseSepolia.id]: jbCenterRpcTransport(baseSepolia.id),
  [arbitrumSepolia.id]: jbCenterRpcTransport(arbitrumSepolia.id),
  [mainnet.id]: jbCenterRpcTransport(mainnet.id),
  [optimism.id]: jbCenterRpcTransport(optimism.id),
  [base.id]: jbCenterRpcTransport(base.id),
  [arbitrum.id]: jbCenterRpcTransport(arbitrum.id),
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
