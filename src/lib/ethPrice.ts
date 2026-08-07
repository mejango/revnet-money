import { unstable_cache } from "next/cache";

/**
 * Throws on failure rather than returning a fallback, so `unstable_cache` stores only real
 * prices. A cached failure would outlive the outage that caused it by the full revalidate
 * window.
 */
const cachedEthPrice = unstable_cache(
  async (): Promise<number> => {
    const response = await fetch("https://juicebox.money/api/juicebox/prices/ethusd");
    if (!response.ok) throw new Error(`ETH price feed returned ${response.status}`);
    const data = await response.json();
    const price = parseFloat(data.price);
    if (!Number.isFinite(price) || price <= 0) throw new Error("ETH price feed returned no price");
    return price;
  },
  ["eth-price"],
  { revalidate: 1200 }, // 20 minutes
);

/**
 * The ETH price in USD, or null when the feed is unavailable.
 *
 * Null rather than a stand-in number: every caller here converts a real treasury balance into
 * a figure someone reads as fact, and the shields badge publishes that figure OFF-SITE. A
 * hard-coded fallback used to sit in this function, which meant callers written to degrade
 * honestly on a missing price — dropping unrankable rows, showing the token amount alone —
 * could never reach those paths, and quietly priced ETH at the fallback instead.
 */
export async function fetchEthPrice(): Promise<number | null> {
  try {
    return await cachedEthPrice();
  } catch (error) {
    console.error("Failed to fetch ETH price:", error);
    return null;
  }
}
