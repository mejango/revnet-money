import {
  arbitrum,
  base,
  mainnet,
  optimism,
} from "viem/chains";

const bendystrawUrl =
  process.env.NEXT_PUBLIC_BENDYSTRAW_URL?.trim() || "https://bendystraw.xyz/graphql";
const testnetBendystrawUrl =
  process.env.NEXT_PUBLIC_TESTNET_BENDYSTRAW_URL?.trim() ||
  "https://testnet.bendystraw.xyz/graphql";

export function getBendystrawUrl(chainId: number): string {
  const isMainnet = [mainnet, base, arbitrum, optimism].some((c) => c.id === chainId);

  return isMainnet ? bendystrawUrl : testnetBendystrawUrl;
}
