import {
  ActivityEventsOperation,
  getBrowserOperationById,
  ParticipantsOperation,
} from "@/lib/bendystraw/operations";
import { queryBendystraw } from "@/lib/bendystraw/query.server";
import { sharedDisplayRead } from "@/lib/server/projectDisplayCache";
import { readBoundedBody } from "@/lib/server/readBoundedBody";
import { BendystrawRequestError as BendystrawError } from "@bananapus/nana-sdk-core";
import { NextRequest } from "next/server";

const MAX_REQUEST_BYTES = 32 * 1024;

/**
 * Display lists that every visitor of a project polls with the same variables. Identical requests
 * within five seconds share one indexer read. Only operations listed here are shared: anything
 * that can feed a wallet prompt, an authority check, a balance or a list read again right after a
 * write (projects, permissions, loans, pending routing) always reaches the indexer.
 */
const SHARED_DISPLAY_OPERATIONS: ReadonlySet<string> = new Set([
  ActivityEventsOperation.id,
  ParticipantsOperation.id,
]);
const SHARED_DISPLAY_MS = 5_000;

export async function POST(req: NextRequest, { params }: { params: Promise<{ net: string }> }) {
  const { net } = await params;
  if (net !== "mainnet" && net !== "testnet") {
    return Response.json({ error: "unsupported network" }, { status: 404 });
  }
  if (!req.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    return Response.json({ error: "content type must be application/json" }, { status: 415 });
  }

  const declaredSize = Number(req.headers.get("content-length") ?? 0);
  if (declaredSize > MAX_REQUEST_BYTES) {
    return Response.json({ error: "request is too large" }, { status: 413 });
  }
  const bytes = await readBoundedBody(req.body, MAX_REQUEST_BYTES);
  if (!bytes) {
    return Response.json({ error: "request is too large" }, { status: 413 });
  }

  let body: { operation?: unknown; variables?: unknown };
  try {
    body = JSON.parse(new TextDecoder().decode(bytes)) as {
      operation?: unknown;
      variables?: unknown;
    };
  } catch {
    return Response.json({ error: "invalid JSON request" }, { status: 400 });
  }
  if (
    typeof body.operation !== "string" ||
    typeof body.variables !== "object" ||
    body.variables === null ||
    Array.isArray(body.variables)
  ) {
    return Response.json({ error: "invalid operation request" }, { status: 400 });
  }

  const operation = getBrowserOperationById(body.operation);
  if (!operation || !operation.validateVariables(body.variables)) {
    return Response.json({ error: "invalid operation request" }, { status: 400 });
  }

  // Only the mainnet/testnet distinction matters to URL selection. Using a
  // representative chain keeps the upstream address entirely server-owned.
  const representativeChainId = net === "testnet" ? 11155111 : 1;
  try {
    const read = () =>
      queryBendystraw(representativeChainId, operation as never, body.variables as never);
    const data = SHARED_DISPLAY_OPERATIONS.has(operation.id)
      ? await sharedDisplayRead(["bendystraw", net, operation.id, body.variables], read, {
          staleTime: SHARED_DISPLAY_MS,
        })
      : await read();
    return Response.json(
      { data },
      {
        headers: {
          "cache-control": "no-store",
          "x-content-type-options": "nosniff",
        },
      },
    );
  } catch (error) {
    // The cause is logged, on one line, and never sent: the answer is one of four messages
    // whatever failed. Control characters go too, so an indexer's text cannot start a terminal
    // sequence or forge a log line.
    console.error("Bendystraw relay failed:", String(error).replace(/[\p{Cc}\s]+/gu, " "));
    const status =
      error instanceof BendystrawError && error.status && error.status >= 400
        ? error.status
        : (error as { name?: string }).name === "TimeoutError"
          ? 504
          : 502;
    // A rate limit stays a rate limit, with the indexer's wait, so a browser backs off instead
    // of reading it as a bad request.
    const clientStatus = status >= 500 || status === 429 ? status : 400;
    const retryAfter = (error as { retryAfter?: string }).retryAfter;
    return Response.json(
      {
        error:
          clientStatus === 504
            ? "Bendystraw timed out"
            : clientStatus >= 500
              ? "Bendystraw unavailable"
              : clientStatus === 429
                ? "Bendystraw is busy"
                : "invalid operation request",
      },
      {
        status: clientStatus,
        headers: clientStatus === 429 && retryAfter ? { "retry-after": retryAfter } : undefined,
      },
    );
  }
}
