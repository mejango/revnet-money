import {
  isSafeProposalPendingError,
  requireOnchainExecution,
  SafeProposalPendingError,
} from "@/hooks/useReviewedWriteContract";
import { recordTransactionActivity } from "@/lib/transaction-activity";
import type { Hex } from "viem";
import { describe, expect, it } from "vitest";

const SAFE_HASH = `0x${"12".repeat(32)}` as Hex;
const CONFIRMED_HASH = `0x${"34".repeat(32)}` as Hex;
const UNCONFIRMED_HASH = `0x${"56".repeat(32)}` as Hex;

describe("Safe proposal execution boundary", () => {
  it("never treats an asynchronous Safe proposal as onchain execution", () => {
    recordTransactionActivity({
      id: "safe:test",
      kind: "safe",
      title: "Approve",
      status: "safe-proposed",
      message: "Awaiting Safe approvals",
      hash: SAFE_HASH,
    });

    expect(() => requireOnchainExecution(SAFE_HASH, "Token approval")).toThrow(
      SafeProposalPendingError,
    );
    try {
      requireOnchainExecution(SAFE_HASH, "Token approval");
    } catch (error) {
      expect(isSafeProposalPendingError(error)).toBe(true);
      expect((error as Error).message).toContain("has not executed");
      expect((error as Error).message).toContain("do not submit it again");
    }
  });

  it("refuses a dependent step of a proposal whose result can't be confirmed as an error that says to check it in Safe", () => {
    recordTransactionActivity({
      id: "safe:unconfirmed",
      kind: "safe",
      title: "Approve",
      status: "safe-proposed",
      message: "This Safe transaction's result can't be confirmed here.",
      hash: UNCONFIRMED_HASH,
      safeResultUnconfirmed: true,
    });

    let refused: unknown;
    try {
      requireOnchainExecution(UNCONFIRMED_HASH, "Token approval");
    } catch (error) {
      refused = error;
    }

    expect(refused).toBeInstanceOf(SafeProposalPendingError);
    expect((refused as Error).message).toBe(
      `Token approval was proposed to Safe as ${UNCONFIRMED_HASH}, and its result can't be confirmed here. Check it in Safe, then dismiss it in your account activity.`,
    );
    // Nothing awaits the Safe, so a caller shows it as it shows any refusal.
    expect(isSafeProposalPendingError(refused)).toBe(false);
  });

  it("allows a confirmed direct transaction to feed a dependent step", () => {
    recordTransactionActivity({
      id: "direct:test",
      kind: "direct",
      title: "Approve",
      status: "success",
      message: "Confirmed",
      hash: CONFIRMED_HASH,
    });

    expect(() => requireOnchainExecution(CONFIRMED_HASH, "Token approval")).not.toThrow();
  });
});
