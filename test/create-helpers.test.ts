import {
  calculatePickupIssuance,
  getCurrentStageDuration,
  getResolvedIssuance,
} from "@/app/create/helpers/calculatePickupIssuance";
import { createSchema } from "@/app/create/helpers/createSchema";
import { calculateFinalStageStarts } from "@/app/create/helpers/recalculateStageStarts";
import { addressSchema, stageSchema } from "@/app/create/helpers/stageSchema";
import type { StageData } from "@/app/create/types";
import { describe, expect, it } from "vitest";
import { validRevnetForm } from "./fixtures/revnet";

function stage(overrides: Partial<StageData> = {}): StageData {
  return {
    initialIssuance: "1000",
    priceCeilingIncreasePercentage: "10",
    priceCeilingIncreaseFrequency: "30",
    priceFloorTaxIntensity: "20",
    autoIssuance: [],
    splits: [],
    stageStart: "30",
    ...overrides,
  };
}

describe("create form schema baseline", () => {
  it("accepts a complete deployment fixture", () => {
    expect(createSchema.safeParse(validRevnetForm()).success).toBe(true);
  });

  it("rejects malformed addresses at every address boundary", () => {
    expect(addressSchema.safeParse("not-an-address").success).toBe(false);

    const invalidOperator = validRevnetForm();
    invalidOperator.operator[0].address = "not-an-address";
    expect(createSchema.safeParse(invalidOperator).success).toBe(false);

    const invalidBeneficiary = validRevnetForm();
    invalidBeneficiary.stages[0].splits[0].defaultBeneficiary = "not-an-address";
    expect(createSchema.safeParse(invalidBeneficiary).success).toBe(false);
  });

  it("requires identity, at least one chain, and at least one stage", () => {
    const form = validRevnetForm();
    form.name = " ";
    form.chainIds = [];
    form.stages = [];
    const result = createSchema.safeParse(form);

    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((issue) => issue.path.join("."));
      expect(paths).toEqual(expect.arrayContaining(["name", "chainIds", "stages"]));
    }
  });

  it("requires all stage fields which feed contract encoding", () => {
    const result = stageSchema.safeParse({
      ...stage(),
      initialIssuance: "",
      priceCeilingIncreasePercentage: "",
      priceCeilingIncreaseFrequency: "",
      priceFloorTaxIntensity: "",
      stageStart: "",
    });

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues).toHaveLength(5);
  });
});

describe("stage timing and inherited issuance helpers", () => {
  it("resolves cut-count timing without mutating the form stages", () => {
    const stages = [
      stage({ priceCeilingIncreaseFrequency: "14", stageStart: "0" }),
      stage({ stageStart: "999", stageStartCuts: "3" }),
    ];
    const original = structuredClone(stages);

    const resolved = calculateFinalStageStarts(stages);

    expect(resolved[0]).toEqual(stages[0]);
    expect(resolved[1]).toMatchObject({ stageStart: "42", stageStartCuts: undefined });
    expect(stages).toEqual(original);
  });

  it("preserves direct timing when there is no valid cuts-based duration", () => {
    const stages = [
      stage({ priceCeilingIncreaseFrequency: "0" }),
      stage({ stageStart: "45", stageStartCuts: "3" }),
    ];
    expect(calculateFinalStageStarts(stages)[1]).toEqual(stages[1]);
  });

  it("applies the previous stage's issuance cuts at exact cycle boundaries", () => {
    const previous = stage({
      initialIssuance: "1000",
      priceCeilingIncreasePercentage: "10",
      priceCeilingIncreaseFrequency: "30",
    });

    expect(calculatePickupIssuance(previous, 0)).toBeNull();
    expect(calculatePickupIssuance(previous, "0")).toBe("1000.000");
    expect(calculatePickupIssuance(previous, "29")).toBe("1000.000");
    expect(calculatePickupIssuance(previous, "30")).toBe("900.000");
    expect(calculatePickupIssuance(previous, "90")).toBe("729.000");
  });

  it("resolves chained pickup stages recursively", () => {
    const stages = [
      stage({ initialIssuance: "1000", stageStart: "0" }),
      stage({ pickUpFromPrevious: true, stageStart: "30" }),
      stage({ pickUpFromPrevious: true, stageStart: "30" }),
    ];

    expect(getCurrentStageDuration(stages[1], stages[0])).toBe("30");
    expect(getResolvedIssuance(stages[1], 1, stages)).toBe("900.000");
    expect(getResolvedIssuance(stages[2], 2, stages)).toBe("810.000");
  });
});
