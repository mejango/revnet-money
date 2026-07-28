import {
  AccountActivityEventsOperation,
  AccountPermissionHoldersOperation,
  BENDYSTRAW_OPERATIONS,
  BROWSER_BENDYSTRAW_OPERATIONS,
  IndexedPoolSwapsOperation,
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
