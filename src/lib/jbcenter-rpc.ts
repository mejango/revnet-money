import { jbCenterBaseUrl } from "@/lib/jbcenter-config";
import { createJBCenterRpcProvider } from "@bananapus/nana-sdk-core/jbcenter";
import { custom, http, type Transport } from "viem";

const serverFetch: typeof fetch = (input, init) => {
  const headers = new Headers(init?.headers);
  headers.set("Origin", process.env.NEXT_PUBLIC_SITE_URL ?? "https://revnet.money");
  return fetch(input, { ...init, headers });
};

const browserFetch: typeof fetch = (input, init) => window.fetch(input, init);

export function jbCenterRpcTransport(chainId: number): Transport {
  if (
    process.env.NEXT_PUBLIC_DETERMINISTIC_BROWSER === "true" &&
    process.env.NEXT_PUBLIC_RPC_FIXTURE_URL
  ) {
    return http(process.env.NEXT_PUBLIC_RPC_FIXTURE_URL);
  }
  return custom(
    createJBCenterRpcProvider(chainId, {
      baseUrl: jbCenterBaseUrl(),
      fetch: typeof window === "undefined" ? serverFetch : browserFetch,
    }),
    { retryCount: 1 },
  );
}
