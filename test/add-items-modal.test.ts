import { buildTierConfigs, newDraftItem } from "@/app/[slug]/components/v6/shop/AddItemsModal";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const beneficiaryA = "0x1111111111111111111111111111111111111111";
const beneficiaryB = "0x2222222222222222222222222222222222222222";

describe("revnet shop item editor", () => {
  it("encodes every advanced item setting into adjustTiers", () => {
    const item = {
      ...newDraftItem(),
      price: "25",
      supply: "100",
      category: "3",
      reserveFrequency: "10",
      reserveBeneficiary: beneficiaryA,
      discountPct: "12.5",
      votingUnits: "7",
      splits: [
        { percent: "20", beneficiary: beneficiaryA },
        { percent: "30", beneficiary: beneficiaryB },
      ],
      allowOwnerMint: true,
      transfersPausable: true,
      cantBeRemoved: true,
      allowCredits: false,
      operatorCanEditDiscount: false,
    };

    const result = buildTierConfigs([item], 6);
    expect(typeof result).not.toBe("string");
    if (typeof result === "string") return;

    expect(result[0]).toMatchObject({
      price: 25_000_000n,
      initialSupply: 100,
      category: 3,
      reserveFrequency: 10,
      reserveBeneficiary: beneficiaryA,
      discountPercent: 25,
      votingUnits: 7,
      splitPercent: 500_000_000,
      flags: {
        allowOwnerMint: true,
        transfersPausable: true,
        useVotingUnits: true,
        cantBeRemoved: true,
        cantIncreaseDiscountPercent: true,
        cantBuyWithCredits: true,
      },
    });
    expect(result[0].splits.map((split) => split.percent)).toEqual([400_000_000, 600_000_000]);
    expect(result[0].splits.map((split) => split.beneficiary)).toEqual([
      beneficiaryA,
      beneficiaryB,
    ]);
  });

  it("rejects sales splits above 100 percent", () => {
    const item = {
      ...newDraftItem(),
      price: "1",
      splits: [
        { percent: "60", beneficiary: beneficiaryA },
        { percent: "50", beneficiary: beneficiaryB },
      ],
    };
    expect(buildTierConfigs([item], 6)).toBe("sales splits cannot add up to more than 100%.");
  });

  it("keeps the basic fields compact and the protocol controls behind More options", () => {
    const source = readFileSync("src/app/[slug]/components/v6/shop/AddItemsModal.tsx", "utf8");
    for (const label of [
      "Upload media",
      "Short description (optional)",
      "More options",
      "Split sales",
      "Discount",
      "Reserve inventory",
      "Voting power",
      "Item rules",
      "Add on",
      "Review items",
    ]) {
      expect(source).toContain(label);
    }
    expect(source.indexOf("canAdjust721Tiers")).toBeLessThan(
      source.indexOf("pinMediaFile(item.mediaFile)"),
    );
    expect(source.indexOf("const draftConfigs = buildTierConfigs")).toBeLessThan(
      source.indexOf("pinMediaFile(item.mediaFile)"),
    );
  });
});
