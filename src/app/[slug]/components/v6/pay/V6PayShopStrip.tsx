"use client";

import { formatPayAmount } from "@/lib/v6/pay";
import { effectiveTierPrice } from "@bananapus/nana-sdk-core/v6";
import { useShopCart } from "../ShopCartContext";
import { V6PayShop, V6PayShopTier } from "./usePayShop";

/**
 * The compact selectable NFT strip on the pay card (website/ renderPayShopStrip
 * parity). Selecting items feeds the shared shop cart, which the card turns
 * into 721 tier-mint metadata and a synced pay amount.
 */
export function V6PayShopStrip({
  shop,
  chainId,
  pricingSymbol,
  busy,
}: {
  shop: V6PayShop;
  chainId: number;
  pricingSymbol: string;
  busy: boolean;
}) {
  const cart = useShopCart();

  const quantityOf = (tierId: number) =>
    cart.items.find((i) => Number(i.tierId) === tierId && i.chainId === chainId)?.quantity ?? 0;

  const setTierQuantity = (tier: V6PayShopTier, quantity: number) => {
    const existing = cart.items.find(
      (i) => Number(i.tierId) === tier.id && i.chainId === chainId,
    );
    if (!existing && quantity > 0) {
      cart.add({
        tierId: BigInt(tier.id),
        quantity,
        price: effectiveTierPrice(tier.price, tier.discountPercent),
        currency: shop.pricingCurrency,
        name: tier.name ?? `Item #${tier.id}`,
        imageUri: tier.image ?? undefined,
        hook: shop.hook,
        chainId,
      });
      return;
    }
    cart.setQuantity(BigInt(tier.id), chainId, quantity);
  };

  if (shop.tiers.length === 0) return null;

  return (
    <div className="mb-3">
      <div className="text-sm text-zinc-500 mb-1.5">Shop</div>
      <div className="flex gap-2 overflow-x-auto pb-1">
        {shop.tiers.slice(0, 12).map((tier) => {
          const qty = quantityOf(tier.id);
          const soldOut = !tier.unlimited && tier.remaining === 0;
          const cap = tier.unlimited ? 99 : tier.remaining;
          const price = effectiveTierPrice(tier.price, tier.discountPercent);
          const name = tier.name ?? `Item #${tier.id}`;
          return (
            <div
              key={tier.id}
              className={`relative w-24 shrink-0 overflow-hidden border bg-white text-center transition ${
                qty > 0 ? "border-teal-500" : "border-zinc-200 hover:border-teal-300"
              } ${soldOut ? "opacity-40" : ""}`}
            >
              {qty > 0 ? (
                <span className="absolute right-1.5 top-1.5 z-10 flex h-5 min-w-5 items-center justify-center rounded-full bg-teal-500 px-1 text-[10px] font-medium text-white">
                  {qty}
                </span>
              ) : null}
              <button
                type="button"
                onClick={() => {
                  if (soldOut || qty > 0) return;
                  setTierQuantity(tier, 1);
                }}
                disabled={busy || soldOut}
                className="block w-full p-2 pb-1 disabled:cursor-not-allowed"
                title={soldOut ? `${name} is sold out` : `Add ${name} to cart`}
              >
                {tier.image ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={tier.image}
                    alt={name}
                    loading="lazy"
                    decoding="async"
                    className="mx-auto h-14 w-14 rounded object-cover"
                  />
                ) : (
                  <span className="mx-auto flex h-14 w-14 items-center justify-center rounded bg-zinc-100 text-xs text-zinc-500">
                    #{tier.id}
                  </span>
                )}
                <span className="mt-1 block truncate text-[11px] text-zinc-900">{name}</span>
              </button>
              {soldOut ? (
                <p className="px-2 pb-2 text-[10px] text-zinc-500">Sold out</p>
              ) : qty === 0 ? (
                <button
                  type="button"
                  onClick={() => setTierQuantity(tier, 1)}
                  disabled={busy}
                  className="w-full px-2 pb-2 text-[11px] text-zinc-600 hover:text-zinc-900"
                >
                  {formatPayAmount(price, shop.pricingDecimals)} {pricingSymbol}
                </button>
              ) : (
                <div className="flex items-center justify-center gap-1.5 px-2 pb-2">
                  <button
                    type="button"
                    onClick={() => setTierQuantity(tier, qty - 1)}
                    disabled={busy}
                    aria-label={`Remove one ${name}`}
                    className="flex h-5 w-5 items-center justify-center rounded-full border border-zinc-300 text-xs text-zinc-700 disabled:opacity-40"
                  >
                    −
                  </button>
                  <span className="min-w-4 text-center text-xs tabular-nums">{qty}</span>
                  <button
                    type="button"
                    onClick={() => setTierQuantity(tier, Math.min(cap, qty + 1))}
                    disabled={busy || qty >= cap}
                    aria-label={`Add one ${name}`}
                    className="flex h-5 w-5 items-center justify-center rounded-full border border-zinc-300 text-xs text-zinc-700 disabled:opacity-40"
                  >
                    +
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
