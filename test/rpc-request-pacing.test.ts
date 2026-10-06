import { createPacedRpcFetch } from "@/lib/rpc-request-pacing";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => vi.useRealTimers());

describe("RPC egress pacing", () => {
  it("starts requests across chains at intervals without waiting for earlier responses", async () => {
    vi.useFakeTimers();
    const resolve: ((response: Response) => void)[] = [];
    const starts: number[] = [];
    const send = vi.fn(() => {
      starts.push(Date.now());
      return new Promise<Response>((done) => resolve.push(done));
    });
    const paced = createPacedRpcFetch(send);
    const results = [1, 10, 8453, 42161].map((chain) => paced(`/rpc/${chain}`));
    await vi.advanceTimersByTimeAsync(0);
    expect(send).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(374);
    expect(send).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(1);
    expect(send).toHaveBeenCalledTimes(4);
    expect(starts.map((time) => time - starts[0])).toEqual([0, 125, 250, 375]);
    resolve.forEach((done) => done(new Response("ok")));
    await Promise.all(results);
  });

  it("removes canceled requests from the queue without blocking later requests", async () => {
    vi.useFakeTimers();
    const send = vi.fn().mockResolvedValue(new Response("ok"));
    const paced = createPacedRpcFetch(send);
    await paced("/first");
    const controller = new AbortController();
    const canceled = paced("/canceled", { signal: controller.signal });
    const rejected = expect(canceled).rejects.toBe("closed");
    const last = paced("/last");
    controller.abort("closed");
    await rejected;
    await vi.advanceTimersByTimeAsync(125);
    await last;
    expect(send.mock.calls.map(([url]) => url)).toEqual(["/first", "/last"]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("honors Retry-After across queued chains", async () => {
    vi.useFakeTimers();
    const send = vi
      .fn()
      .mockResolvedValueOnce(new Response("busy", { status: 429, headers: { "Retry-After": "2" } }))
      .mockResolvedValue(new Response("ok"));
    const paced = createPacedRpcFetch(send);
    await paced("/rpc/1");
    const next = paced("/rpc/10");
    await vi.advanceTimersByTimeAsync(1999);
    expect(send).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await next;
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("does not block the queue after a synchronous fetch failure", async () => {
    vi.useFakeTimers();
    const failure = new Error("network failed");
    const send = vi
      .fn()
      .mockImplementationOnce(() => {
        throw failure;
      })
      .mockResolvedValue(new Response("ok"));
    const paced = createPacedRpcFetch(send);
    await expect(paced("/first")).rejects.toBe(failure);
    const next = paced("/next");
    await vi.advanceTimersByTimeAsync(125);
    await expect(next).resolves.toBeInstanceOf(Response);
  });
});
