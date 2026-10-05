import "server-only";

import { readHandleAuthority } from "@/lib/handle-authority";
import {
  ENS_REGISTRY_ADDRESS,
  ensRegistryAbi,
  parseProjectHandleInput,
  parseProjectHandleRecord,
  PROJECT_HANDLE_CHAIN_ID,
  readExactEnsText,
  readExactProjectHandle,
} from "@/lib/projectHandles";
import {
  findCurrentRevnetOperator,
  findRevnetOperatorFromPermissionHistory,
} from "@/lib/revnetOperator";
import { decodeProjectRouteSlug, parseDecodedSlug, parseSlug } from "@/lib/slug";
import { getViemPublicClient } from "@/lib/wagmiTransports";
import {
  getJBContractAddress,
  JBCoreContracts,
  jbProjectsAbi,
  RevnetCoreContracts,
  revOwnerAbi,
} from "@bananapus/nana-sdk-core";
import type { SafeServiceOptions } from "@bananapus/nana-sdk-core/safe-service";
import { cache } from "react";
import { namehash, zeroAddress, type Address } from "viem";
import { getIndexedProjectOperatorAddresses } from "./getProjectOperator";

const SAFE_SERVICE_TIMEOUT_MS = 4_000;

/**
 * Safe's transaction service as a route render reads it, the same rule as Juicebox Money's page
 * server: one attempt, its answer read in full within 4 seconds, and a 429 refused rather than
 * waited out. A service the server cannot reach leaves a Safe's creation unproven instead of
 * holding the page.
 */
const serverSafeService: SafeServiceOptions = {
  fetch: async (input, init) => {
    const deadline = new AbortController();
    const timer = setTimeout(() => deadline.abort(), SAFE_SERVICE_TIMEOUT_MS);
    try {
      const response = await fetch(input, {
        ...init,
        cache: "no-store",
        signal: deadline.signal,
      });
      if (response.status === 429) {
        await response.body?.cancel();
        return new Response(null, { status: 503 });
      }
      return new Response(await response.text(), {
        status: response.status,
        headers: response.headers,
      });
    } finally {
      clearTimeout(timer);
    }
  },
};

export type ResolvedProjectRoute = ReturnType<typeof parseSlug> & {
  /** Present only when an @handle route live-verified this exact setter. */
  verifiedOperator?: Address;
};

/**
 * Resolve either a numeric project slug or a bidirectionally verified ENS
 * handle. Handle lookups deliberately remain live: ENS records and revnet
 * operators can both change, so a durable route cache would preserve stale
 * authority.
 */
export async function resolveProjectRouteUncached(
  slug: string,
): Promise<ResolvedProjectRoute | null> {
  const decodedSlug = decodeProjectRouteSlug(slug);
  if (decodedSlug === null) return null;

  try {
    return parseDecodedSlug(decodedSlug);
  } catch {
    // Continue only for the explicit pretty-route syntax below.
  }

  if (!decodedSlug.startsWith("@")) return null;

  let requested;
  try {
    requested = parseProjectHandleInput(decodedSlug);
  } catch {
    return null;
  }

  try {
    const client = getViemPublicClient(PROJECT_HANDLE_CHAIN_ID);
    const node = namehash(requested.ensName);
    const blockNumber = await client.getBlockNumber();
    const resolver = await client.readContract({
      address: ENS_REGISTRY_ADDRESS,
      abi: ensRegistryAbi,
      functionName: "resolver",
      args: [node],
      blockNumber,
    });
    if (resolver === zeroAddress) return null;
    const record = parseProjectHandleRecord(
      await readExactEnsText(client, resolver, node, blockNumber),
    );
    if (!record || record.projectId > BigInt(Number.MAX_SAFE_INTEGER)) return null;

    // Revnet operators are the callable authority shown by this client's
    // Operator tab. An arbitrary permissionless setter must never make a
    // handle canonical here.
    const projectClient = getViemPublicClient(record.chainId);
    const projectBlock =
      record.chainId === PROJECT_HANDLE_CHAIN_ID
        ? blockNumber
        : await projectClient.getBlockNumber();
    const revOwnerAddress = getJBContractAddress(RevnetCoreContracts.REVOwner, 6, record.chainId);
    const projectOwner = await projectClient.readContract({
      address: getJBContractAddress(JBCoreContracts.JBProjects, 6, record.chainId),
      abi: jbProjectsAbi,
      functionName: "ownerOf",
      args: [record.projectId],
      blockNumber: projectBlock,
    });
    if (projectOwner.toLowerCase() !== revOwnerAddress.toLowerCase()) return null;
    const candidateIsCurrent = (candidate: Address) =>
      projectClient.readContract({
        address: revOwnerAddress,
        abi: revOwnerAbi,
        functionName: "isOperatorOf",
        args: [record.projectId, candidate],
        blockNumber: projectBlock,
      });
    const candidateVerifies = async (candidate: Address) => {
      // The reverse claim is written on Ethereum even for L2 revnets. Address
      // equality alone is not proof that a contract operator has the same
      // controller on both chains, and a Safe needs its creation record from
      // the project chain's Safe service: without it the route stays unproven.
      const authority = await readHandleAuthority(
        {
          sourceChainId: record.chainId,
          sourceClient: projectClient,
          mainnetClient: client,
          authority: candidate,
          sourceBlockNumber: projectBlock,
          mainnetBlockNumber: blockNumber,
        },
        serverSafeService,
      );
      if (!authority.allowed) return false;

      const verified = await readExactProjectHandle(
        client,
        record.chainId,
        record.projectId,
        candidate,
        blockNumber,
      );
      return verified === requested.handle;
    };

    // Bendystraw is a fast candidate source, not a routing dependency. A
    // newly published handle must route immediately even while its operator
    // row is stale or the indexer is unavailable.
    let operator = null;
    try {
      operator = await findCurrentRevnetOperator(
        await getIndexedProjectOperatorAddresses(Number(record.projectId), record.chainId),
        candidateIsCurrent,
      );
    } catch {
      // Fall back to canonical target-chain permission history below.
    }
    if (operator) {
      // isOperatorOf represents the complete operator permission set and
      // REVOwner rotation revokes it before granting the replacement. Once a
      // live indexed operator is known, a bad identity/handle is a definitive
      // mismatch — do not turn arbitrary invalid ENS aliases into historical
      // log scans.
      if (!(await candidateVerifies(operator))) return null;
      return { chainId: record.chainId, projectId: record.projectId, verifiedOperator: operator };
    }

    // Continue through canonical history only if Bendystraw was stale or
    // unavailable. Discovery stops at the first live REVOwner operator; the
    // comparatively expensive cross-chain identity and handle checks run once.
    {
      operator = await findRevnetOperatorFromPermissionHistory({
        client: projectClient,
        chainId: record.chainId,
        permissions: getJBContractAddress(JBCoreContracts.JBPermissions, 6, record.chainId),
        revOwner: revOwnerAddress,
        projectId: record.projectId,
        throughBlock: projectBlock,
        accept: candidateIsCurrent,
      });
    }
    if (!operator || !(await candidateVerifies(operator))) return null;
    return { chainId: record.chainId, projectId: record.projectId, verifiedOperator: operator };
  } catch {
    // ENS, the resolver, Bendystraw, and RPC are all upstream route
    // dependencies. Fail closed instead of accepting one side of the link.
    return null;
  }
}

export const resolveProjectRoute = cache(resolveProjectRouteUncached);
