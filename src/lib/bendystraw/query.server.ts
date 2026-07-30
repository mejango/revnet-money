import "server-only";

import { getBendystrawUrl } from "@/graphql/constants";
import {
  BendystrawRequestError as BendystrawError,
  requestBendystraw,
} from "@bananapus/nana-sdk-core";
import type { BendystrawOperation } from "./operations";
import { getRegisteredQuery } from "./registry.server";

function configuredGraphqlUrl(chainId: number): string {
  const configured = getBendystrawUrl(chainId);
  if (!configured || configured === "undefined") {
    throw new BendystrawError("Bendystraw is not configured", 503);
  }

  let url: URL;
  try {
    url = new URL(configured);
  } catch {
    throw new BendystrawError("Bendystraw is not configured", 503);
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new BendystrawError("Bendystraw is not configured", 503);
  }

  url.pathname = `${url.pathname.replace(/\/graphql\/?$/u, "").replace(/\/$/u, "")}/graphql`;
  url.search = "";
  url.hash = "";
  return url.toString();
}

export async function queryBendystraw<TResult, TVariables extends Record<string, unknown>>(
  chainId: number,
  operation: BendystrawOperation<TResult, TVariables>,
  variables: TVariables,
): Promise<TResult> {
  if (!operation.validateVariables(variables)) {
    throw new BendystrawError(`Invalid variables for ${operation.id}`, 400);
  }
  const registered = getRegisteredQuery(operation.id);
  if (!registered) {
    throw new BendystrawError("Unknown Bendystraw operation", 400);
  }

  const data = await requestBendystraw<unknown, TVariables>(
    configuredGraphqlUrl(chainId),
    registered.query,
    variables,
    {
      fetch: (input, init) => {
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return fetch(input, {
          ...init,
          body: JSON.stringify({ ...body, operationName: registered.operationName }),
          cache: "no-store",
        });
      },
    },
  );
  if (!operation.validateData(data)) {
    throw new BendystrawError(`Invalid response for ${operation.id}`, 502);
  }
  return data;
}
