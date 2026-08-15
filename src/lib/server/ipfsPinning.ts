import "server-only";

import { isIpfsCid } from "@/lib/ipfs-cid";
import { NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";

export type IpfsPinResponse = {
  Hash: string;
};

const FILEBASE_IPFS_API_BASE_URL = "https://rpc.filebase.io";
const PINATA_PIN_BY_CID_URL = "https://api.pinata.cloud/v3/files/public/pin_by_cid";
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
 * The gate every pinning route shares: the feature is off unless the ingress in
 * DEPLOYMENT.md is in front of it, and the token it injects is what authorizes the
 * call. The origin check is a second fence, never the authorization itself.
 */
export function requirePinningAccess(req: NextRequest): Response | null {
  if (
    process.env.IPFS_PINNING_ENABLED !== "true" ||
    process.env.IPFS_PINNING_EDGE_PROTECTED !== "true"
  ) {
    return Response.json({ error: "IPFS pinning is disabled" }, { status: 503 });
  }
  if (!hasValidIngressToken(req)) {
    return Response.json({ error: "pinning ingress is not authorized" }, { status: 401 });
  }
  if (req.headers.get("origin") !== configuredOrigin()) {
    return Response.json({ error: "origin not allowed" }, { status: 403 });
  }
  return null;
}

/**
 * Filebase creates and retains the canonical DAG-PB CID. Pinata then pins the exact
 * same CID so every returned URI has redundant persistence.
 */
export async function pinToIpfs(
  file: string | Blob,
  { filename, pinName }: { filename: string; pinName: string },
): Promise<IpfsPinResponse> {
  const filebaseToken = process.env.FILEBASE_IPFS_RPC_TOKEN;
  const pinataJwt = process.env.PINATA_JWT;
  if (!filebaseToken || !pinataJwt) throw new Error("IPFS pinning is not configured");

  const formData = new FormData();
  formData.append(
    "file",
    typeof file === "string" ? new Blob([file], { type: "application/json" }) : file,
    filename,
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
    body: JSON.stringify({ cid, name: pinName }),
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

/**
 * A multipart upload route, bounded twice: once on the declared envelope before the
 * body is buffered, and again on the decoded file. `formData()` buffers before a
 * Blob's size can be read, so the envelope check is what closes the memory-DoS path
 * — the ingress must reject over-long bodies too.
 */
export function makePinFileHandler({
  maxBytes,
  typeAllowed,
  typeError,
  filename,
  pinName,
}: {
  maxBytes: number;
  typeAllowed: (type: string, name: string) => boolean;
  typeError: string;
  filename: string;
  pinName: string;
}) {
  const sizeLabel = `${maxBytes / (1024 * 1024)}MB`;

  return async function POST(req: NextRequest) {
    const denied = requirePinningAccess(req);
    if (denied) return denied;

    const rawLength = req.headers.get("content-length");
    const declaredLength = Number(rawLength);
    if (!rawLength || !Number.isSafeInteger(declaredLength) || declaredLength <= 0) {
      return Response.json(
        { error: "a valid Content-Length header is required" },
        { status: 411 },
      );
    }
    if (declaredLength > maxBytes + 256 * 1024) {
      return Response.json({ error: `file too large (max ${sizeLabel})` }, { status: 413 });
    }

    let form: FormData;
    try {
      form = await req.formData();
    } catch {
      return Response.json({ error: "expected multipart form data" }, { status: 400 });
    }

    const file = form.get("file");
    if (!(file instanceof Blob)) {
      return Response.json({ error: "missing file field" }, { status: 400 });
    }
    if (file.size === 0 || file.size > maxBytes) {
      return Response.json({ error: `file must be 1 byte – ${sizeLabel}` }, { status: 413 });
    }
    const uploadName = "name" in file && typeof file.name === "string" ? file.name : "";
    if (!typeAllowed(file.type, uploadName)) {
      return Response.json({ error: typeError }, { status: 415 });
    }

    try {
      return Response.json(await pinToIpfs(file, { filename, pinName }));
    } catch (error) {
      console.error(error);
      return Response.json({ error: "failed to pin file" }, { status: 500 });
    }
  };
}
