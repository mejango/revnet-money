import {
  currentOutstandingLoanFee,
  LOAN_LIQUIDATION_DURATION,
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
