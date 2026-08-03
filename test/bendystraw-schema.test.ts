import { PermissionHoldersOperation } from "@/lib/bendystraw/operations";
import { projectRefsWhere } from "@/lib/bendystraw/projectRefs";
import { BENDYSTRAW_QUERY_REGISTRY } from "@/lib/bendystraw/registry.server";
import {
  buildClientSchema,
  getIntrospectionQuery,
  parse,
  validate,
  type IntrospectionQuery,
} from "graphql";
import { describe, expect, it } from "vitest";

// Capture Node's real fetch before the deterministic unit-test setup installs
// its network guard. This file is intentionally the one live contract test.
const contractFetch = globalThis.fetch.bind(globalThis);

const ENDPOINTS = [
  process.env.BENDYSTRAW_SCHEMA_MAINNET_URL ?? "https://bendystraw.xyz/graphql",
  process.env.BENDYSTRAW_SCHEMA_TESTNET_URL ?? "https://testnet.bendystraw.xyz/graphql",
];

async function liveSchema(endpoint: string) {
  const url = new URL(endpoint);
  url.pathname = `${url.pathname.replace(/\/graphql\/?$/u, "").replace(/\/$/u, "")}/graphql`;
  url.search = "";
  url.hash = "";

  const response = await contractFetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      operationName: "IntrospectionQuery",
      query: getIntrospectionQuery({ descriptions: false }),
    }),
    signal: AbortSignal.timeout(15_000),
  });
  expect(response.ok, `${url.origin} schema request returned ${response.status}`).toBe(true);
  const envelope = (await response.json()) as {
    data?: IntrospectionQuery;
    errors?: Array<{ message?: string }>;
  };
  expect(envelope.errors, `${url.origin} rejected schema introspection`).toBeUndefined();
  expect(envelope.data, `${url.origin} returned no schema`).toBeDefined();
  return buildClientSchema(envelope.data!);
}

// Documents that query fields an unmerged indexer PR adds. They run behind a
// fallback — a schema error degrades to the onchain read — so shipping them
// ahead of the indexer is safe, but they cannot be validated until it deploys.
// Each entry names the PR that removes it, and the contract FAILS once the field
// exists, so the list cannot quietly rot after the feature lands.
const PENDING_SCHEMA_FIELDS = [
  {
    field: "buybackPoolPositions",
    reason: "peripheralist/bendystraw#24 — LP positions and lifetime fees",
  },
];

describe("live Bendystraw schema contract", () => {
  it.each(ENDPOINTS)(
    "validates every registered document against %s",
    async (endpoint) => {
      const schema = await liveSchema(endpoint);
      const failures = Object.entries(BENDYSTRAW_QUERY_REGISTRY).flatMap(([id, registered]) =>
        validate(schema, parse(registered.query)).map((error) => `${id}: ${error.message}`),
      );

      const live = new Set(Object.keys(schema.getQueryType()?.getFields() ?? {}));
      const shipped = PENDING_SCHEMA_FIELDS.filter(({ field }) => live.has(field));
      expect(
        shipped.map(({ field }) => field),
        "drop these from PENDING_SCHEMA_FIELDS — the endpoint serves them now",
      ).toEqual([]);

      const blocking = failures.filter(
        (failure) => !PENDING_SCHEMA_FIELDS.some(({ field }) => failure.includes(`\"${field}\"`)),
      );
      expect(blocking).toEqual([]);
    },
    30_000,
  );

  it("keeps an exact project-pair filter scoped to Artizen", async () => {
    const endpoint = ENDPOINTS[0];
    const registered = BENDYSTRAW_QUERY_REGISTRY[PermissionHoldersOperation.id];
    const response = await contractFetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        operationName: registered.operationName,
        query: registered.query,
        variables: {
          where: projectRefsWhere([{ chainId: 8453, projectId: 6, version: 6 }]),
          limit: 100,
          offset: 0,
        },
      }),
      signal: AbortSignal.timeout(15_000),
    });
    expect(response.ok).toBe(true);
    const envelope = (await response.json()) as {
      data?: {
        permissionHolders?: {
          items?: Array<{ chainId: number; projectId: number; version: number }>;
        } | null;
      };
      errors?: Array<{ message?: string }>;
    };
    expect(envelope.errors).toBeUndefined();
    const items = envelope.data?.permissionHolders?.items ?? [];
    expect(items.length).toBeGreaterThan(0);
    expect(items.every((item) => item.chainId === 8453)).toBe(true);
    expect(items.every((item) => item.projectId === 6)).toBe(true);
    expect(items.every((item) => item.version === 6)).toBe(true);
  }, 30_000);
});
