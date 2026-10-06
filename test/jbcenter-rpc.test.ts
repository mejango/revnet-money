import { jbCenterAppOrigin, jbCenterBaseUrl } from "@/lib/jbcenter-config";
import { jbCenterRpcTransport } from "@/lib/jbcenter-rpc";
import { createPublicClient } from "viem";
import { arbitrum, base, mainnet, optimism } from "viem/chains";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("Juicebox Center RPC transport", () => {
  it("paces browser egress across chain clients without waiting for responses", async () => {
    vi.resetModules();
    const { jbCenterRpcTransport: pacedTransport } = await import("@/lib/jbcenter-rpc");
    vi.useFakeTimers();
    const finish: (() => void)[] = [];
    const fetchMock = vi.fn(
      (url: string) =>
        new Promise<Response>((resolve) => {
          const chainId = Number(url.split("/").at(-1));
          finish.push(() =>
            resolve(
              new Response(
                JSON.stringify({
                  jsonrpc: "2.0",
                  id: 1,
                  result: `0x${chainId.toString(16)}`,
                }),
                { headers: { "content-type": "application/json" } },
              ),
            ),
          );
        }),
    );
    vi.stubGlobal("window", { fetch: fetchMock });
    const chains = [mainnet, optimism, base, arbitrum];
    const requests = chains.map((chain) =>
      createPublicClient({
        chain,
        transport: pacedTransport(chain.id),
      }).getChainId(),
    );
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(374);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchMock).toHaveBeenCalledTimes(4);
    finish.forEach((resolve) => resolve());
    await expect(Promise.all(requests)).resolves.toEqual(chains.map(({ id }) => id));
  });

  it("does not treat other localhost ports as trusted dev clients", () => {
    expect(jbCenterBaseUrl("http://localhost:3000")).toBe("https://juicebox.center");
    expect(jbCenterAppOrigin("http://localhost:3000")).toBe("https://revnet.money");
  });

  it("routes server reads through Center with the trusted app origin", async () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "http://127.0.0.1:4173");
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: "0x1" }), {
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("window", undefined);
    const client = createPublicClient({
      chain: mainnet,
      transport: jbCenterRpcTransport(mainnet.id),
    });

    await expect(client.getChainId()).resolves.toBe(mainnet.id);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://juicebox.center/v1/rpc/1");
    expect(new Headers(init.headers).get("origin")).toBe("https://revnet.money");
  });

  it("calls browser fetch with the Window receiver", async () => {
    const browserWindow = {
      fetch: vi.fn(function (this: unknown) {
        if (this !== browserWindow) throw new TypeError("Illegal invocation");
        return Promise.resolve(
          new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: "0x1" }), {
            headers: { "content-type": "application/json" },
          }),
        );
      }),
    };
    vi.stubGlobal("window", browserWindow);
    vi.stubGlobal(
      "fetch",
      vi.fn(function () {
        throw new TypeError("Illegal invocation");
      }),
    );
    const client = createPublicClient({
      chain: mainnet,
      transport: jbCenterRpcTransport(mainnet.id),
    });

    await expect(client.getChainId()).resolves.toBe(mainnet.id);
    expect(browserWindow.fetch).toHaveBeenCalledOnce();
  });

  it.each(["https://dev.revnet.money", "http://localhost:3002"])(
    "uses the configured dev Center and app origin for %s",
    async (siteUrl) => {
      vi.stubEnv("NEXT_PUBLIC_SITE_URL", siteUrl);
      const fetchMock = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: "0x1" }), {
          headers: { "content-type": "application/json" },
        }),
      );
      vi.stubGlobal("fetch", fetchMock);
      vi.stubGlobal("window", undefined);
      const client = createPublicClient({
        chain: mainnet,
        transport: jbCenterRpcTransport(mainnet.id),
      });

      await expect(client.getChainId()).resolves.toBe(mainnet.id);
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe("https://dev.juicebox.center/v1/rpc/1");
      expect(new Headers(init.headers).get("origin")).toBe(siteUrl);
    },
  );
});
