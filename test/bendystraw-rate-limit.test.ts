import { ProjectOperation } from "@/lib/bendystraw/operations";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

beforeEach(() => {
  process.env.NEXT_PUBLIC_BENDYSTRAW_URL = "https://bendystraw.example";
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("Bendystraw relay rate limit", () => {
  it("keeps the indexer's Retry-After on the 429 it throws", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}", { status: 429, headers: { "retry-after": "12" } })),
    );
    const { queryBendystraw } = await import("@/lib/bendystraw/query.server");

    const failure = queryBendystraw(1, ProjectOperation, {
      chainId: 1,
      projectId: 1,
      version: 6,
    }).catch((error: unknown) => error);
    await vi.runAllTimersAsync();

    expect(await failure).toMatchObject({ status: 429, retryAfter: "12" });
  });
});
