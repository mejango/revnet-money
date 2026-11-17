import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const reads = vi.hoisted(() => ({ rulesets: vi.fn(), pool: vi.fn(), floor: vi.fn() }));
vi.mock("@/app/[slug]/terms/getRulesets", () => ({ getRulesets: reads.rulesets }));
vi.mock("@/lib/cashOutTax", () => ({ getCurrentCashOutTax: async () => 0 }));
vi.mock("@/app/[slug]/components/TokenPrice/getV4AmmPriceHistory", () => ({
  getV4AmmPriceHistory: reads.pool,
}));
vi.mock("@/app/[slug]/components/TokenPrice/getFloorPriceHistory", () => ({
  getFloorPriceHistory: reads.floor,
}));

let cache: typeof import("@/lib/server/projectDisplayCache");
let chart: typeof import("@/app/[slug]/components/TokenPrice/getTokenPriceChartData");

beforeEach(async () => {
  vi.useFakeTimers();
  vi.resetModules();
  reads.rulesets.mockReset().mockResolvedValue([]);
  reads.pool.mockReset().mockResolvedValue({ hasPool: false, data: [], reserves: [] });
  reads.floor.mockReset().mockResolvedValue([]);
  cache = await import("@/lib/server/projectDisplayCache");
  chart = await import("@/app/[slug]/components/TokenPrice/getTokenPriceChartData");
});
afterEach(() => {
  vi.useRealTimers();
});

describe("shared display read", () => {
  it("answers concurrent and repeated callers from one read until it goes stale", async () => {
    const read = vi.fn(async () => ({ value: read.mock.calls.length }));

    const [first, second] = await Promise.all([
      cache.sharedDisplayRead(["k"], read, { staleTime: 5_000 }),
      cache.sharedDisplayRead(["k"], read, { staleTime: 5_000 }),
    ]);
    expect(first).toBe(second);
    await cache.sharedDisplayRead(["k"], read, { staleTime: 5_000 });
    await cache.sharedDisplayRead(["other"], read, { staleTime: 5_000 });
    expect(read).toHaveBeenCalledTimes(2);

    vi.advanceTimersByTime(5_001);
    await expect(cache.sharedDisplayRead(["k"], read, { staleTime: 5_000 })).resolves.toEqual({
      value: 3,
    });
  });

  it("keeps neither a failure nor an answer the caller refuses", async () => {
    const read = vi.fn<() => Promise<string>>().mockRejectedValueOnce(new Error("down"));
    await expect(cache.sharedDisplayRead(["k"], read)).rejects.toThrow("down");
    read.mockResolvedValue("partial");
    await cache.sharedDisplayRead(["k"], read, { keep: () => false });
    await cache.sharedDisplayRead(["k"], read, { keep: () => false });
    expect(read).toHaveBeenCalledTimes(3);
  });
});

describe("price chart read", () => {
  const params = {
    projectId: "7",
    chainId: 1 as const,
    range: "3m" as const,
    suckerGroupId: "group",
    baseToken: { address: "0xeeee", symbol: "ETH", decimals: 18 },
  };

  it("pages the indexer once for the same chart within ten seconds, and again after", async () => {
    await chart.getTokenPriceChartData(params);
    await chart.getTokenPriceChartData(params);
    expect(reads.pool).toHaveBeenCalledTimes(1);

    await chart.getTokenPriceChartData({ ...params, range: "1y" });
    expect(reads.pool).toHaveBeenCalledTimes(2);

    vi.advanceTimersByTime(9_999);
    await chart.getTokenPriceChartData(params);
    expect(reads.pool).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(2);
    await chart.getTokenPriceChartData(params);
    expect(reads.pool).toHaveBeenCalledTimes(3);
  });

  it("asks again after an answer that is missing a source", async () => {
    reads.floor.mockRejectedValueOnce(new Error("indexer down"));
    const partial = await chart.getTokenPriceChartData(params);
    expect(partial.unavailableSources).toEqual(["cash out"]);

    const whole = await chart.getTokenPriceChartData(params);
    expect(whole.unavailableSources).toEqual([]);
    expect(reads.floor).toHaveBeenCalledTimes(2);
  });
});
