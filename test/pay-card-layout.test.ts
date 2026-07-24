import { payPanelLayoutClasses } from "@/app/[slug]/components/v6/pay/payCardLayout";
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
