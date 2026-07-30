import { JB_CHAINS, type JBChainId } from "@bananapus/nana-sdk-core";
import type { Chain } from "viem";

type SupportedChain<ChainId extends JBChainId> = Chain & { id: ChainId };

function supportedChain<const ChainId extends JBChainId>(
  chainId: ChainId,
): SupportedChain<ChainId> {
  return JB_CHAINS[chainId].chain as SupportedChain<ChainId>;
}

export const mainnet = supportedChain(1);
export const optimism = supportedChain(10);
export const arbitrum = supportedChain(42161);
export const base = supportedChain(8453);
export const sepolia = supportedChain(11155111);
export const optimismSepolia = supportedChain(11155420);
export const arbitrumSepolia = supportedChain(421614);
export const baseSepolia = supportedChain(84532);
