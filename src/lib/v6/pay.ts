import { jbRouterTerminalRegistryAbi, NATIVE_TOKEN } from "@bananapus/nana-sdk-core";
import { Address, formatUnits, PublicClient } from "viem";

/** The v6 pay card's modes: mint tokens, or top up the balance minting nothing. */
export type V6PayMode = "pay" | "addbalance";

/** A token the pay card can pay with, resolved on-chain per selected chain. */
export interface V6PayTokenOption {
  token: Address;
  decimals: number;
  /** Accounting-context currency id (`uint32(uint160(token))` for router tokens). */
  currency: number;
  symbol: string;
  /**
   * True when the token is NOT accepted directly and is paid through the
   * JBRouterTerminalRegistry (which swaps it into the accounting token).
   */
  viaRouter: boolean;
}

/**
 * A stable identity for a pay token — the same token can appear both directly
 * AND via-router, so the key must include the route (website/ fund-loss fix).
 */
export function payTokenKey(t: Pick<V6PayTokenOption, "token" | "viaRouter">): string {
  return `${t.token.toLowerCase()}:${t.viaRouter}`;
}

export function isNativePayToken(address: string): boolean {
  return address.toLowerCase() === NATIVE_TOKEN.toLowerCase();
}

/** Accounting-context currency id for a token (`uint32(uint160(token))`). */
export function payTokenCurrencyId(token: Address): number {
  return Number(BigInt(token) & 0xffffffffn);
}

const ROUTER_PROBE_BENEFICIARY: Address = "0x0000000000000000000000000000000000000001";

/**
 * Whether the router registry can actually route a pay of `token` into
 * `projectId` right now (direct forward, swap, or cash-out loop). A listed
 * router with no pool/feed path reverts at pay time — offering ETH/USDC there
 * is a trap, not a convenience — so a dead route previews an all-zero ruleset
 * (ruleset.id == 0). Cached (as a promise) per (chain, project, token), exactly
 * like website/'s _payRouteCache. Fail-soft: any error resolves false.
 */
const payRouteCache = new Map<string, Promise<boolean>>();
export function routerPayRouteWorks(
  client: PublicClient,
  chainId: number,
  projectId: bigint,
  registry: Address,
  token: Address,
  decimals: number,
): Promise<boolean> {
  const key = `${chainId}:${projectId}:${token.toLowerCase()}`;
  let cached = payRouteCache.get(key);
  if (!cached) {
    cached = client
      .readContract({
        address: registry,
        abi: jbRouterTerminalRegistryAbi,
        functionName: "previewPayFor",
        args: [projectId, token, 10n ** BigInt(decimals), ROUTER_PROBE_BENEFICIARY, "0x"],
      })
      .then((out) => {
        // previewPayFor returns [ruleset, ...]; a dead route yields ruleset.id == 0.
        const ruleset = (out as readonly [{ id: number | bigint }, ...unknown[]])[0];
        return Number(ruleset?.id ?? 0) !== 0;
      })
      .catch(() => false);
    payRouteCache.set(key, cached);
  }
  return cached;
}

/** Initial supply at/above this sentinel means unlimited inventory (website/ parity). */
export const TIER_UNLIMITED_SUPPLY = 999_999_999;

/**
 * Parse a `data:application/json[;base64],…` URI into its JSON object.
 * Null for non-data URIs, non-object JSON, or any decode failure —
 * metadata is cosmetic, so callers fall back rather than throw.
 */
export function parseTierMetadataJson(uri: string): Record<string, unknown> | null {
  if (!uri.startsWith("data:application/json")) return null;
  try {
    const json = JSON.parse(
      uri.includes("base64,")
        ? // decodeURIComponent(escape(...)) round-trips UTF-8 through atob.
          decodeURIComponent(escape(atob(uri.split("base64,")[1])))
        : decodeURIComponent(uri.split(",").slice(1).join(",")),
    ) as unknown;
    return json && typeof json === "object" ? (json as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export interface PickedTierMetadata {
  name?: string;
  description?: string;
  /** Raw image value (`image` ?? `imageUri`) — callers map ipfs:// etc. */
  image?: string;
}

/** The shared field mapping: productName/name, productDescription/description, image/imageUri. */
export function pickTierMetadata(json: Record<string, unknown>): PickedTierMetadata {
  return {
    name: str(json.productName) ?? str(json.name),
    description: str(json.productDescription) ?? str(json.description),
    image: str(json.image) ?? str(json.imageUri),
  };
}

function str(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

/** "3d 4h" / "2h 10m" / "5m" countdown label for a ruleset that hasn't started. */
export function formatStartCountdown(secs: number): string {
  if (secs <= 0) return "moments";
  const d = Math.floor(secs / 86400);
  if (d >= 1) return `${d}d ${Math.floor((secs % 86400) / 3600)}h`;
  const h = Math.floor(secs / 3600);
  if (h >= 1) return `${h}h ${Math.floor((secs % 3600) / 60)}m`;
  return `${Math.max(1, Math.floor(secs / 60))}m`;
}

/** Localized token-amount label with sensible fraction digits for the pay card. */
export function formatPayAmount(value: bigint, decimals: number): string {
  const num = Number(formatUnits(value, decimals));
  if (!Number.isFinite(num)) return formatUnits(value, decimals);
  return num.toLocaleString("en-US", {
    maximumFractionDigits: num !== 0 && num < 1 ? 6 : 4,
  });
}
