import {
  payPanelLayoutClasses,
  paySettlementLabel,
} from "@/app/[slug]/components/v6/pay/payCardLayout";
import { describe, expect, it } from "vitest";

describe("v6 pay card shop-strip spacing", () => {
  it("uses natural height once the inventory resolves without previews", () => {
    expect(
      payPanelLayoutClasses({
        mode: "pay",
        shopLoading: false,
        shopTierCount: 0,
      }),
    ).toBe("py-0");
  });

  it("keeps the stable height until a possible preview strip is resolved", () => {
    expect(
      payPanelLayoutClasses({
        mode: "pay",
        shopLoading: true,
        shopTierCount: undefined,
      }),
    ).toBe("h-30 py-4");
    expect(
      payPanelLayoutClasses({
        mode: "pay",
        shopLoading: false,
        shopTierCount: 3,
      }),
    ).toBe("h-30 py-4");
  });

  it("does not reserve shop-preview spacing in add-balance mode", () => {
    expect(
      payPanelLayoutClasses({
        mode: "addbalance",
        shopLoading: true,
        shopTierCount: 3,
      }),
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
