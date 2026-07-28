import {
  AccountActivityEventsOperation,
  AccountPermissionHoldersOperation,
  AccountTokenBalancesOperation,
  BENDYSTRAW_OPERATIONS,
  BROWSER_BENDYSTRAW_OPERATIONS,
  IndexedPoolSwapsOperation,
  OwnedNftsOperation,
  ProjectOperation,
  ProjectsByOwnerOperation,
  ShieldGroupOperation,
  getBrowserOperationById,
} from "@/lib/bendystraw/operations";
import { BENDYSTRAW_QUERY_REGISTRY } from "@/lib/bendystraw/registry.server";
import { describe, expect, it } from "vitest";

describe("reviewed Bendystraw operations", () => {
  it("maps every public operation ID to exactly one named, read-only server document", () => {
    const ids = BENDYSTRAW_OPERATIONS.map((operation) => operation.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(Object.keys(BENDYSTRAW_QUERY_REGISTRY).sort()).toEqual([...ids].sort());

    for (const operation of BENDYSTRAW_OPERATIONS) {
      const registered = BENDYSTRAW_QUERY_REGISTRY[operation.id];
      expect(registered.query.trim()).toMatch(
        new RegExp(`^query\\s+${registered.operationName}\\b`, "u"),
      );
      expect(registered.query).not.toMatch(/\b(?:mutation|subscription)\b/iu);
    }
  });

  it("only exposes operations with browser consumers through the public proxy", () => {
    expect(BROWSER_BENDYSTRAW_OPERATIONS).toContain(ProjectOperation);
    expect(getBrowserOperationById(ProjectOperation.id)).toBe(ProjectOperation);
    expect(BROWSER_BENDYSTRAW_OPERATIONS).not.toContain(ShieldGroupOperation);
    expect(getBrowserOperationById(ShieldGroupOperation.id)).toBeUndefined();
  });

  it("rejects extra keys, invalid scalars, and unbounded pagination at the BFF boundary", () => {
    expect(ProjectOperation.validateVariables({ chainId: 1, projectId: 1, version: 6 })).toBe(true);
    expect(
      ProjectOperation.validateVariables({
        chainId: 1,
        projectId: 1,
        version: 6,
        query: "arbitrary",
      }),
    ).toBe(false);
    expect(
      IndexedPoolSwapsOperation.validateVariables({
        chainId: 1,
        projectId: 1,
        version: 6,
        limit: 1001,
        offset: 0,
      }),
    ).toBe(false);
  });

  it("exposes the account-view operations through the browser proxy with bounded variables", () => {
    for (const operation of [
      AccountActivityEventsOperation,
      ProjectsByOwnerOperation,
      AccountPermissionHoldersOperation,
    ]) {
      expect(BENDYSTRAW_OPERATIONS).toContain(operation);
      expect(getBrowserOperationById(operation.id)).toBe(operation);
    }

    expect(AccountActivityEventsOperation.validateVariables({ address: "0xabc", limit: 25 })).toBe(
      true,
    );
    expect(
      AccountActivityEventsOperation.validateVariables({ address: "0xabc", limit: 1001 }),
    ).toBe(false);
    expect(AccountActivityEventsOperation.validateVariables({ limit: 25 })).toBe(false);
    expect(
      AccountActivityEventsOperation.validateData({
        activityEvents: { items: [], pageInfo: { hasNextPage: false, endCursor: null } },
      }),
    ).toBe(true);

    expect(
      ProjectsByOwnerOperation.validateVariables({ where: { owner: "0xabc", version: 6 } }),
    ).toBe(true);
    expect(ProjectsByOwnerOperation.validateVariables({ owner: "0xabc" })).toBe(false);
    expect(ProjectsByOwnerOperation.validateData({ projects: { items: [] } })).toBe(true);

    expect(
      AccountPermissionHoldersOperation.validateVariables({
        where: { operator: "0xabc", version: 6 },
      }),
    ).toBe(true);
    expect(AccountPermissionHoldersOperation.validateData({ permissionHolders: null })).toBe(true);
  });

  it("exposes the account holdings operations through the browser proxy with bounded variables", () => {
    for (const operation of [AccountTokenBalancesOperation, OwnedNftsOperation]) {
      expect(BENDYSTRAW_OPERATIONS).toContain(operation);
      expect(getBrowserOperationById(operation.id)).toBe(operation);
    }

    expect(AccountTokenBalancesOperation.validateVariables({ account: "0xabc", limit: 1000 })).toBe(
      true,
    );
    expect(AccountTokenBalancesOperation.validateVariables({ account: "0xabc", limit: 1001 })).toBe(
      false,
    );
    expect(AccountTokenBalancesOperation.validateVariables({ limit: 25 })).toBe(false);
    expect(AccountTokenBalancesOperation.validateVariables({ account: "0xabc", where: {} })).toBe(
      false,
    );
    expect(AccountTokenBalancesOperation.validateData({ participants: { items: [] } })).toBe(true);
    expect(AccountTokenBalancesOperation.validateData({ participants: null })).toBe(false);

    // The registered document pins the positive-balance filter and version 6 —
    // this app is V6-only, so other protocol versions never reach consumers —
    // and selects the credit/ERC-20 split plus the totalCount used to surface
    // the fetch cap.
    const registered = BENDYSTRAW_QUERY_REGISTRY[AccountTokenBalancesOperation.id];
    expect(registered.query).toMatch(/balance_gt:\s*"0"/u);
    expect(registered.query).toMatch(/version:\s*6/u);
    expect(registered.query).toMatch(/totalCount/u);
    expect(registered.query).toMatch(/creditBalance/u);
    expect(registered.query).toMatch(/erc20Balance/u);
    expect(BENDYSTRAW_QUERY_REGISTRY[OwnedNftsOperation.id].query).toMatch(/version/u);

    // Bendystraw stores per-version project rows: an unpinned project(chainId,
    // projectId) lookup can resolve a V4/V5 alias. The shield endpoint is
    // V6-only, so its registered document pins version 6.
    const shieldProject = BENDYSTRAW_QUERY_REGISTRY["shield-project.v1"];
    expect(shieldProject.query).toMatch(/version:\s*6/u);
  });

  it("requires the reviewed response root before data reaches consumers", () => {
    expect(ProjectOperation.validateData({ project: null })).toBe(true);
    expect(ProjectOperation.validateData({ projects: [] })).toBe(false);
    expect(ProjectOperation.validateData(null)).toBe(false);
    expect(
      IndexedPoolSwapsOperation.validateData({
        swapEvents: { items: [null], totalCount: 1 },
      }),
    ).toBe(false);
  });
});
