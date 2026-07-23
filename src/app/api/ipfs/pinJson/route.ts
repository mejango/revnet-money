import { isIpfsCid } from "@/lib/ipfs-cid";
import { readBoundedBody } from "@/lib/server/readBoundedBody";
import { NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";

export type InfuraPinResponse = {
  Hash: string;
};

const INFURA_IPFS_API_BASE_URL = "https://ipfs.infura.io:5001";
const MAX_METADATA_BYTES = 128 * 1024;
const PINNING_TIMEOUT_MS = 15_000;

function configuredOrigin() {
  return new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000").origin;
}

function hasValidIngressToken(req: NextRequest) {
  const expected = process.env.IPFS_PINNING_INGRESS_TOKEN;
  const supplied = req.headers.get("x-revnet-pinning-ingress-token");
  if (!expected || !supplied) return false;

  const expectedBytes = Buffer.from(expected);
  const suppliedBytes = Buffer.from(supplied);
  return (
    expectedBytes.length === suppliedBytes.length && timingSafeEqual(expectedBytes, suppliedBytes)
  );
}

/**
 * https://docs.infura.io/infura/networks/ipfs/http-api-methods/pin
 */
async function pinFile(file: string | Blob): Promise<InfuraPinResponse> {
  const projectId = process.env.INFURA_IPFS_PROJECT_ID;
  const apiSecret = process.env.INFURA_IPFS_API_SECRET;
  if (!projectId || !apiSecret) throw new Error("IPFS pinning is not configured");

  const formData = new FormData();
  formData.append("file", file);

  const res = await fetch(`${INFURA_IPFS_API_BASE_URL}/api/v0/add`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${projectId}:${apiSecret}`).toString("base64")}`,
      origin: configuredOrigin(),
    },
    body: formData,
    signal: AbortSignal.timeout(PINNING_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`IPFS provider returned ${res.status}`);

  const payload = (await res.json()) as Partial<InfuraPinResponse>;
  if (!isIpfsCid(payload.Hash)) throw new Error("IPFS provider response contains an invalid CID");

  return { Hash: payload.Hash };
}

export async function POST(req: NextRequest) {
  try {
    if (process.env.ENABLE_PUBLIC_IPFS_PINNING !== "true") {
      return Response.json({ error: "IPFS pinning is disabled" }, { status: 503 });
    }
    if (!hasValidIngressToken(req)) {
      return Response.json({ error: "pinning ingress is not authorized" }, { status: 401 });
    }

    const requestOrigin = req.headers.get("origin");
    if (requestOrigin !== configuredOrigin()) {
      return Response.json({ error: "origin not allowed" }, { status: 403 });
    }

    if (!req.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
      return Response.json({ error: "content type must be application/json" }, { status: 415 });
    }

    const declaredSize = Number(req.headers.get("content-length") ?? 0);
    if (declaredSize > MAX_METADATA_BYTES) {
      return Response.json({ error: "metadata is too large" }, { status: 413 });
    }

    const bodyBytes = await readBoundedBody(req.body, MAX_METADATA_BYTES);
    if (!bodyBytes) {
      return Response.json({ error: "metadata is too large" }, { status: 413 });
    }
    const body = new TextDecoder().decode(bodyBytes);
    let data: unknown;
    try {
      data = JSON.parse(body) as unknown;
    } catch {
      return Response.json({ error: "invalid JSON metadata" }, { status: 400 });
    }

    const pinJson = await pinFile(JSON.stringify(data));

    return Response.json(pinJson);
  } catch (error) {
    console.error(error);
    return new Response(JSON.stringify({ error: "failed to pin data" }), {
      status: 500,
    });
  }
}
