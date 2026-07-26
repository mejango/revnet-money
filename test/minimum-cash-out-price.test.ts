import { describe, expect, it } from "vitest";
import { minimumCashOutPriceAtIssuancePrice } from "@/lib/minimumCashOutPrice";

describe("payment asymptote", () => {
  it("calculates the long-run payment asymptote", () => {
    expect(minimumCashOutPriceAtIssuancePrice(0.1, 2_000)).toBeCloseTo(
      0.08,
      10,
    );
  });

  it("returns zero without an issuance price", () => {
    expect(minimumCashOutPriceAtIssuancePrice(0, 2_000)).toBe(0);
  });
});
