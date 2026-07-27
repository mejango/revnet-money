import { arbitrum, base, mainnet, optimism } from "viem/chains";

function graphqlEndpoint(value: string | undefined, fallback: string): string {
  const url = new URL(value?.trim() || fallback);
  url.pathname = `${url.pathname.replace(/\/graphql\/?$/u, "").replace(/\/$/u, "")}/graphql`;
  url.search = "";
  url.hash = "";
  return url.toString();
}

const bendystrawUrl = graphqlEndpoint(
  process.env.NEXT_PUBLIC_BENDYSTRAW_URL,
  "https://bendystraw.xyz/graphql",
);
const testnetBendystrawUrl = graphqlEndpoint(
  process.env.NEXT_PUBLIC_TESTNET_BENDYSTRAW_URL,
  "https://testnet.bendystraw.xyz/graphql",
);

export function getBendystrawUrl(chainId: number): string {
  const isMainnet = [mainnet, base, arbitrum, optimism].some((c) => c.id === chainId);

  return isMainnet ? bendystrawUrl : testnetBendystrawUrl;
}
