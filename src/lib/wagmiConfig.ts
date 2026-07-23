import { cache } from "react";
import { createPublicClient, PublicClient } from "viem";
import {
  arbitrum,
  arbitrumSepolia,
  base,
  baseSepolia,
  mainnet,
  optimism,
  optimismSepolia,
  sepolia,
} from "viem/chains";
import { createConfig, fallback, http, type Transport } from "wagmi";
import { injected } from "wagmi/connectors/injected";

function rpcFallback(urls: string | undefined): Transport {
  const configured = urls
    ?.split(",")
    .map((url) => url.trim())
    .filter(Boolean)
    .map((url) => http(url));

  // Production builds validate every RPC list before Next compiles this module.
  // The default transport only keeps isolated unit imports usable without env.
  return fallback(configured?.length ? configured : [http()]);
}

const chains = [
  mainnet,
  optimism,
  arbitrum,
  base,
  sepolia,
  optimismSepolia,
  baseSepolia,
  arbitrumSepolia,
] as const;

const transports = {
  [sepolia.id]: rpcFallback(process.env.NEXT_PUBLIC_RPC_ETHEREUM_SEPOLIA_URLS),
  [optimismSepolia.id]: rpcFallback(process.env.NEXT_PUBLIC_RPC_OPTIMISM_SEPOLIA_URLS),
  [baseSepolia.id]: rpcFallback(process.env.NEXT_PUBLIC_RPC_BASE_SEPOLIA_URLS),
  [arbitrumSepolia.id]: rpcFallback(process.env.NEXT_PUBLIC_RPC_ARBITRUM_SEPOLIA_URLS),
  [mainnet.id]: rpcFallback(process.env.NEXT_PUBLIC_RPC_ETHEREUM_URLS),
  [optimism.id]: rpcFallback(process.env.NEXT_PUBLIC_RPC_OPTIMISM_URLS),
  [base.id]: rpcFallback(process.env.NEXT_PUBLIC_RPC_BASE_URLS),
  [arbitrum.id]: rpcFallback(process.env.NEXT_PUBLIC_RPC_ARBITRUM_URLS),
};

export const wagmiConfig = createConfig({
  chains,
  // EIP-6963 discovers installed browser wallets without loading vendor SDKs.
  // The generic injected connector remains as a fallback for older providers.
  connectors: [injected({ shimDisconnect: true })],
  multiInjectedProviderDiscovery: true,
  ssr: true,
  transports,
});

export const getViemPublicClient = cache((chainId: keyof typeof transports) => {
  const transport = transports[chainId];
  if (!transport) throw new Error(`Transport not found for chainId: ${chainId}`);

  return createPublicClient({
    batch: { multicall: true },
    chain: chains.find((chain) => chain.id === chainId),
    transport,
  }) as PublicClient;
});
