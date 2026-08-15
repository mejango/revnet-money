// @vitest-environment node
// Uploads reach a paid pinning service, so every rejection here is a bill someone else
// would otherwise pay. The route is closed unless the documented ingress fronts it, and the
// envelope is bounded before `formData()` buffers anything.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ENV = {
  IPFS_PINNING_ENABLED: "true",
  IPFS_PINNING_EDGE_PROTECTED: "true",
  IPFS_PINNING_INGRESS_TOKEN: "ingress-token",
  FILEBASE_IPFS_RPC_TOKEN: "filebase-token",
  PINATA_JWT: "pinata-jwt",
  NEXT_PUBLIC_SITE_URL: "https://revnet.money",
};

const CID = "QmYwAPJzv5CZsnAzt8auVZRnA3iE3m6XJqFqQ5h6XqFQwP";

const { makePinFileHandler } = await import("@/lib/server/ipfsPinning");

const POST = makePinFileHandler({
  maxBytes: 1024,
  typeAllowed: (type) => type === "image/png",
  typeError: "only image uploads are allowed",
  filename: "logo",
  pinName: "revnet-logo",
});

async function request({
  token = ENV.IPFS_PINNING_INGRESS_TOKEN,
  origin = ENV.NEXT_PUBLIC_SITE_URL,
  length,
  form,
}: {
  token?: string | null;
  origin?: string | null;
  length?: string;
  form?: FormData;
} = {}) {
  const headers = new Headers();
  if (token) headers.set("x-revnet-pinning-ingress-token", token);
  if (origin) headers.set("origin", origin);

  let body: ArrayBuffer | undefined;
  if (form) {
    // Serialize once so the multipart boundary in `content-type` matches the bytes, and
    // so `content-length` is the real envelope size rather than a lie the parser trips on.
    const encoded = new Response(form);
    body = await encoded.arrayBuffer();
    headers.set("content-type", encoded.headers.get("content-type") ?? "");
    headers.set("content-length", String(body.byteLength));
  }
  if (length) headers.set("content-length", length);

  return new Request("https://revnet.money/api/ipfs/pinFile", {
    method: "POST",
    headers,
    body,
  }) as unknown as Parameters<typeof POST>[0];
}

function pngForm(bytes = 16, type = "image/png") {
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(bytes)], { type }), "logo.png");
  return form;
}

beforeEach(() => {
  for (const [key, value] of Object.entries(ENV)) vi.stubEnv(key, value);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("pin-file route", () => {
  it("is closed while the feature is off", async () => {
    vi.stubEnv("IPFS_PINNING_ENABLED", "false");
    expect((await POST(await request())).status).toBe(503);
  });

  it("is closed while the ingress is not in front of it", async () => {
    vi.stubEnv("IPFS_PINNING_EDGE_PROTECTED", "false");
    expect((await POST(await request())).status).toBe(503);
  });

  it("rejects a caller without the ingress token", async () => {
    expect((await POST(await request({ token: null }))).status).toBe(401);
    expect((await POST(await request({ token: "wrong-token" }))).status).toBe(401);
  });

  it("rejects another site's origin", async () => {
    expect((await POST(await request({ origin: "https://attacker.example" }))).status).toBe(403);
  });

  it("requires a declared length and bounds it before buffering", async () => {
    expect((await POST(await request())).status).toBe(411);
    expect((await POST(await request({ length: String(1024 * 1024) }))).status).toBe(413);
  });

  it("rejects a file whose type is not allowed", async () => {
    const form = pngForm(16, "application/zip");
    const response = await POST(await request({ form }));
    expect(response.status).toBe(415);
  });

  it("pins through Filebase and replicates the same CID to Pinata", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ Hash: CID }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: { cid: CID } }) });
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(await request({ form: pngForm() }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ Hash: CID });
    expect(fetchMock.mock.calls[0][0]).toContain("rpc.filebase.io");
    expect(fetchMock.mock.calls[1][0]).toContain("api.pinata.cloud");
  });

  it("fails rather than returning a CID Pinata did not confirm", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce({ ok: true, json: async () => ({ Hash: CID }) })
        .mockResolvedValueOnce({ ok: true, json: async () => ({ data: { cid: "QmOther" } }) }),
    );

    const response = await POST(await request({ form: pngForm() }));
    expect(response.status).toBe(500);
  });
});
