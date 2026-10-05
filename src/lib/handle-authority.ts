import { chainDisplayName } from "@/app/constants";
import {
  proveSafeCreation,
  readCrossChainHandleAuthority,
  type CrossChainHandleAuthority,
  type SafeCreation,
} from "@bananapus/nana-sdk-core/safe";
import { fetchSafeCreation, type SafeServiceOptions } from "@bananapus/nana-sdk-core/safe-service";
import type { Address } from "viem";

export type HandleAuthority = CrossChainHandleAuthority & {
  /** The project chain's record of how the authority's Safe was made; null for anything else. */
  creation: SafeCreation | null;
};

type HandleAuthorityArgs = Omit<Parameters<typeof readCrossChainHandleAuthority>[0], "creation">;

/** A record that proves a Safe's address never changes; a missing one is asked for again soon. */
const PROVEN_CREATION_TTL_MS = 24 * 60 * 60_000;
const UNPROVEN_CREATION_TTL_MS = 60_000;
const MAX_CACHED_CREATIONS = 500;

type CachedCreation = { creation: SafeCreation | null; proven: boolean; expires: number };

/** Each Safe's creation record per chain, kept for the life of the page or the server process. */
const creations = new Map<string, CachedCreation>();

function creationKey(chainId: number, safe: Address): string {
  return `${chainId}:${safe.toLowerCase()}`;
}

function cachedCreation(chainId: number, safe: Address): CachedCreation | undefined {
  const cached = creations.get(creationKey(chainId, safe));
  return cached && cached.expires > Date.now() ? cached : undefined;
}

async function readCreation(
  chainId: number,
  safe: Address,
  options: SafeServiceOptions,
): Promise<CachedCreation> {
  const creation = await fetchSafeCreation(safe, chainId, options);
  const proven = creation !== null && proveSafeCreation(creation, safe).valid;
  const entry = {
    creation,
    proven,
    expires: Date.now() + (proven ? PROVEN_CREATION_TTL_MS : UNPROVEN_CREATION_TTL_MS),
  };
  const key = creationKey(chainId, safe);
  creations.delete(key);
  creations.set(key, entry);
  if (creations.size > MAX_CACHED_CREATIONS) {
    creations.delete(creations.keys().next().value!);
  }
  return entry;
}

/**
 * Whether `authority` may publish the project's Ethereum handle, read by the SDK with the
 * creation record it needs before it trusts a Safe on another chain. The record comes from the
 * project chain's Safe service, only for a Safe, and is cached per chain and Safe. Without a
 * record that proves the Safe's address (no service, a failed request, another Safe's record) a
 * Safe reads `unproven-creation` and is not allowed.
 */
export async function readHandleAuthority(
  args: HandleAuthorityArgs,
  options: SafeServiceOptions = {},
): Promise<HandleAuthority> {
  const known = cachedCreation(args.sourceChainId, args.authority);
  const authority = await readCrossChainHandleAuthority({
    ...args,
    creation: known?.creation ?? null,
  });
  // The SDK reads the authority on its project chain; only a Safe there needs a record.
  if (known || authority.source?.kind !== "safe") {
    return { ...authority, creation: known?.creation ?? null };
  }
  const read = await readCreation(args.sourceChainId, args.authority, options);
  // The record decides the verdict only for an otherwise matching Safe: the SDK weighs it then.
  if (authority.status !== "unproven-creation" || !read.proven) {
    return { ...authority, creation: read.creation };
  }
  return {
    ...(await readCrossChainHandleAuthority({ ...args, creation: read.creation })),
    creation: read.creation,
  };
}

/** What the app says when a Safe's creation does not prove it is the same Safe on `chainId`. */
export function unprovenSafeMessage(chainId: number): string {
  return `Can't verify this Safe is the same on ${chainDisplayName(chainId)}.`;
}
