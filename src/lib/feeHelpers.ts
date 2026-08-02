import { REVNET_CASHOUT_FEE_PERCENT } from "@/app/constants";
import { cashOutProtocolFee } from "@/lib/bridgePrepare";
import { calcPrepaidFee } from "@bananapus/nana-sdk-core";

export function generateFeeData({
  grossBorrowedEth,
  prepaidPercent,
  fixedLoanFee = 0.035,
}: {
  grossBorrowedEth: number;
  prepaidPercent: string;
  fixedLoanFee?: number;
}) {
  // Safety check for invalid inputs
  if (!grossBorrowedEth || grossBorrowedEth <= 0 || isNaN(grossBorrowedEth)) {
    return [
      { year: 0, totalCost: 0 },
      { year: 10, totalCost: 0 },
    ];
  }

  const MAX_YEARS = 10;
  const monthsToPrepay = (parseFloat(prepaidPercent) / 50) * 120;
  const prepaidDuration = monthsToPrepay / 12;

  // Fixed fees (3.5%) come off the top
  const fixedFee = grossBorrowedEth * fixedLoanFee;

  // Prepaid fee is applied to the gross borrowed amount
  const feeBpsBigInt = calcPrepaidFee(Math.round(monthsToPrepay));
  const feeBps = Number(feeBpsBigInt);
  const prepaidFee = (grossBorrowedEth * feeBps) / 10000;

  // Amount user actually receives
  const amountUserReceives = grossBorrowedEth - fixedFee - prepaidFee;

  // Amount user must repay to unlock collateral (the full borrowed amount)
  const borrowedAmount = grossBorrowedEth;

  // Variable fees are calculated on the amount after fixed and prepaid fees
  const decayingPortion = amountUserReceives;

  const data = [];

  // Generate data points every 0.25 years, but ensure we reach exactly 10 years
  for (let year = 0; year < MAX_YEARS; year += 0.25) {
    let variableFee = 0;

    if (year > prepaidDuration && year <= MAX_YEARS) {
      const elapsedAfterPrepaid = year - prepaidDuration;
      const remainingTime = MAX_YEARS - prepaidDuration;
      // Safety check for division by zero
      const percentElapsed = remainingTime > 0 ? elapsedAfterPrepaid / remainingTime : 0;
      variableFee = decayingPortion * percentElapsed;
    } else if (year > MAX_YEARS) {
      variableFee = decayingPortion;
    }

    const clampedVariableFee = Math.min(variableFee, decayingPortion);

    // Total cost to unlock = full borrowed amount + variable fees
    // (Fixed fees and prepaid fees are already "paid" by receiving less)
    const totalCostToUnlock = borrowedAmount + clampedVariableFee;

    data.push({ year, totalCost: totalCostToUnlock });
  }

  // Add the final point at exactly 10 years with maximum value
  const maxVariableFee = decayingPortion;
  const maxCostToUnlock = borrowedAmount + maxVariableFee;
  data.push({ year: MAX_YEARS, totalCost: maxCostToUnlock });

  return data;
}

export function applyRevFee(tokenAmount: bigint) {
  return (tokenAmount * BigInt((1 - REVNET_CASHOUT_FEE_PERCENT) * 1000)) / 1000n;
}

/**
 * The flat 2.5% protocol fee with the contract's floor division:
 * `amount - amount / 40`. Used where the ruleset's cash-out tax is unknown.
 */
export function applyNanaFee(reclaimableAmount: bigint) {
  return reclaimableAmount - reclaimableAmount / 40n;
}

/**
 * What a borrower receives from a new loan at the minimum source fee.
 *
 * `REVLoans` first withdraws the gross borrow through `JBMultiTerminal`, which
 * takes the standard 2.5% protocol fee (`gross / 40`). It then takes the 1%
 * REV fee and the selected source fee, both from the original gross amount.
 * Owner summaries use the on-chain minimum source fee of 2.5% so their "Max
 * loan" value describes spendable proceeds rather than principal owed.
 */
export function netLoanProceeds(grossBorrowAmount: bigint, prepaidSourceFeePercent = 25n): bigint {
  const protocolFee = grossBorrowAmount / 40n;
  const revFee = (grossBorrowAmount * 10n) / 1000n;
  const sourceFee = (grossBorrowAmount * prepaidSourceFeePercent) / 1000n;
  const fees = protocolFee + revFee + sourceFee;
  return grossBorrowAmount > fees ? grossBorrowAmount - fees : 0n;
}

/**
 * Net cash-out value after the protocol fee, mirroring
 * `JBMultiTerminal._cashOutTokensOf`: a nonzero cash-out tax makes the whole
 * reclaim feeable; a zero tax charges the fee only up to `feeFreeSurplusOf`.
 */
export function netCashOutValue({
  reclaimAmount,
  cashOutTaxRate,
  feeFreeSurplus,
}: {
  reclaimAmount: bigint;
  cashOutTaxRate: bigint;
  feeFreeSurplus: bigint;
}) {
  const fee = cashOutProtocolFee({
    reclaimAmount,
    cashOutTaxRate,
    beneficiaryIsFeeless: false,
    feeFreeSurplus,
  });
  return reclaimAmount - fee;
}
