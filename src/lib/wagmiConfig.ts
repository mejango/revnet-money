import { farcasterFrame as miniAppConnector } from "@farcaster/miniapp-wagmi-connector";
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
import { coinbaseWallet, safe, walletConnect } from "wagmi/connectors";

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

const safeConnector = safe({
  allowedDomains: [/^app\.safe\.global$/],
  debug: process.env.NODE_ENV !== "production",
  shimDisconnect: true,
});

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
  connectors: [
    miniAppConnector(),
    safeConnector,
    coinbaseWallet({
      appName: "REVNET",
      appLogoUrl: `${process.env.NEXT_PUBLIC_SITE_URL ?? "https://app.revnet.eth.sucks"}/assets/img/small-bw.svg`,
      // Wallet support must not opt every visitor into Coinbase analytics.
      preference: { options: "all", telemetry: false },
    }),
    // Only initialize WalletConnect in the browser
    ...(typeof window !== "undefined"
      ? [
          walletConnect({
            projectId: process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID!,
            showQrModal: false,
            metadata: {
              name: "REVNET",
              description: "Tokenize revenues and fundraises. 100% autonomous.",
              url: process.env.NEXT_PUBLIC_SITE_URL ?? "https://app.revnet.eth.sucks",
              icons: [
                `${process.env.NEXT_PUBLIC_SITE_URL ?? "https://app.revnet.eth.sucks"}/assets/img/small-bw.svg`,
              ],
            },
          }),
        ]
      : []),
  ],
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
