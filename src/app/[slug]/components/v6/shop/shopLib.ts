"use client";

import { ipfsGatewayUrl, ipfsPublicGatewayUrl } from "@/lib/ipfs";
import {
  formatPayAmount,
  parseTierMetadataJson,
  TIER_UNLIMITED_SUPPLY,
  tierDisplayMetadata,
  TierDisplayMetadata,
} from "@/lib/v6/pay";
import {
  decodeEncodedIpfsUriCandidates,
  encodeIpfsUri,
  jb721TiersHookStoreAbi,
  JB_CHAINS,
  JBChainId,
  NATIVE_TOKEN,
} from "@bananapus/nana-sdk-core";
import {
  BASE_CURRENCY_ETH,
  BASE_CURRENCY_USD,
  effectiveTierPrice,
  getAccountingContexts,
  getProject721Shop,
} from "@bananapus/nana-sdk-core/v6";
import { useQuery } from "@tanstack/react-query";
import { Address, erc20Abi, PublicClient } from "viem";
import { usePublicClient } from "wagmi";
import { ShopCartItem, useShopCart } from "../ShopCartContext";

export { TIER_UNLIMITED_SUPPLY };

const ZERO_BYTES32 = `0x${"0".repeat(64)}`;

/** bytes32 (onchain `encodedIpfsUri`) → canonical DAG-PB CIDv0 (`Qm…`). */
export function decodeEncodedIpfsUri(hex: string): string {
  const candidates = decodeEncodedIpfsUriCandidates(hex);
  if (!candidates) throw new Error("The tier does not contain a valid IPFS digest.");
  return candidates[0];
}

/** DAG-PB CIDv0/CIDv1 → bytes32 for onchain `encodedIpfsUri`. */
export function encodeIpfsCid(cid: string): `0x${string}` {
  return encodeIpfsUri(cid);
}

/** Stored-tier flags (`tiersOf`'s 5-bool shape — not the 7-bool config shape). */
export interface ShopTierFlags {
  allowOwnerMint: boolean;
  transfersPausable: boolean;
  cantBeRemoved: boolean;
  cantIncreaseDiscountPercent: boolean;
  cantBuyWithCredits: boolean;
}

export interface ShopTier {
  id: number;
  /** Full (undiscounted) price in the shop's pricing units. */
  price: bigint;
  remaining: number;
  initial: number;
  unlimited: boolean;
  category: number;
  /** Out of 200 (DISCOUNT_DENOMINATOR) — shopper-facing % is half this. */
  discountPercent: number;
  reserveFrequency: number;
  votingUnits: bigint;
  /** 1e9-scaled share of each sale routed to the tier's splits. */
  splitPercent: number;
  encodedIpfsUri: `0x${string}`;
  /** tokenUriResolver output (data URI), "" when the hook has no resolver. */
  resolvedUri: string;
  flags: ShopTierFlags | null;
}

export interface ShopInventory {
  hook: Address;
  store: Address;
  /**
   * The hook's METADATA_ID_TARGET (shared implementation) — pay-metadata ids
   * must key off this, never the clone hook address.
   */
  idTarget: Address;
  pricing: { currency: number; decimals: number; symbol: string };
  tiers: ShopTier[];
}

/**
 * The project's 721 shop on the context chain: hook + store + pricing context
 * (with a display symbol) + full tier data (supply, discount, reserve, flags).
 * Null when the project authoritatively has no 721 hook; RPC failures throw so
 * they surface as errors, never as a false "no shop".
 */
export function useShopInventory(chainId: JBChainId | undefined, projectId: bigint) {
  const publicClient = usePublicClient({ chainId });

  return useQuery({
    queryKey: ["v6Shop721", chainId, projectId.toString()],
    enabled: !!publicClient && !!chainId,
    staleTime: 60_000,
    retry: 1,
    queryFn: async (): Promise<ShopInventory | null> => {
      const client = publicClient as PublicClient;
      // Everything in revnet-app is a revnet — hook resolution goes through REVOwner.
      const resolved = await getProject721Shop(client, {
        chainId: chainId!,
        projectId,
        isRevnet: true,
        tierLimit: 200,
      });
      if (!resolved) return null;

      const [rawTiers, symbol] = await Promise.all([
        client
          .readContract({
            address: resolved.store,
            abi: jb721TiersHookStoreAbi,
            functionName: "tiersOf",
            args: [resolved.hook, [], false, 0n, 200n],
          })
          .catch(() => []),
        resolveShopPricingSymbol(client, chainId!, projectId, resolved.pricing.currency),
      ]);
      const rawById = new Map(rawTiers.map((raw) => [raw.id, raw] as const));

      return {
        hook: resolved.hook,
        store: resolved.store,
        idTarget: resolved.metadataIdTarget,
        pricing: { ...resolved.pricing, symbol },
        tiers: resolved.tiers.map((tier) => {
          const raw = rawById.get(tier.id);
          return {
            id: tier.id,
            price: tier.price,
            remaining: tier.remainingSupply,
            initial: tier.initialSupply,
            unlimited: tier.initialSupply >= TIER_UNLIMITED_SUPPLY,
            category: tier.category,
            discountPercent: tier.discountPercent,
            reserveFrequency: tier.reserveFrequency,
            votingUnits: tier.votingUnits,
            splitPercent: raw ? Number(raw.splitPercent) : 0,
            encodedIpfsUri: tier.encodedIpfsUri,
            resolvedUri: tier.resolvedUri ?? "",
            flags: raw ? { ...raw.flags } : null,
          };
        }),
      };
    },
  });
}

async function resolveShopPricingSymbol(
  client: PublicClient,
  chainId: JBChainId,
  projectId: bigint,
  currency: number,
): Promise<string> {
  const nativeSymbol = JB_CHAINS[chainId]?.nativeTokenSymbol ?? "ETH";
  if (currency === BASE_CURRENCY_ETH) return nativeSymbol;
  if (currency === BASE_CURRENCY_USD) return "USD";
  // Token-keyed currency (uint32(uint160(token))): match the project's
  // accounting contexts to find the token, then read its symbol.
  const contexts = await getAccountingContexts(client, { chainId, projectId }).catch(() => []);
  const match = contexts.find((ctx) => ctx.currency === currency);
  if (!match) return `currency #${currency}`;
  if (match.token.toLowerCase() === NATIVE_TOKEN.toLowerCase()) return nativeSymbol;
  try {
    return await client.readContract({
      address: match.token,
      abi: erc20Abi,
      functionName: "symbol",
    });
  } catch {
    return `currency #${currency}`;
  }
}

export type TierMedia = TierDisplayMetadata;

/** The tier fields the media resolution chain needs (shop tab AND pay strip). */
export interface TierMediaSource {
  id: number;
  resolvedUri: string;
  encodedIpfsUri: `0x${string}`;
}

/**
 * Tier display metadata (name/image/category name), from the onchain
 * resolver's data URI first, then the tier's IPFS JSON. Best-effort — cards
 * render immediately and hydrate as this lands. Shared by the Shop tab and
 * the pay card's shop strip (same query key, one resolution chain).
 */
export function useTierMedia(
  chainId: JBChainId | undefined,
  shop: { hook: Address; tiers: TierMediaSource[] } | null | undefined,
) {
  return useQuery({
    queryKey: ["v6Shop721Media", chainId, shop?.hook],
    enabled: !!shop && shop.tiers.length > 0,
    staleTime: Infinity,
    queryFn: async () => {
      const entries = await Promise.all(
        shop!.tiers.map(async (tier) => [tier.id, await resolveTierMedia(tier)] as const),
      );
      return Object.fromEntries(entries) as Record<number, TierMedia>;
    },
  });
}

/** Best-effort tier metadata resolution — {} on any failure. */
async function resolveTierMedia(tier: TierMediaSource): Promise<TierMedia> {
  const resolved = tier.resolvedUri ? parseTierMetadataJson(tier.resolvedUri) : null;
  if (resolved && Object.keys(resolved).length > 0) return tierDisplayMetadata(resolved);

  if (!tier.encodedIpfsUri || tier.encodedIpfsUri === ZERO_BYTES32) return {};
  const candidates = decodeEncodedIpfsUriCandidates(tier.encodedIpfsUri);
  if (!candidates) return {};
  // Try both equivalent CID forms, pinned gateway first then public. Some
  // historical tier content was pinned as a raw CIDv1 block.
  for (const url of candidates.flatMap((cid) => [ipfsGatewayUrl(cid), ipfsPublicGatewayUrl(cid)])) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 8_000);
      const res = await fetch(url, { signal: controller.signal }).finally(() =>
        clearTimeout(timer),
      );
      if (!res.ok) continue;
      const json = (await res.json()) as unknown;
      return json && typeof json === "object"
        ? tierDisplayMetadata(json as Record<string, unknown>)
        : {};
    } catch {
      // Try the next gateway.
    }
  }
  return {};
}

/** Shopper-facing "X% off" — discountPercent is out of 200. */
export function discountLabel(discountPercent: number): string {
  const pct = discountPercent / 2;
  return `${Number.isInteger(pct) ? pct : pct.toFixed(1)}% off`;
}

/** Localized shop-price label in the shop's pricing units. */
export function formatShopAmount(value: bigint, decimals: number): string {
  return formatPayAmount(value, decimals);
}

export function tierDisplayName(media: TierMedia | undefined, tierId: number): string {
  return media?.name ?? `Item #${tierId}`;
}

export function categoryLabel(
  category: number,
  tiers: ShopTier[],
  mediaById: Record<number, TierMedia> | undefined,
): string {
  const named = tiers.find(
    (tier) => tier.category === category && mediaById?.[tier.id]?.categoryName,
  );
  return (
    (named && mediaById?.[named.id]?.categoryName) ||
    (category === 0 ? "General" : `Category ${category}`)
  );
}

/**
 * The shared-cart view of the shop (same semantics as the pay card's
 * V6PayShopStrip): quantities keyed by (tierId, chainId), items registered
 * with their EFFECTIVE (discounted) price in the shop's pricing units.
 */
export function useTierCart(shop: ShopInventory | null | undefined, chainId: number | undefined) {
  const cart = useShopCart();

  const shopItems: ShopCartItem[] =
    shop && chainId
      ? cart.items.filter(
          (item) => item.chainId === chainId && item.hook.toLowerCase() === shop.hook.toLowerCase(),
        )
      : [];

  const quantityOf = (tierId: number) =>
    shopItems.find((item) => Number(item.tierId) === tierId)?.quantity ?? 0;

  const setTierQuantity = (tier: ShopTier, media: TierMedia | undefined, quantity: number) => {
    if (!shop || !chainId) return;
    const existing = cart.items.find(
      (item) => Number(item.tierId) === tier.id && item.chainId === chainId,
    );
    if (!existing && quantity > 0) {
      cart.add({
        tierId: BigInt(tier.id),
        quantity,
        price: effectiveTierPrice(tier.price, tier.discountPercent),
        currency: shop.pricing.currency,
        name: tierDisplayName(media, tier.id),
        imageUri: media?.image,
        hook: shop.hook,
        chainId,
      });
      return;
    }
    cart.setQuantity(BigInt(tier.id), chainId, quantity);
  };

  const count = shopItems.reduce((total, item) => total + item.quantity, 0);
  const total = shopItems.reduce((sum, item) => sum + item.price * BigInt(item.quantity), 0n);

  return { quantityOf, setTierQuantity, count, total };
}
