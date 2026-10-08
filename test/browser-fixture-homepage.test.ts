// @vitest-environment node
import { ActivityEventsOperation, ProjectErc20TickersOperation } from "@/lib/bendystraw/operations";
import { getRegisteredQuery } from "@/lib/bendystraw/registry.server";
import { compileBendystrawOperation } from "@bananapus/nana-sdk-core/bendystraw-operations";
import { describe, expect, it } from "vitest";
import { handleGraphql } from "../scripts/browser-fixture-server.mjs";

describe("populated homepage browser fixtures", () => {
  it.each([
    {
      operation: ActivityEventsOperation,
      variables: {
        where: { version: 6 },
        orderBy: "timestamp",
        orderDirection: "desc",
        limit: 100,
        offset: 0,
      },
      root: "activityEvents",
    },
    {
      operation: ProjectErc20TickersOperation,
      variables: {
        where: { chainId_in: [1], projectId_in: [1], version: 6 },
        limit: 200,
      },
      root: "deployErc20Events",
    },
  ])("satisfies the actual document contract for $root", ({ operation, variables, root }) => {
    const registered = getRegisteredQuery(operation.id)!;
    const contract = compileBendystrawOperation(registered.query);
    expect(contract.validateVariables(variables)).toBe(true);
    const data = handleGraphql({ ...registered, variables });
    expect(contract.validateData(data)).toBe(true);
    expect(operation.validateData(data)).toBe(true);
    expect(data[root].items).toHaveLength(1);
  });
});
