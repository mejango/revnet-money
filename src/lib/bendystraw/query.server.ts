import "server-only";

import { getBendystrawUrl } from "@/graphql/constants";
import {
  BendystrawRequestError as BendystrawError,
  normalizeBendystrawEndpoint,
  requestBendystraw,
} from "@bananapus/nana-sdk-core";
import { compileBendystrawOperation } from "@bananapus/nana-sdk-core/bendystraw-operations";
import type { BendystrawOperation } from "./operations";
import { getRegisteredQuery } from "./registry.server";

function configuredGraphqlUrl(chainId: number): string {
  const configured = getBendystrawUrl(chainId);
  if (!configured || configured === "undefined") {
    throw new BendystrawError("Bendystraw is not configured", 503);
  }

  try {
    return normalizeBendystrawEndpoint(configured);
  } catch {
    throw new BendystrawError("Bendystraw is not configured", 503);
  }
}

export async function queryBendystraw<TResult, TVariables extends Record<string, unknown>>(
  chainId: number,
  operation: BendystrawOperation<TResult, TVariables>,
  variables: TVariables,
): Promise<TResult> {
  const registered = getRegisteredQuery(operation.id);
  if (!registered) {
    throw new BendystrawError("Unknown Bendystraw operation", 400);
  }
  const documentContract = compileBendystrawOperation(registered.query);

  // Whether the indexer's last answer was a rate limit, and the wait it named in whole seconds,
  // for the relay to pass on. The SDK reports a 429 without a JSON body as a bad response.
  let limited = false;
  let retryAfter: string | undefined;
  try {
    return await requestBendystraw<TResult, TVariables>(
      configuredGraphqlUrl(chainId),
      registered.query,
      variables,
      {
        fetch: async (input, init) => {
          const response = await fetch(input, { ...init, cache: "no-store" });
          limited = response.status === 429;
          const seconds = limited ? response.headers.get("retry-after") : null;
          retryAfter = seconds && /^\d{1,5}$/u.test(seconds) ? seconds : undefined;
          return response;
        },
        operationName: documentContract.operationName ?? registered.operationName,
        validateData: (value) =>
          documentContract.validateData(value) && operation.validateData(value),
        validateVariables: (value) =>
          documentContract.validateVariables(value) && operation.validateVariables(value),
      },
    );
  } catch (error) {
    if (limited && error instanceof BendystrawError)
      throw Object.assign(new BendystrawError(error.message, 429), { retryAfter });
    throw error;
  }
}
