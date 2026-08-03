const MAX_FEE = 1_000n;
export const LOAN_LIQUIDATION_DURATION = 3_650 * 24 * 60 * 60;

/**
 * Exact mirror of REVLoansSourceFees.sourceFeeAmountFrom for repaying all
 * outstanding principal. The fee is zero through the prepaid window, then
 * ramps linearly until the ten-year liquidation boundary.
 */
export function currentOutstandingLoanFee({
  amount,
  prepaidFeePercent,
  prepaidDuration,
  createdAt,
  now,
}: {
  amount: bigint;
  prepaidFeePercent: number;
  prepaidDuration: number;
  createdAt: number;
  now: number;
}): bigint | null {
  const elapsed = Math.max(0, now - createdAt);
  if (elapsed <= prepaidDuration) return 0n;
  if (elapsed > LOAN_LIQUIDATION_DURATION) return null;

  const prepaid = (amount * BigInt(prepaidFeePercent)) / MAX_FEE;
  const feePercent =
    (BigInt(elapsed - prepaidDuration) * MAX_FEE) /
    BigInt(LOAN_LIQUIDATION_DURATION - prepaidDuration);
  return ((amount - prepaid) * feePercent) / MAX_FEE;
}
