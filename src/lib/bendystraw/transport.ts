const RETRY_DELAYS_MS = [250, 750] as const;
const RETRYABLE_STATUSES = new Set([408, 429, 500, 502, 503, 504]);
export const MAX_BENDYSTRAW_RESPONSE_BYTES = 5 * 1024 * 1024;
export const BENDYSTRAW_TIMEOUT_MS = 15_000;

export class BendystrawError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "BendystrawError";
  }
}

export const bendystrawFetch: typeof fetch = async (input, init) => {
  for (let attempt = 0; ; attempt += 1) {
    try {
      const response = await fetch(input, init);
      if (!RETRYABLE_STATUSES.has(response.status) || attempt === RETRY_DELAYS_MS.length) {
        return response;
      }
      await response.body?.cancel();
    } catch (error) {
      const errorName = (error as { name?: string }).name;
      const aborted =
        errorName === "AbortError" || errorName === "TimeoutError" || init?.signal?.aborted;
      if (aborted || attempt === RETRY_DELAYS_MS.length) throw error;
    }

    await new Promise((resolve) => setTimeout(resolve, RETRY_DELAYS_MS[attempt]));
  }
};

type GraphQLResponse = {
  data?: unknown;
  errors?: Array<{ message?: unknown }>;
};

async function readBoundedResponseBody(
  body: ReadableStream<Uint8Array> | null,
  maximumBytes: number,
): Promise<Uint8Array | null> {
  if (!body) return new Uint8Array();

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maximumBytes) {
        await reader.cancel("Bendystraw response exceeds the size limit");
        return null;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

export async function readBendystrawResponse(response: Response): Promise<unknown> {
  const declaredSize = Number(response.headers.get("content-length") ?? 0);
  if (declaredSize > MAX_BENDYSTRAW_RESPONSE_BYTES) {
    await response.body?.cancel();
    throw new BendystrawError("Bendystraw response exceeds the size limit", 502);
  }
  if (!response.headers.get("content-type")?.toLowerCase().includes("json")) {
    await response.body?.cancel();
    throw new BendystrawError("Bendystraw returned an invalid content type", 502);
  }

  const bytes = await readBoundedResponseBody(response.body, MAX_BENDYSTRAW_RESPONSE_BYTES);
  if (!bytes) {
    throw new BendystrawError("Bendystraw response exceeds the size limit", 502);
  }

  let envelope: GraphQLResponse;
  try {
    envelope = JSON.parse(new TextDecoder().decode(bytes)) as GraphQLResponse;
  } catch {
    throw new BendystrawError("Bendystraw returned invalid JSON", 502);
  }

  if (!response.ok) {
    throw new BendystrawError(`Bendystraw request failed (${response.status})`, response.status);
  }
  if (Array.isArray(envelope.errors) && envelope.errors.length > 0) {
    const firstMessage = envelope.errors.find(
      (error) => typeof error?.message === "string",
    )?.message;
    throw new BendystrawError(
      typeof firstMessage === "string" ? firstMessage.slice(0, 500) : "Bendystraw query failed",
      502,
    );
  }
  if (!("data" in envelope)) {
    throw new BendystrawError("Bendystraw response is missing data", 502);
  }

  return envelope.data;
}
