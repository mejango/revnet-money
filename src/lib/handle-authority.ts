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

/** Each Safe's creation record per chain, kept for the life of the page or the server process. */
const creations = new Map<string, { read: Promise<SafeCreation | null>; expires: number }>();

function creationKey(chainId: number, safe: Address): string {
  return `${chainId}:${safe.toLowerCase()}`;
}

/** The read of `safe`'s creation record on `chainId` while it is cached, finished or not. */
function cachedCreation(chainId: number, safe: Address): Promise<SafeCreation | null> | undefined {
  const cached = creations.get(creationKey(chainId, safe));
  return cached && cached.expires > Date.now() ? cached.read : undefined;
}

/**
 * The record of how `safe` was made, from `chainId`'s Safe service. Reads of one Safe share a
 * request, as Juicebox Money's do; a record that proves the Safe's address is kept for a day,
 * anything else for a minute.
 */
function readCreation(
  chainId: number,
  safe: Address,
  options: SafeServiceOptions,
): Promise<SafeCreation | null> {
  const cached = cachedCreation(chainId, safe);
  if (cached) return cached;
  const entry = {
    read: fetchSafeCreation(safe, chainId, options),
    expires: Date.now() + UNPROVEN_CREATION_TTL_MS,
  };
  const key = creationKey(chainId, safe);
  creations.delete(key);
  creations.set(key, entry);
  if (creations.size > MAX_CACHED_CREATIONS) {
    creations.delete(creations.keys().next().value!);
  }
  void entry.read.then((creation) => {
    if (creation && proveSafeCreation(creation, safe).valid) {
      entry.expires = Date.now() + PROVEN_CREATION_TTL_MS;
    }
  });
  return entry.read;
}

/**
 * Whether `authority` may publish the project's Ethereum handle, read by the SDK with the
 * creation record it needs before it trusts a Safe on another chain. The record comes from the
 * project chain's Safe service, only for a Safe, and is cached per chain and Safe. Without a
 * record that proves the Safe's address (no service, a failed request, another Safe's record) a
 * Safe reads `unproven-creation` and is not allowed. A Safe's first check without a cached record
 * asks the SDK twice: once to learn it is a Safe, and again with a record that proves it.
 */
export async function readHandleAuthority(
  args: HandleAuthorityArgs,
  options: SafeServiceOptions = {},
): Promise<HandleAuthority> {
  const known = cachedCreation(args.sourceChainId, args.authority);
  const creation = known ? await known : null;
  const authority = await readCrossChainHandleAuthority({ ...args, creation });
  // The SDK reads the authority on its project chain; only a Safe there needs a record.
  if (known || authority.source?.kind !== "safe") return { ...authority, creation };
  const read = await readCreation(args.sourceChainId, args.authority, options);
  // The record decides the verdict only for an otherwise matching Safe: the SDK weighs it then.
  if (
    authority.status !== "unproven-creation" ||
    !read ||
    !proveSafeCreation(read, args.authority).valid
  ) {
    return { ...authority, creation: read };
  }
  return {
    ...(await readCrossChainHandleAuthority({ ...args, creation: read })),
    creation: read,
  };
}

/** What the app says when a Safe's creation does not prove it is the same Safe on `chainId`. */
export function unprovenSafeMessage(chainId: number): string {
  return `Can't verify this Safe is the same on ${chainDisplayName(chainId)}.`;
}
