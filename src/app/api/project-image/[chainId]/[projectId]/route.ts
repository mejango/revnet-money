import { getProject } from "@/app/[slug]/getProject";
import { ipfsMediaGatewayUrls, ipfsUriToAppUrl } from "@/lib/ipfs";
import { decodeSafeDataImage } from "@/lib/safe-data-image";
import { readBoundedBody } from "@/lib/server/readBoundedBody";
import type { NextRequest } from "next/server";

const MAX_METADATA_BYTES = 512 * 1024;
const FETCH_TIMEOUT_MS = 8_000;

type ProjectMetadata = {
  image?: unknown;
  logoUri?: unknown;
};

async function fetchMetadata(uri: string | null): Promise<ProjectMetadata | null> {
  for (const url of ipfsMediaGatewayUrls(uri)) {
    try {
      const response = await fetch(url, {
        cache: "no-store",
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (!response.ok) {
        await response.body?.cancel();
        continue;
      }
      const body = await readBoundedBody(response.body, MAX_METADATA_BYTES);
      if (!body) continue;
      const value = JSON.parse(new TextDecoder().decode(body)) as unknown;
      if (typeof value === "object" && value !== null && !Array.isArray(value)) {
        return value as ProjectMetadata;
      }
    } catch {
      // Try the next immutable gateway.
    }
  }
  return null;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ chainId: string; projectId: string }> },
) {
  const raw = await params;
  const chainId = Number(raw.chainId);
  const projectId = Number(raw.projectId);
  if (
    !Number.isSafeInteger(chainId) ||
    chainId <= 0 ||
    !Number.isSafeInteger(projectId) ||
    projectId < 0
  ) {
    return Response.json({ error: "invalid project" }, { status: 400 });
  }

  const project = await getProject(projectId, chainId);
  if (!project) return new Response(null, { status: 404 });

  const metadata = await fetchMetadata(project.metadataUri);
  const source = metadata?.logoUri ?? metadata?.image ?? project.logoUri;
  const inline = decodeSafeDataImage(source);
  if (inline) {
    const responseBody = new Uint8Array(inline.bytes.byteLength);
    responseBody.set(inline.bytes);
    return new Response(responseBody.buffer, {
      headers: {
        "content-type": inline.contentType,
        "content-length": String(inline.bytes.byteLength),
        "cache-control": "public, max-age=300, s-maxage=300",
        "content-security-policy":
          "sandbox; default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'",
        "x-content-type-options": "nosniff",
      },
    });
  }

  const appPath = ipfsUriToAppUrl(source);
  if (appPath) return Response.redirect(new URL(appPath, request.url), 307);
  return new Response(null, { status: 404 });
}
