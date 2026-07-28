import {
  dedupeOwnedNfts,
  dedupeToHighestVersion,
  projectRefKey,
  projectRefsWhere,
} from "@/lib/accountHoldings";
import { describe, expect, it } from "vitest";

describe("dedupeToHighestVersion", () => {
  it("keeps the highest-version row per (chainId, projectId)", () => {
    const rows = [
      { chainId: 1, projectId: 4, version: 5, balance: "100" },
      { chainId: 1, projectId: 4, version: 6, balance: "100" },
      { chainId: 1, projectId: 4, version: 4, balance: "7" },
    ];
    expect(dedupeToHighestVersion(rows)).toEqual([
      { chainId: 1, projectId: 4, version: 6, balance: "100" },
    ]);
  });

  it("does not merge across chains or projects", () => {
    const rows = [
      { chainId: 1, projectId: 4, version: 6 },
      { chainId: 8453, projectId: 4, version: 5 },
      { chainId: 1, projectId: 9, version: 5 },
    ];
    expect(dedupeToHighestVersion(rows)).toHaveLength(3);
  });
});

describe("dedupeOwnedNfts", () => {
  it("collapses per-version duplicates of the same token", () => {
    const rows = [
      { chainId: 1, projectId: 4, version: 4, tokenId: "3000000023" },
      { chainId: 1, projectId: 4, version: 5, tokenId: "3000000023" },
    ];
    expect(dedupeOwnedNfts(rows)).toEqual([
      { chainId: 1, projectId: 4, version: 5, tokenId: "3000000023" },
    ]);
  });

  it("keeps same-numbered tokens from different projects and chains", () => {
    const rows = [
      { chainId: 1, projectId: 4, version: 6, tokenId: "1000000001" },
      { chainId: 1, projectId: 9, version: 6, tokenId: "1000000001" },
      { chainId: 8453, projectId: 4, version: 6, tokenId: "1000000001" },
    ];
    expect(dedupeOwnedNfts(rows)).toHaveLength(3);
  });
});

describe("projectRefsWhere", () => {
  it("builds explicit AND groups per unique versioned ref", () => {
    const where = projectRefsWhere([
      { chainId: 1, projectId: 8, version: 6 },
      { chainId: 1, projectId: 8, version: 6 },
      { chainId: 8453, projectId: 119, version: 5 },
    ]);
    expect(where).toEqual({
      OR: [
        { AND: [{ chainId: 1 }, { projectId: 8 }, { version: 6 }] },
        { AND: [{ chainId: 8453 }, { projectId: 119 }, { version: 5 }] },
      ],
    });
  });

  it("returns null when there is nothing to look up", () => {
    expect(projectRefsWhere([])).toBeNull();
  });

  it("keys lookups by chain, project, and version together", () => {
    // Same projectId names different projects across protocol versions.
    expect(projectRefKey({ chainId: 1, projectId: 8, version: 6 })).not.toBe(
      projectRefKey({ chainId: 1, projectId: 8, version: 5 }),
    );
  });
});
