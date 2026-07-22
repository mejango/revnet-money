import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ bendystrawFetch: vi.fn() }));

vi.mock("@/graphql/bendystrawClient", () => ({
  bendystrawFetch: mocks.bendystrawFetch,
}));

import { POST as proxyBendystraw } from "@/app/api/bendystraw/[net]/[key]/graphql/route";
import { GET as proxyIpfs } from "@/app/api/ipfs/[...path]/route";
import { POST as pinJson } from "@/app/api/ipfs/pinJson/route";

const SITE = "https://app.revnet.example";
const INGRESS_TOKEN = "ingress-token-with-at-least-32-characters";
const CID = "bafkreihz5xk2crdko5mllpxbfa443m2o6pmzcmbg5b3uvif6ho4x45z674";

function jsonRequest(url: string, body: string, headers: Record<string, string> = {}) {
  return new NextRequest(url, {
    method: "POST",
    body,
    headers: { "content-type": "application/json", ...headers },
  });
}

beforeEach(() => {
  process.env.NEXT_PUBLIC_SITE_URL = SITE;
  process.env.NEXT_PUBLIC_BENDYSTRAW_URL = "https://bendystraw.example/base/path";
  process.env.NEXT_PUBLIC_TESTNET_BENDYSTRAW_URL = "https://testnet.bendystraw.example";
  process.env.ENABLE_PUBLIC_IPFS_PINNING = "false";
  process.env.INFURA_IPFS_PROJECT_ID = "project";
  process.env.INFURA_IPFS_API_SECRET = "secret";
  process.env.IPFS_PINNING_INGRESS_TOKEN = INGRESS_TOKEN;
  mocks.bendystrawFetch.mockReset();
});

afterEach(() => {
  delete process.env.NEXT_PUBLIC_SITE_URL;
  delete process.env.NEXT_PUBLIC_BENDYSTRAW_URL;
  delete process.env.NEXT_PUBLIC_TESTNET_BENDYSTRAW_URL;
  delete process.env.ENABLE_PUBLIC_IPFS_PINNING;
  delete process.env.INFURA_IPFS_PROJECT_ID;
  delete process.env.INFURA_IPFS_API_SECRET;
  delete process.env.IPFS_PINNING_INGRESS_TOKEN;
});

describe("IPFS pinning boundary", () => {
  it("is disabled by default and rejects requests which bypass the trusted ingress", async () => {
    const disabled = await pinJson(jsonRequest(`${SITE}/api/ipfs/pinJson`, "{}"));
    expect(disabled.status).toBe(503);

    process.env.ENABLE_PUBLIC_IPFS_PINNING = "true";
    const unauthorized = await pinJson(
      jsonRequest(`${SITE}/api/ipfs/pinJson`, "{}", { origin: SITE }),
    );
    expect(unauthorized.status).toBe(401);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("checks the exact origin, JSON syntax, and declared body limit before provider access", async () => {
    process.env.ENABLE_PUBLIC_IPFS_PINNING = "true";
    const ingress = { "x-revnet-pinning-ingress-token": INGRESS_TOKEN };

    expect(
      (
        await pinJson(
          jsonRequest(`${SITE}/api/ipfs/pinJson`, "{}", {
            ...ingress,
            origin: "https://evil.example",
          }),
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await pinJson(
          jsonRequest(`${SITE}/api/ipfs/pinJson`, "not-json", {
            ...ingress,
            origin: SITE,
          }),
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await pinJson(
          jsonRequest(`${SITE}/api/ipfs/pinJson`, "{}", {
            ...ingress,
            origin: SITE,
            "content-length": String(128 * 1024 + 1),
          }),
        )
      ).status,
    ).toBe(413);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("pins through the fixed provider with scoped credentials and validates the CID response", async () => {
    process.env.ENABLE_PUBLIC_IPFS_PINNING = "true";
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json(
          { Hash: CID },
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(Response.json({ Hash: "bafy-not-a-cid" }));
    vi.stubGlobal("fetch", fetchMock);

    const response = await pinJson(
      jsonRequest(`${SITE}/api/ipfs/pinJson`, JSON.stringify({ name: "safe" }), {
        origin: SITE,
        "x-revnet-pinning-ingress-token": INGRESS_TOKEN,
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ Hash: CID });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://ipfs.infura.io:5001/api/v0/add",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: `Basic ${Buffer.from("project:secret").toString("base64")}`,
          origin: SITE,
        }),
      }),
    );

    const invalidProviderResponse = await pinJson(
      jsonRequest(`${SITE}/api/ipfs/pinJson`, JSON.stringify({ name: "unsafe" }), {
        origin: SITE,
        "x-revnet-pinning-ingress-token": INGRESS_TOKEN,
      }),
    );
    expect(invalidProviderResponse.status).toBe(500);
    await expect(invalidProviderResponse.json()).resolves.toEqual({ error: "failed to pin data" });
  });
});

describe("IPFS media proxy boundary", () => {
  it("rejects invalid paths before network access", async () => {
    for (const path of [
      ["..", "asset.svg"],
      ["bafy", "asset.svg"],
      [CID, "..", "asset.svg"],
      [CID, "asset%2Fescape.svg"],
      [`b${"a".repeat(121)}`, "asset.svg"],
    ]) {
      const response = await proxyIpfs(new NextRequest(`${SITE}/api/ipfs/nope`), {
        params: Promise.resolve({ path }),
      });
      expect(response.status).toBe(400);
    }
    expect(fetch).not.toHaveBeenCalled();
  });

  it("rejects active content and oversized declared responses", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response("<script>alert(1)</script>", {
          headers: { "content-type": "text/html" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(new Uint8Array([1]), {
          headers: {
            "content-type": "image/png",
            "content-length": String(25 * 1024 * 1024 + 1),
          },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const context = { params: Promise.resolve({ path: [CID, "asset.png"] }) };
    expect((await proxyIpfs(new NextRequest(`${SITE}/api/ipfs/${CID}`), context)).status).toBe(415);
    expect((await proxyIpfs(new NextRequest(`${SITE}/api/ipfs/${CID}`), context)).status).toBe(502);
  });

  it("maps gateway failures to bounded responses", async () => {
    const timeout = Object.assign(new Error("upstream timed out"), { name: "TimeoutError" });
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error("gateway offline"))
      .mockRejectedValueOnce(timeout)
      .mockResolvedValueOnce(new Response(null, { status: 404 }));
    vi.stubGlobal("fetch", fetchMock);

    const context = { params: Promise.resolve({ path: [CID, "asset.png"] }) };
    const unavailable = await proxyIpfs(
      new NextRequest(`${SITE}/api/ipfs/${CID}/asset.png`),
      context,
    );
    const timedOut = await proxyIpfs(new NextRequest(`${SITE}/api/ipfs/${CID}/asset.png`), context);
    const missing = await proxyIpfs(new NextRequest(`${SITE}/api/ipfs/${CID}/asset.png`), context);

    expect(unavailable.status).toBe(502);
    await expect(unavailable.json()).resolves.toEqual({ error: "IPFS gateway unavailable" });
    expect(timedOut.status).toBe(504);
    await expect(timedOut.json()).resolves.toEqual({ error: "IPFS gateway timed out" });
    expect(missing.status).toBe(404);
  });

  it("returns immutable media with a sandbox and anti-sniffing headers", async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(bytes, {
        headers: { "content-type": "image/png", "content-length": String(bytes.byteLength) },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const response = await proxyIpfs(new NextRequest(`${SITE}/api/ipfs/${CID}/asset.png`), {
      params: Promise.resolve({ path: [CID, "asset.png"] }),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("immutable");
    expect(response.headers.get("content-security-policy")).toContain("sandbox");
    expect(response.headers.get("cross-origin-resource-policy")).toBe("same-origin");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringMatching(/^https:\/\/[^/]+\/ipfs\//u),
      expect.objectContaining({ cache: "no-store" }),
    );
  });
});

describe("Bendystraw proxy boundary", () => {
  it("rejects unknown networks, unsafe key paths, and malformed GraphQL bodies", async () => {
    expect(
      (
        await proxyBendystraw(jsonRequest(`${SITE}/api/bendystraw/dev/public/graphql`, "{}"), {
          params: Promise.resolve({ net: "dev", key: "public" }),
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await proxyBendystraw(jsonRequest(`${SITE}/api/bendystraw/mainnet/key/graphql`, "{}"), {
          params: Promise.resolve({ net: "mainnet", key: "../secret" }),
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await proxyBendystraw(jsonRequest(`${SITE}/api/bendystraw/mainnet/key/graphql`, "{}"), {
          params: Promise.resolve({ net: "mainnet", key: "key" }),
        })
      ).status,
    ).toBe(400);
    expect(mocks.bendystrawFetch).not.toHaveBeenCalled();
  });

  it("uses only the configured origin and returns bounded JSON without caching", async () => {
    mocks.bendystrawFetch.mockResolvedValue(
      Response.json(
        { data: { project: { id: "1" } } },
        { headers: { "content-type": "application/json" } },
      ),
    );
    const body = JSON.stringify({ query: "query Project { project { id } }" });

    const response = await proxyBendystraw(
      jsonRequest(`${SITE}/api/bendystraw/mainnet/scoped-key/graphql`, body),
      { params: Promise.resolve({ net: "mainnet", key: "scoped-key" }) },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(mocks.bendystrawFetch).toHaveBeenCalledWith(
      "https://bendystraw.example/scoped-key/graphql",
      expect.objectContaining({ method: "POST", body, cache: "no-store" }),
    );
  });
});
