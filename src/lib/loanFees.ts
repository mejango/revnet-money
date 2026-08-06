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

/**
 * How much `repayLoan` may pull, as its `maxRepayBorrowAmount` argument.
 *
 * The contract adds the accrued source fee ON TOP of the principal and reverts when the sum exceeds
 * this ceiling (REVLoans.sol:984-987, :1004-1008), so the principal alone is not a ceiling once the
 * prepaid window lapses — it is the one value guaranteed to be too small. The fee also keeps accruing
 * between quoting and inclusion, so add a buffer: the ramp reaches 100% over the ten-year liquidation
 * window, which makes a 0.1% slice of principal worth roughly 3.6 days of accrual. Anything unused is
 * refunded (REVLoans.sol:1023-1031), so overshooting only costs balance and allowance headroom.
 */
export function repayCeilingFor(principal: bigint, accruedSourceFee: bigint): bigint {
  return principal + accruedSourceFee + principal / 1_000n;
}
