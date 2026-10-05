import { chainDisplayName } from "@/app/constants";
import { PROJECT_HANDLE_CHAIN_ID } from "@/lib/projectHandles";
import {
  readAuthorityIdentity,
  readCrossChainHandleAuthority,
  type CrossChainHandleAuthority,
  type SafeCreation,
} from "@bananapus/nana-sdk-core/safe";
import { fetchSafeCreation, type SafeServiceOptions } from "@bananapus/nana-sdk-core/safe-service";

export type HandleAuthority = CrossChainHandleAuthority & {
  /** The project chain's record of how the authority's Safe was made; null for anything else. */
  creation: SafeCreation | null;
};

type HandleAuthorityArgs = Omit<Parameters<typeof readCrossChainHandleAuthority>[0], "creation">;

/**
 * Whether `authority` may publish the project's Ethereum handle, read by the SDK with the
 * creation record it needs before it trusts a Safe on another chain. The record comes from the
 * project chain's Safe service, and only when the authority is a Safe there. Without one (no
 * service, a failed request, a record that does not prove the address) a Safe reads
 * `unproven-creation` and is not allowed.
 */
export async function readHandleAuthority(
  args: HandleAuthorityArgs,
  options: SafeServiceOptions = {},
): Promise<HandleAuthority> {
  const creation = await projectChainSafeCreation(args, options);
  return { ...(await readCrossChainHandleAuthority({ ...args, creation })), creation };
}

async function projectChainSafeCreation(
  { sourceChainId, sourceClient, authority, sourceBlockNumber }: HandleAuthorityArgs,
  options: SafeServiceOptions,
): Promise<SafeCreation | null> {
  // An Ethereum project's authority publishes its own handle; there is no other chain to trust.
  if (sourceChainId === PROJECT_HANDLE_CHAIN_ID) return null;
  const source = await readAuthorityIdentity(sourceClient, authority, {
    blockNumber: sourceBlockNumber,
  });
  return source?.kind === "safe" ? fetchSafeCreation(authority, sourceChainId, options) : null;
}

/** What the app says when a Safe's creation does not prove it is the same Safe on `chainId`. */
export function unprovenSafeMessage(chainId: number): string {
  return `Can't verify this Safe is the same on ${chainDisplayName(chainId)}.`;
}
