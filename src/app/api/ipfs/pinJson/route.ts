import { pinToIpfs, requirePinningAccess, type IpfsPinResponse } from "@/lib/server/ipfsPinning";
import { readBoundedBody } from "@/lib/server/readBoundedBody";
import { NextRequest } from "next/server";

export type { IpfsPinResponse };

export const runtime = "nodejs";

const MAX_METADATA_BYTES = 128 * 1024;

export async function POST(req: NextRequest) {
  try {
    const denied = requirePinningAccess(req);
    if (denied) return denied;

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

    return Response.json(
      await pinToIpfs(JSON.stringify(data), {
        filename: "metadata.json",
        pinName: "revnet-project-metadata.json",
      }),
    );
  } catch (error) {
    console.error(error);
    return new Response(JSON.stringify({ error: "failed to pin data" }), {
      status: 500,
    });
  }
}
