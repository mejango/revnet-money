import {
  payPanelLayoutClasses,
  paySettlementLabel,
} from "@/app/[slug]/components/v6/pay/payCardLayout";
import { describe, expect, it } from "vitest";

describe("v6 pay card shop-strip spacing", () => {
  it("starts where it will settle when the project has no shop", () => {
    // Most projects have none, so an unresolved inventory has to look like
    // the answer it will almost always get. Reserving the taller layout up
    // front made the card shrink under the pointer on nearly every load.
    expect(
      payPanelLayoutClasses({ mode: "pay", shopTierCount: undefined }),
    ).toBe("py-0");
    expect(payPanelLayoutClasses({ mode: "pay", shopTierCount: 0 })).toBe("py-0");
  });

  it("grows once there is a shop to preview", () => {
    expect(payPanelLayoutClasses({ mode: "pay", shopTierCount: 3 })).toBe(
      "h-30 py-4",
    );
  });

  it("does not reserve shop-preview spacing in add-balance mode", () => {
    expect(
      payPanelLayoutClasses({ mode: "addbalance", shopTierCount: 3 }),
    ).toBe("py-0");
  });
});

describe("v6 pay card settlement label", () => {
  it("calls every router/AMM settlement a swap", () => {
    expect(paySettlementLabel("swap")).toBe("Swap");
  });

  it("calls direct terminal settlement issuance", () => {
    expect(paySettlementLabel("multi")).toBe("Issuance");
  });
});
