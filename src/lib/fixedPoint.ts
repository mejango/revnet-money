import {
  MAX_RESERVED_PERCENT,
  type ReservedPercent,
  type RulesetWeight,
} from "@bananapus/nana-sdk-core";

/**
 * Quote payer tokens for one whole base token without introducing floating
 * point arithmetic or requiring the SDK's transitive fixed-point class.
 */
export function quotePayerTokensForOneUnit({
  decimals,
  reservedPercent,
  weight,
}: {
  decimals: number;
  reservedPercent: ReservedPercent;
  weight: RulesetWeight;
}): bigint {
  const unit = 10n ** BigInt(decimals);
  const totalTokens = (weight.value * unit) / unit;
  const reservedTokens =
    (weight.value * reservedPercent.value * unit) / BigInt(MAX_RESERVED_PERCENT) / unit;
  return totalTokens - reservedTokens;
}

/** Divide two already-scaled integer values while bounding the Number conversion. */
export function ratioOfScaledIntegers(numerator: bigint, denominator: bigint): number {
  if (denominator === 0n) return 0;
  const precision = 1_000_000_000n;
  return Number((numerator * precision) / denominator) / Number(precision);
}
