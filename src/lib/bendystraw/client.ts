import type { BendystrawOperation } from "./operations";
import { BENDYSTRAW_TIMEOUT_MS, BendystrawError } from "./transport";

const TESTNET_CHAIN_IDS = new Set([11155111, 11155420, 84532, 421614]);

function findChainId(value: unknown, depth = 0): number | undefined {
  if (depth > 6 || !value || typeof value !== "object") return undefined;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findChainId(item, depth + 1);
      if (found !== undefined) return found;
    }
    return undefined;
  }

  const object = value as Record<string, unknown>;
  if (typeof object.chainId === "number" && Number.isFinite(object.chainId)) {
    return object.chainId;
  }
  if (Array.isArray(object.chainId_in)) {
    const first = object.chainId_in.find(
      (chainId): chainId is number => typeof chainId === "number" && Number.isFinite(chainId),
    );
    if (first !== undefined) return first;
  }
  for (const item of Object.values(object)) {
    const found = findChainId(item, depth + 1);
    if (found !== undefined) return found;
  }
  return undefined;
}

export function bendystrawNetworkFor(
  variables: Record<string, unknown>,
  chainId?: number,
): "mainnet" | "testnet" {
  const resolvedChainId = chainId ?? findChainId(variables);
  return resolvedChainId !== undefined && TESTNET_CHAIN_IDS.has(resolvedChainId)
    ? "testnet"
    : "mainnet";
}

export async function queryBendystrawFromBrowser<
  TResult,
  TVariables extends Record<string, unknown>,
>(
  operation: BendystrawOperation<TResult, TVariables>,
  variables: TVariables,
  chainId?: number,
): Promise<TResult> {
  if (!operation.validateVariables(variables)) {
    throw new BendystrawError(`Invalid variables for ${operation.id}`, 400);
  }

  const network = bendystrawNetworkFor(variables, chainId);
  const response = await fetch(`/api/bendystraw/${network}/query`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ operation: operation.id, variables }),
    cache: "no-store",
    signal: AbortSignal.timeout(BENDYSTRAW_TIMEOUT_MS),
  });

  let envelope: { data?: unknown; error?: unknown };
  try {
    envelope = (await response.json()) as { data?: unknown; error?: unknown };
  } catch {
    throw new BendystrawError("Bendystraw proxy returned invalid JSON", 502);
  }
  if (!response.ok) {
    throw new BendystrawError(
      typeof envelope.error === "string" ? envelope.error : "Bendystraw request failed",
      response.status,
    );
  }
  if (!operation.validateData(envelope.data)) {
    throw new BendystrawError(`Invalid response for ${operation.id}`, 502);
  }
  return envelope.data;
}
