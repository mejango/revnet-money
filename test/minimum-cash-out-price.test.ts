import { describe, expect, it } from "vitest";
import { calculateMinimumCashOutPrice } from "@/app/[slug]/components/TokenPrice/getFloorPriceHistory";

describe("minimum cash-out price", () => {
  it("calculates the asymptotic per-token minimum", () => {
    expect(
      calculateMinimumCashOutPrice(
        100_000_000n,
        1_000n * 10n ** 18n,
        2_000,
        6,
      ),
    ).toBeCloseTo(0.08, 10);
  });

  it("returns zero without backing or supply", () => {
    expect(calculateMinimumCashOutPrice(0n, 10n ** 18n, 2_000, 18)).toBe(0);
    expect(calculateMinimumCashOutPrice(10n ** 18n, 0n, 2_000, 18)).toBe(0);
  });
});
