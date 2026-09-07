const RELAYR_CHAINS = new Set<number>([1, 10, 8453, 42161]);

export function isRelayrSupportedChain(chainId: number): boolean {
  return RELAYR_CHAINS.has(chainId);
}
