import { createJBCenterRpcProvider } from "@bananapus/nana-sdk-core/jbcenter";
import { custom, http, type Transport } from "viem";

const APP_ORIGIN = "https://revnet.money";

const serverFetch: typeof fetch = (input, init) => {
  const headers = new Headers(init?.headers);
  headers.set("Origin", APP_ORIGIN);
  return fetch(input, { ...init, headers });
};

export function jbCenterRpcTransport(chainId: number): Transport {
  if (
    process.env.NEXT_PUBLIC_DETERMINISTIC_BROWSER === "true" &&
    process.env.NEXT_PUBLIC_RPC_FIXTURE_URL
  ) {
    return http(process.env.NEXT_PUBLIC_RPC_FIXTURE_URL);
  }
  return custom(
    createJBCenterRpcProvider(chainId, {
      fetch: typeof window === "undefined" ? serverFetch : undefined,
    }),
    { retryCount: 1 },
  );
}
