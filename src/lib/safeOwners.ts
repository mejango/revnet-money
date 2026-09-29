import { safeServiceBase } from "@bananapus/nana-sdk-core/safe-service";
import { isAddress, type Address } from "viem";

/** Mainnet chains the Safe Transaction Service covers for this app. */
const SAFE_MAINNET_CHAIN_IDS = [1, 10, 8453, 42161] as const;

export function safeOwnersUrl(chainId: number, owner: string): string | null {
  const base = safeServiceBase(chainId);
  if (!base || !isAddress(owner)) return null;
  return `${base}/api/v1/owners/${owner}/safes/`;
}

export type OwnedSafe = { chainId: number; safe: Address };

/**
 * All Safes the address is an owner of, per chain, via the Safe Transaction
 * Service. Chains without a service prefix or with a failing service resolve
 * to no Safes rather than an error.
 */
export async function fetchSafesOwnedBy(
  owner: string,
  chainIds: readonly number[] = SAFE_MAINNET_CHAIN_IDS,
  fetcher: typeof fetch = fetch,
): Promise<OwnedSafe[]> {
  const perChain = await Promise.all(
    chainIds.map(async (chainId): Promise<OwnedSafe[]> => {
      const url = safeOwnersUrl(chainId, owner);
      if (!url) return [];
      try {
        const response = await fetcher(url, { headers: { accept: "application/json" } });
        if (!response.ok) return [];
        const body = (await response.json()) as { safes?: unknown };
        if (!Array.isArray(body.safes)) return [];
        return body.safes
          .filter((safe): safe is string => typeof safe === "string" && isAddress(safe))
          .map((safe) => ({ chainId, safe: safe as Address }));
      } catch {
        return [];
      }
    }),
  );
  return perChain.flat();
}
