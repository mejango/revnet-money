import { pickRevnetOperator } from "@/lib/revnetOperator";
import { describe, expect, it } from "vitest";

const CURRENT = "0x1111111111111111111111111111111111111111";
const PREVIOUS = "0x2222222222222222222222222222222222222222";

describe("revnet operator selection", () => {
  it("prefers the operator that still holds permissions", () => {
    expect(
      pickRevnetOperator([
        { operator: PREVIOUS, permissions: [], isRevnetOperator: true },
        { operator: CURRENT, permissions: [1, 2], isRevnetOperator: true },
      ]),
    ).toBe(CURRENT);
  });

  it("uses the role-marked row while permission indexing catches up", () => {
    expect(
      pickRevnetOperator([{ operator: CURRENT, permissions: null, isRevnetOperator: true }]),
    ).toBe(CURRENT);
  });

  it("rejects invalid and explicitly non-operator rows", () => {
    expect(
      pickRevnetOperator([
        { operator: "not-an-address", permissions: [1], isRevnetOperator: true },
        { operator: PREVIOUS, permissions: [1], isRevnetOperator: false },
      ]),
    ).toBeNull();
  });
});
