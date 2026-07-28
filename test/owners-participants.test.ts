import {
  aggregateParticipants,
  PARTICIPANTS_FETCH_LIMIT,
} from "@/app/[slug]/components/v6/owners/accounts/participantsAggregate";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("owners All-card participants", () => {
  it("caps the fetch explicitly at the proxy's maximum", () => {
    expect(PARTICIPANTS_FETCH_LIMIT).toBe(1000);

    // The card must pass the explicit limit — an omitted limit falls back to
    // the server default and silently truncates large holder sets.
    const source = readFileSync(
      resolve(process.cwd(), "src/app/[slug]/components/v6/owners/accounts/V6AllCard.tsx"),
      "utf8",
    );
    expect(source).toMatch(/limit:\s*PARTICIPANTS_FETCH_LIMIT/u);
  });

  it("aggregates each account across chains", () => {
    const rows = [
      { address: "0xa", chainId: 1, balance: "10", volume: "5" },
      { address: "0xa", chainId: 10, balance: "7", volume: "1" },
      { address: "0xb", chainId: 1, balance: "3", volume: "0" },
    ];
    const aggregated = aggregateParticipants(rows);
    expect(aggregated).toHaveLength(2);
    const a = aggregated.find((p) => p.address === "0xa");
    expect(a?.balance).toBe(17n);
    expect(a?.volume).toBe(6n);
    expect(a?.chains).toEqual([1, 10]);
    const b = aggregated.find((p) => p.address === "0xb");
    expect(b?.balance).toBe(3n);
  });

  it("skips null rows", () => {
    expect(
      aggregateParticipants([null, { address: "0xa", chainId: 1, balance: "1", volume: "0" }]),
    ).toHaveLength(1);
  });
});
