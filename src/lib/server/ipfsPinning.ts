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

/**
 * The origins this deployment answers as. NEXT_PUBLIC_SITE_URL is the canonical one,
 * but Railway also serves the app on its generated domain, and a pin from there is
 * still first-party.
 */
function allowedOrigins(): string[] {
  const railwayDomain = process.env.RAILWAY_PUBLIC_DOMAIN?.trim();
  return [
    process.env.NEXT_PUBLIC_SITE_URL,
    railwayDomain ? `https://${railwayDomain}` : undefined,
    process.env.NODE_ENV === "production" ? undefined : "http://localhost:3002",
  ]
    .filter((url): url is string => !!url)
    .map((url) => new URL(url).origin);
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
 * Per-IP and site-wide pin budgets, for the deployment that has no edge in front.
 *
 * ponytail: an in-process sliding window. It resets on redeploy and counts per
 * instance, so two instances allow two budgets — swap in a shared store if this
 * ever runs on more than one. What it buys is the thing that actually matters:
 * a stranger with a script cannot spend the whole provider quota in a minute.
 */
const PIN_WINDOW_MS = 10 * 60_000;
const PIN_PER_CLIENT = 10;
const PIN_PER_SITE = 200;
const pinHistory = new Map<string, number[]>();

function withinBudget(key: string, limit: number, now: number): boolean {
  const recent = (pinHistory.get(key) ?? []).filter((at) => now - at < PIN_WINDOW_MS);
  if (recent.length >= limit) {
    pinHistory.set(key, recent);
    return false;
  }
  recent.push(now);
  pinHistory.set(key, recent);
  return true;
}

function clientKey(req: NextRequest): string {
  // Railway terminates TLS and forwards the caller in `x-forwarded-for`. The left-most
  // entry is client-supplied and therefore only as good as the proxy in front; it is a
  // budget key, never an identity.
  const forwarded = req.headers.get("x-forwarded-for") ?? "";
  return forwarded.split(",")[0]?.trim() || "unknown";
}

/**
 * The gate every pinning route shares.
 *
 * Two supported deployments:
 *
 * - **Edge-protected**: something in front (a WAF, a proxy) enforces the policy in
 *   DEPLOYMENT.md and injects `IPFS_PINNING_INGRESS_TOKEN`. Set the token and that
 *   header is the authorization.
 * - **First-party**: no edge exists — the app is reached directly. Set
 *   `IPFS_PINNING_EDGE_PROTECTED=false` and leave the token unset; this function then
 *   enforces the budget itself. Weaker than a real WAF and it says so, but it is the
 *   honest description of a service published straight from the platform.
 *
 * The origin check is a CSRF fence in both modes, never the authorization.
 */
export function requirePinningAccess(req: NextRequest): Response | null {
  if (process.env.IPFS_PINNING_ENABLED !== "true") {
    return Response.json({ error: "IPFS pinning is disabled" }, { status: 503 });
  }

  const edgeProtected = process.env.IPFS_PINNING_EDGE_PROTECTED === "true";
  if (edgeProtected && !hasValidIngressToken(req)) {
    return Response.json({ error: "pinning ingress is not authorized" }, { status: 401 });
  }

  const origin = req.headers.get("origin");
  if (!origin || !allowedOrigins().includes(origin)) {
    return Response.json({ error: "origin not allowed" }, { status: 403 });
  }

  if (!edgeProtected) {
    const now = Date.now();
    if (!withinBudget(`client:${clientKey(req)}`, PIN_PER_CLIENT, now)) {
      return Response.json({ error: "too many pins from this client" }, { status: 429 });
    }
    if (!withinBudget("site", PIN_PER_SITE, now)) {
      return Response.json({ error: "the site pin budget is spent" }, { status: 429 });
    }
  }

  return null;
}

/** Test seam: the budget is process state, so a test must be able to clear it. */
export function resetPinBudgets(): void {
  pinHistory.clear();
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
      return Response.json({ error: "a valid Content-Length header is required" }, { status: 411 });
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
