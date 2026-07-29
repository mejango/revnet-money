import { isIpfsCid } from "@/lib/ipfs-cid";
import { readBoundedBody } from "@/lib/server/readBoundedBody";
import { NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";

export type IpfsPinResponse = {
  Hash: string;
};

const FILEBASE_IPFS_API_BASE_URL = "https://rpc.filebase.io";
const PINATA_PIN_BY_CID_URL = "https://api.pinata.cloud/v3/files/public/pin_by_cid";
const MAX_METADATA_BYTES = 128 * 1024;
const PINNING_TIMEOUT_MS = 15_000;

function configuredOrigin() {
  return new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3002").origin;
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
 * Filebase creates and retains the canonical DAG-PB CID. Pinata then pins the
 * exact same CID so every returned metadata URI has redundant persistence.
 */
async function pinFile(file: string | Blob): Promise<IpfsPinResponse> {
  const filebaseToken = process.env.FILEBASE_IPFS_RPC_TOKEN;
  const pinataJwt = process.env.PINATA_JWT;
  if (!filebaseToken || !pinataJwt) throw new Error("IPFS pinning is not configured");

  const formData = new FormData();
  formData.append(
    "file",
    typeof file === "string" ? new Blob([file], { type: "application/json" }) : file,
    "metadata.json",
  );

  const filebaseResponse = await fetch(
    `${FILEBASE_IPFS_API_BASE_URL}/api/v0/add?pin=true&cid-version=0`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${filebaseToken}` },
      body: formData,
      signal: AbortSignal.timeout(PINNING_TIMEOUT_MS),
    },
  );
  if (!filebaseResponse.ok) {
    throw new Error(`Filebase IPFS provider returned ${filebaseResponse.status}`);
  }

  const filebasePayload = (await filebaseResponse.json()) as { Hash?: unknown };
  if (typeof filebasePayload.Hash !== "string" || !isIpfsCid(filebasePayload.Hash)) {
    throw new Error("Filebase IPFS provider response contains an invalid CID");
  }

  const cid = filebasePayload.Hash;
  const pinataResponse = await fetch(PINATA_PIN_BY_CID_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${pinataJwt}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ cid, name: "revnet-project-metadata.json" }),
    signal: AbortSignal.timeout(PINNING_TIMEOUT_MS),
  });
  if (!pinataResponse.ok) {
    throw new Error(`Pinata replication returned ${pinataResponse.status}`);
  }
  const pinataPayload = (await pinataResponse.json()) as { data?: { cid?: unknown } };
  if (pinataPayload.data?.cid !== cid) {
    throw new Error("Pinata replication returned a mismatched CID");
  }

  return { Hash: cid };
}

export async function POST(req: NextRequest) {
  try {
    if (
      process.env.IPFS_PINNING_ENABLED !== "true" ||
      process.env.IPFS_PINNING_EDGE_PROTECTED !== "true"
    ) {
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
