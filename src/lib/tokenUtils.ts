import { USDC_ADDRESSES } from "@/app/constants";
import { NATIVE_TOKEN } from "@bananapus/nana-sdk-core";

/**
 * Get token symbol from token address
 * @param tokenAddress - The token address to resolve
 * @returns The token symbol (ETH, USDC, or TOKEN as fallback)
 */
export function getTokenSymbolFromAddress(tokenAddress: string) {
  // Check for ETH (case insensitive)
  if (tokenAddress?.toLowerCase() === NATIVE_TOKEN.toLowerCase()) {
    return "ETH";
  }

  // Check for USDC (case insensitive)
  const isUsdc = Object.values(USDC_ADDRESSES)
    .map((addr) => addr.toLowerCase())
    .includes(tokenAddress?.toLowerCase() as `0x${string}`);

  if (isUsdc) return "USDC";

  return "TOKEN";
}

/**
 * Token configuration for a specific chain
 */
export interface TokenConfig {
  token: `0x${string}`;
  currency: number;
  decimals: number;
  symbol?: string;
}

/** Whether an address is the protocol's native-token sentinel. Symbols are
 * display-only — gate behavior (value attachment, allowance checks) on this. */
export function isNativeToken(tokenAddress: string | undefined | null): boolean {
  return tokenAddress?.toLowerCase() === NATIVE_TOKEN.toLowerCase();
}

/**
 * Get token configuration for a specific chain from sucker group data.
 *
 * Returns null while the sucker-group data is missing/loading or the chain has
 * no resolvable accounting token. Callers must treat null as LOADING (disable
 * submits, show skeletons) — never default to ETH/18: a USDC loan rendered as
 * ETH skips the allowance gate and attaches native value.
 */
export function getTokenConfigForChain(
  suckerGroupData: any,
  targetChainId: number,
): TokenConfig | null {
  const projectForChain = suckerGroupData?.suckerGroup?.projects?.items?.find(
    (project: any) => project.chainId === targetChainId,
  );
  if (!projectForChain?.token) return null;

  return {
    token: projectForChain.token as `0x${string}`,
    currency: Number(projectForChain.currency),
    decimals: projectForChain.decimals || 18,
    symbol:
      projectForChain.tokenSymbol ||
      getTokenSymbolFromAddress(projectForChain.token as `0x${string}`),
  };
}
