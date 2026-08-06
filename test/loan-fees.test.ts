import {
  currentOutstandingLoanFee,
  LOAN_LIQUIDATION_DURATION,
  repayCeilingFor,
} from "@/lib/loanFees";
import { describe, expect, it } from "vitest";

describe("currentOutstandingLoanFee", () => {
  const loan = {
    amount: 1_000n,
    prepaidFeePercent: 250,
    prepaidDuration: LOAN_LIQUIDATION_DURATION / 2,
    createdAt: 1_000,
  };

  it("stays zero through the prepaid window", () => {
    expect(
      currentOutstandingLoanFee({
        ...loan,
        now: loan.createdAt + loan.prepaidDuration,
      }),
    ).toBe(0n);
  });

  it("mirrors the contract's linear post-prepay fee ramp", () => {
    expect(
      currentOutstandingLoanFee({
        ...loan,
        now: loan.createdAt + loan.prepaidDuration + loan.prepaidDuration / 2,
      }),
    ).toBe(375n);
  });

  it("marks loans past liquidation instead of inventing a fee", () => {
    expect(
      currentOutstandingLoanFee({
        ...loan,
        now: loan.createdAt + LOAN_LIQUIDATION_DURATION + 1,
      }),
    ).toBeNull();
  });
});

// `repayLoan` charges principal + accrued source fee and reverts when that total exceeds the
// `maxRepayBorrowAmount` the client sends (REVLoans.sol:984-987, :1004-1008). Sending the principal
// alone — the previous behaviour — is therefore the one value guaranteed to revert every full repay
// once the prepaid window has lapsed.
describe("repayCeilingFor", () => {
  const principal = 1_000_000_000_000_000_000n; // 1 token, 18 decimals

  it("covers principal plus the accrued fee the contract will add", () => {
    const fee = 25_000_000_000_000_000n; // 2.5%
    const ceiling = repayCeilingFor(principal, fee);
    expect(ceiling).toBeGreaterThan(principal + fee);
  });

  it("still exceeds the principal inside the prepaid window, where no fee is due", () => {
    // A zero fee must not collapse the ceiling back to the principal: the loan can leave the
    // prepaid window between the quote and inclusion.
    expect(repayCeilingFor(principal, 0n)).toBeGreaterThan(principal);
  });

  it("buys roughly 3.6 days of accrual on top of the quoted fee", () => {
    // The ramp runs to 100% of principal over the liquidation window when nothing was prepaid,
    // so the 0.1% buffer is worth LIQUIDATION_DURATION / 1000 seconds of drift.
    const buffer = repayCeilingFor(principal, 0n) - principal;
    const secondsCovered = (Number(buffer) / Number(principal)) * LOAN_LIQUIDATION_DURATION;
    expect(secondsCovered / 86_400).toBeGreaterThan(3);
    expect(secondsCovered / 86_400).toBeLessThan(4);
  });

  it("scales the buffer with the loan, and never rounds a tiny loan below its principal", () => {
    expect(repayCeilingFor(2n * principal, 0n) - 2n * principal).toBe(
      2n * (repayCeilingFor(principal, 0n) - principal),
    );
    // Dust loans round the buffer to zero, but the ceiling must never fall UNDER principal + fee.
    expect(repayCeilingFor(5n, 1n)).toBeGreaterThanOrEqual(6n);
  });
});
