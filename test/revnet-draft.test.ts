import { createSchema } from "@/app/create/helpers/createSchema";
import { parseRevnetDraft, revnetDraftFileName } from "@/lib/revnet-draft";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("the published example draft", () => {
  // /skill.md and /llms.txt send agents to this file, so it has to keep importing.
  const source = readFileSync("public/examples/revnet.jb", "utf8");

  it("imports every value it states and needs only an operator and a split recipient", () => {
    const file = JSON.parse(source);
    const parsed = parseRevnetDraft(source);
    expect(file).toMatchObject({ v: 1, app: "revnet.money" });
    expect(parsed).toMatchObject(file.data);

    const result = createSchema.safeParse(parsed);
    expect(result.success ? [] : result.error.issues.map((issue) => issue.path.join("."))).toEqual([
      "stages.0.splits.0.defaultBeneficiary",
      "stages.1.splits.0.defaultBeneficiary",
      "operator",
    ]);
  });
});

describe("Revnet .jb drafts", () => {
  it("imports the native wrapper into whitelisted create-form values", () => {
    const parsed = parseRevnetDraft(
      JSON.stringify({
        v: 1,
        app: "revnet.money",
        data: {
          name: "A revnet",
          description: "A durable network",
          tokenSymbol: "REV",
          reserveAsset: "USDC",
          issuanceBaseCurrency: "USD",
          chainIds: [1, "10", "invalid"],
          operator: [{ chainId: 1, address: "0x1111111111111111111111111111111111111111" }],
          stages: [
            {
              initialIssuance: "100",
              priceCeilingIncreasePercentage: "10",
              priceCeilingIncreaseFrequency: "30",
              priceFloorTaxIntensity: "20",
              pause721Transfers: false,
              stageStart: "0",
              splits: [],
              autoIssuance: [],
              ignored: "not imported",
            },
          ],
          ignored: "not imported",
        },
      }),
    );

    expect(parsed).toMatchObject({
      name: "A revnet",
      description: "A durable network",
      tokenSymbol: "REV",
      reserveAsset: "USDC",
      issuanceBaseCurrency: "USD",
      chainIds: [1, 10],
      operator: [{ chainId: "1", address: "0x1111111111111111111111111111111111111111" }],
    });
    expect(parsed.stages).toHaveLength(1);
    expect(parsed.stages[0]).not.toHaveProperty("pause721Transfers");
    expect(parsed.stages[0]).not.toHaveProperty("ignored");
    expect(parsed).not.toHaveProperty("ignored");
  });

  it("rejects JSON which does not contain a Revnet create draft", () => {
    expect(() => parseRevnetDraft(JSON.stringify({ name: "not enough" }))).toThrow(
      /No Revnet create draft/,
    );
  });

  it("keeps a passed start waiting for a new date across a second restore", () => {
    const draft = (start: unknown) =>
      JSON.stringify({ name: "A", stages: [{ futureStartTimestamp: start }] });
    const once = parseRevnetDraft(draft(1));
    expect(once.stages[0].futureStartTimestamp).toBeNull();
    const twice = parseRevnetDraft(draft(once.stages[0].futureStartTimestamp));
    expect(twice.stages[0].futureStartTimestamp).toBeNull();
  });

  it("keeps every shop item a draft holds", () => {
    const items = Array.from({ length: 65 }, (_, index) => ({ name: `Item ${index}`, price: "1" }));
    const parsed = parseRevnetDraft(JSON.stringify({ name: "A", stages: [{}], store: { items } }));
    expect(parsed.store?.items).toHaveLength(65);
  });

  it("uses a stable .jb filename", () => {
    expect(revnetDraftFileName("My Useful Revnet!")).toBe("my-useful-revnet.jb");
    expect(revnetDraftFileName("")).toBe("revnet.jb");
  });
});
