import { ipfsMediaGatewayUrls } from "@/lib/ipfs";
import { isIpfsCid } from "@/lib/ipfs-cid";
import { readBoundedBody } from "@/lib/server/readBoundedBody";
import { NextRequest } from "next/server";

const MAX_MEDIA_BYTES = 25 * 1024 * 1024;
const PRIMARY_GATEWAY_TIMEOUT_MS = 6_000;
const FALLBACK_GATEWAY_TIMEOUT_MS = 12_000;
const SAFE_PATH_SEGMENT = /^[A-Za-z0-9._~-]{1,128}$/u;

function supportedMediaType(value: string | null) {
  const type = value?.split(";", 1)[0].trim().toLowerCase() ?? "";
  return (
    /^(?:image|audio|video)\//u.test(type) ||
    type === "application/octet-stream" ||
    type === "application/json" ||
    type.endsWith("+json") ||
    type === "text/plain"
  );
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
  const gatewayUrls = ipfsMediaGatewayUrls(`ipfs://${path}`);
  let upstream: Response | undefined;
  let lastStatus: number | undefined;
  let timedOut = false;

  for (const url of gatewayUrls) {
    try {
      const candidate = await fetch(url, {
        cache: "no-store",
        signal: AbortSignal.timeout(
          new URL(url).hostname === "gateway.pinata.cloud"
            ? FALLBACK_GATEWAY_TIMEOUT_MS
            : PRIMARY_GATEWAY_TIMEOUT_MS,
        ),
      });
      if (candidate.ok) {
        upstream = candidate;
        break;
      }
      lastStatus = candidate.status;
      await candidate.body?.cancel();
    } catch (error) {
      timedOut ||= (error as { name?: string }).name === "TimeoutError";
    }
  }

  if (!upstream) {
    if (lastStatus) return new Response(null, { status: lastStatus });
    return Response.json(
      { error: timedOut ? "IPFS gateways timed out" : "IPFS gateways unavailable" },
      { status: timedOut ? 504 : 502 },
    );
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

  const responseBody = new Uint8Array(body.byteLength);
  responseBody.set(body);

  return new Response(responseBody.buffer, {
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
