import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react")>()),
  cache: <T>(callback: T) => callback,
}));

import { bendystrawFetch } from "@/graphql/bendystrawClient";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("Bendystraw transport resilience", () => {
  it("returns successful and non-retryable responses without duplicating a request", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("bad query", { status: 400 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(bendystrawFetch("https://bendystraw.invalid/graphql")).resolves.toMatchObject({
      status: 400,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retries rate limits and temporary server failures using the bounded schedule", async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 429 }))
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(new Response("ok", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const request = bendystrawFetch("https://bendystraw.invalid/graphql");
    await vi.runAllTimersAsync();

    await expect(request).resolves.toMatchObject({ status: 200 });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("retries transient network errors but never retries an explicit abort", async () => {
    vi.useFakeTimers();
    const networkFetch = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("network unavailable"))
      .mockResolvedValueOnce(new Response("ok", { status: 200 }));
    vi.stubGlobal("fetch", networkFetch);

    const recovered = bendystrawFetch("https://bendystraw.invalid/graphql");
    await vi.runAllTimersAsync();
    await expect(recovered).resolves.toMatchObject({ status: 200 });
    expect(networkFetch).toHaveBeenCalledTimes(2);

    const abort = new DOMException("cancelled", "AbortError");
    const abortedFetch = vi.fn().mockRejectedValue(abort);
    vi.stubGlobal("fetch", abortedFetch);
    await expect(bendystrawFetch("https://bendystraw.invalid/graphql")).rejects.toBe(abort);
    expect(abortedFetch).toHaveBeenCalledTimes(1);

    const timeout = Object.assign(new Error("timed out"), { name: "TimeoutError" });
    const timedOutFetch = vi.fn().mockRejectedValue(timeout);
    vi.stubGlobal("fetch", timedOutFetch);
    await expect(bendystrawFetch("https://bendystraw.invalid/graphql")).rejects.toBe(timeout);
    expect(timedOutFetch).toHaveBeenCalledTimes(1);
  });
});
