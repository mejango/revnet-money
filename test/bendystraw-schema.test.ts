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
  process.env.NEXT_PUBLIC_BENDYSTRAW_URL ?? "https://bendystraw.xyz/graphql",
  process.env.NEXT_PUBLIC_TESTNET_BENDYSTRAW_URL ?? "https://testnet.bendystraw.xyz/graphql",
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

describe("live Bendystraw schema contract", () => {
  it.each(ENDPOINTS)(
    "validates every registered document against %s",
    async (endpoint) => {
      const schema = await liveSchema(endpoint);
      const failures = Object.entries(BENDYSTRAW_QUERY_REGISTRY).flatMap(([id, registered]) =>
        validate(schema, parse(registered.query)).map((error) => `${id}: ${error.message}`),
      );

      expect(failures).toEqual([]);
    },
    30_000,
  );
});
