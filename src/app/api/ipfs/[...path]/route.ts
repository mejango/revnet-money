import { OPEN_IPFS_GATEWAY_HOSTNAME } from "@/lib/ipfs";
import { isIpfsCid } from "@/lib/ipfs-cid";
import { readBoundedBody } from "@/lib/server/readBoundedBody";
import { NextRequest } from "next/server";

const MAX_MEDIA_BYTES = 25 * 1024 * 1024;
const UPSTREAM_TIMEOUT_MS = 15_000;
const SAFE_PATH_SEGMENT = /^[A-Za-z0-9._~-]{1,128}$/u;

function supportedMediaType(value: string | null) {
  const type = value?.split(";", 1)[0].trim().toLowerCase() ?? "";
  return /^(?:image|audio|video)\//u.test(type) || type === "application/octet-stream";
}

/**
 * Same-origin IPFS media boundary. Content is immutable by construction (CIDs),
 * so browsers and a bounded edge cache may retain the validated response. The
 * attacker-selected CID must not enter Next's persistent server data cache.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const { path: segments } = await params;
  if (
    !segments.length ||
    segments.length > 8 ||
    !isIpfsCid(segments[0]) ||
    segments
      .slice(1)
      .some((segment) => segment === "." || segment === ".." || !SAFE_PATH_SEGMENT.test(segment)) ||
    segments.join("/").length > 512
  ) {
    return Response.json({ error: "invalid IPFS path" }, { status: 400 });
  }
  const path = segments.map(encodeURIComponent).join("/");
  let upstream: Response;
  try {
    upstream = await fetch(`https://${OPEN_IPFS_GATEWAY_HOSTNAME}/ipfs/${path}`, {
      cache: "no-store",
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
  } catch (error) {
    const timeout = (error as { name?: string }).name === "TimeoutError";
    return Response.json(
      { error: timeout ? "IPFS gateway timed out" : "IPFS gateway unavailable" },
      { status: timeout ? 504 : 502 },
    );
  }

  if (!upstream.ok) {
    return new Response(null, { status: upstream.status });
  }

  const contentType = upstream.headers.get("content-type");
  if (!supportedMediaType(contentType)) {
    await upstream.body?.cancel();
    return Response.json({ error: "unsupported IPFS media type" }, { status: 415 });
  }

  const declaredSize = Number(upstream.headers.get("content-length") ?? 0);
  if (declaredSize > MAX_MEDIA_BYTES) {
    await upstream.body?.cancel();
    return Response.json({ error: "IPFS media exceeds the size limit" }, { status: 502 });
  }

  const body = await readBoundedBody(upstream.body, MAX_MEDIA_BYTES);
  if (!body) {
    return Response.json({ error: "IPFS media exceeds the size limit" }, { status: 502 });
  }

  return new Response(body, {
    status: 200,
    headers: {
      "content-type": contentType ?? "application/octet-stream",
      "content-length": String(body.byteLength),
      "cache-control": "public, max-age=31536000, immutable",
      "content-security-policy":
        "sandbox; default-src 'none'; img-src 'self' data: blob:; media-src 'self' data: blob:; style-src 'unsafe-inline'",
      "cross-origin-resource-policy": "same-origin",
      "x-content-type-options": "nosniff",
    },
  });
}
