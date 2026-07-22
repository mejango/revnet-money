import type { Ruleset } from "@/app/[slug]/terms/getRulesets";
import { isUsd, toBaseCurrencyId } from "@/lib/currency";
import { applyNanaFee, applyRevFee, generateFeeData } from "@/lib/feeHelpers";
import { calculatePriceAtTimestamp } from "@/lib/issuancePrice";
import { getUnitValue } from "@/lib/reclaimableSurplus";
import { getTokenConfigForChain, getTokenSymbolFromAddress } from "@/lib/tokenUtils";
import { ETH_CURRENCY_ID, NATIVE_TOKEN, USD_CURRENCY_ID } from "@bananapus/nana-sdk-core";
import type { Address } from "viem";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/wagmiConfig", () => ({ getViemPublicClient: vi.fn() }));

describe("contract-derived monetary display math", () => {
  it("applies the Revnet and Juicebox cash-out fees in integer arithmetic", () => {
    expect(applyRevFee(10_000n)).toBe(9_750n);
    expect(applyNanaFee(10_000n)).toBe(9_750n);
    expect(applyRevFee(1n)).toBe(0n);
  });

  it("derives issuance price after complete ruleset cycles", () => {
    const rulesets: Ruleset[] = [
      {
        id: 1,
        start: 1_000,
        duration: 100,
        weight: "1000000000000000000000",
        weightCutPercent: 0.1,
      },
    ];

    expect(calculatePriceAtTimestamp(999, rulesets)).toBeUndefined();
    expect(calculatePriceAtTimestamp(1_000, rulesets)).toBeCloseTo(1 / 1_000);
    expect(calculatePriceAtTimestamp(1_250, rulesets)).toBeCloseTo(1 / 810);
  });

  it("returns no price for a zero issuance weight", () => {
    expect(
      calculatePriceAtTimestamp(1_000, [
        { id: 1, start: 1_000, duration: 0, weight: "0", weightCutPercent: 0 },
      ]),
    ).toBeUndefined();
  });

  it("keeps base-currency ids distinct from token-keyed accounting currencies", () => {
    expect(toBaseCurrencyId(1)).toBe(ETH_CURRENCY_ID);
    expect(toBaseCurrencyId(61166)).toBe(ETH_CURRENCY_ID);
    expect(toBaseCurrencyId(2)).toBe(USD_CURRENCY_ID(6));
    expect(isUsd("usdc")).toBe(true);
    expect(isUsd("ETH")).toBe(false);
  });

  it("preserves custom token address, decimals, and currency from indexed contract data", () => {
    const token = "0x000000000000000000000000000000000000cafe" as Address;
    const config = getTokenConfigForChain(
      {
        suckerGroup: {
          projects: {
            items: [{ chainId: 8453, token, currency: "123456", decimals: 8 }],
          },
        },
      },
      8453,
    );

    expect(config).toEqual({ token, currency: 123456, decimals: 8 });
    expect(getTokenSymbolFromAddress(token)).toBe("TOKEN");
    expect(getTokenSymbolFromAddress(NATIVE_TOKEN)).toBe("ETH");
  });

  it("computes per-token unit value without changing either denomination", () => {
    expect(getUnitValue({ value: "2", decimals: 6 }, { value: "4", decimals: 18 })).toBeCloseTo(
      0.5,
    );
    expect(getUnitValue(null, { value: "1", decimals: 18 })).toBe(0);
    expect(getUnitValue({ value: "1", decimals: 18 }, { value: "0", decimals: 18 })).toBe(0);
  });

  it("returns a harmless zero-cost chart for invalid loan input", () => {
    expect(generateFeeData({ grossBorrowedEth: Number.NaN, prepaidPercent: "0" })).toEqual([
      { year: 0, totalCost: 0 },
      { year: 10, totalCost: 0 },
    ]);
  });

  it("keeps loan costs bounded and monotonic over the displayed ten-year horizon", () => {
    const points = generateFeeData({ grossBorrowedEth: 100, prepaidPercent: "0" });

    expect(points[0]).toEqual({ year: 0, totalCost: 100 });
    expect(points.at(-1)).toMatchObject({ year: 10 });
    expect(points.at(-1)?.totalCost).toBeGreaterThan(points[0].totalCost);
    expect(
      points.every((point, index) => index === 0 || point.totalCost >= points[index - 1].totalCost),
    ).toBe(true);
  });
});
