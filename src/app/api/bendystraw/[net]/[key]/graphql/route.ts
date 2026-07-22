import { bendystrawFetch } from "@/graphql/bendystrawClient";
import { readBoundedBody } from "@/lib/server/readBoundedBody";
import { NextRequest } from "next/server";

const MAX_QUERY_BYTES = 128 * 1024;
const MAX_RESPONSE_BYTES = 5 * 1024 * 1024;
const UPSTREAM_TIMEOUT_MS = 15_000;

/**
 * Same-origin proxy for the SDK's client-side bendystraw queries.
 *
 * The public bendystraw endpoints answer browsers with a fixed
 * Access-Control-Allow-Origin allowlist, so direct client-side queries are
 * CORS-blocked from any origin not on it (localhost included) — while
 * server-side fetches work fine. Routing the browser's queries through this
 * route keeps them same-origin, matching how juicebox-money-v6 talks to
 * bendystraw (server-side fetch).
 *
 * URL shape (the SDK builds `<url>/<apiKey>` then appends `/graphql`):
 *   /api/bendystraw/<mainnet|testnet>/<key|public>/graphql
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ net: string; key: string }> },
) {
  const { net, key } = await params;
  if (net !== "mainnet" && net !== "testnet") {
    return Response.json({ error: "unsupported network" }, { status: 404 });
  }
  if (!/^(?:public|[A-Za-z0-9_-]{1,128})$/.test(key)) {
    return Response.json({ error: "invalid API key path" }, { status: 400 });
  }
  if (!req.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    return Response.json({ error: "content type must be application/json" }, { status: 415 });
  }

  const declaredSize = Number(req.headers.get("content-length") ?? 0);
  if (declaredSize > MAX_QUERY_BYTES) {
    return Response.json({ error: "query is too large" }, { status: 413 });
  }
  const body = await req.text();
  if (Buffer.byteLength(body, "utf8") > MAX_QUERY_BYTES) {
    return Response.json({ error: "query is too large" }, { status: 413 });
  }
  try {
    const parsed = JSON.parse(body) as { query?: unknown };
    if (!parsed || typeof parsed !== "object" || typeof parsed.query !== "string") {
      return Response.json({ error: "invalid GraphQL request" }, { status: 400 });
    }
  } catch {
    return Response.json({ error: "invalid JSON request" }, { status: 400 });
  }

  const configuredBase =
    net === "testnet"
      ? process.env.NEXT_PUBLIC_TESTNET_BENDYSTRAW_URL
      : process.env.NEXT_PUBLIC_BENDYSTRAW_URL;
  if (!configuredBase) {
    return Response.json({ error: "Bendystraw is not configured" }, { status: 503 });
  }
  const base = new URL(configuredBase).origin;
  const keyPath = key && key !== "public" ? `/${key}` : "";

  let upstream: Response;
  try {
    upstream = await bendystrawFetch(`${base}${keyPath}/graphql`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
      // GraphQL responses are query-specific; let the client's own cache policy rule.
      cache: "no-store",
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
  } catch (error) {
    const timeout = (error as { name?: string }).name === "TimeoutError";
    return Response.json(
      { error: timeout ? "Bendystraw timed out" : "Bendystraw unavailable" },
      { status: timeout ? 504 : 502 },
    );
  }

  const declaredResponseSize = Number(upstream.headers.get("content-length") ?? 0);
  if (declaredResponseSize > MAX_RESPONSE_BYTES) {
    await upstream.body?.cancel();
    return Response.json({ error: "Bendystraw response exceeds the size limit" }, { status: 502 });
  }
  if (!upstream.headers.get("content-type")?.toLowerCase().includes("json")) {
    await upstream.body?.cancel();
    return Response.json({ error: "Bendystraw returned an invalid content type" }, { status: 502 });
  }
  const responseBody = await readBoundedBody(upstream.body, MAX_RESPONSE_BYTES);
  if (!responseBody) {
    return Response.json({ error: "Bendystraw response exceeds the size limit" }, { status: 502 });
  }

  return new Response(responseBody, {
    status: upstream.status,
    headers: {
      "cache-control": "no-store",
      "content-length": String(responseBody.byteLength),
      "content-type": "application/json",
      "x-content-type-options": "nosniff",
    },
  });
}
