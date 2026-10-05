import { requireRefundFreeSafeExecution } from "@/lib/safe-transactions";
import type { Address, Hex } from "viem";
import { describe, expect, it } from "vitest";
import { executionLog } from "./fixtures/safe-chain";

const SAFE = "0x2222222222222222222222222222222222222222" as Address;
const REVIEWED = `0x${"ab".repeat(32)}` as Hex;
const OTHER = `0x${"cd".repeat(32)}` as Hex;
const receipt = (logs: ReturnType<typeof executionLog>[], status = "success") => ({
  status,
  transactionHash: `0x${"ef".repeat(32)}` as Hex,
  logs,
});

describe("a refund-free Safe execution", () => {
  it("is proven only by the Safe's ExecutionSuccess for the reviewed hash", () => {
    expect(() =>
      requireRefundFreeSafeExecution(receipt([executionLog(SAFE, REVIEWED)]), SAFE, REVIEWED),
    ).not.toThrow();
    for (const logs of [
      [],
      [executionLog(SAFE, OTHER)],
      [executionLog(OTHER.slice(0, 42) as Address, REVIEWED)],
      [executionLog(SAFE, REVIEWED), executionLog(SAFE, REVIEWED)],
    ]) {
      expect(() => requireRefundFreeSafeExecution(receipt(logs), SAFE, REVIEWED)).toThrow();
    }
    expect(() =>
      requireRefundFreeSafeExecution(
        receipt([executionLog(SAFE, REVIEWED, "ExecutionFailure")]),
        SAFE,
        REVIEWED,
      ),
    ).toThrow("ExecutionFailure");
    expect(() =>
      requireRefundFreeSafeExecution(
        receipt([executionLog(SAFE, REVIEWED)], "reverted"),
        SAFE,
        REVIEWED,
      ),
    ).toThrow("reverted");
  });

  it("refuses an execution that paid a refund, and ignores another proposal's refund", () => {
    expect(() =>
      requireRefundFreeSafeExecution(
        receipt([executionLog(SAFE, REVIEWED, "ExecutionSuccess", 1n)]),
        SAFE,
        REVIEWED,
      ),
    ).toThrow("The Safe paid a gas refund for this transaction.");
    expect(() =>
      requireRefundFreeSafeExecution(
        receipt([executionLog(SAFE, REVIEWED), executionLog(SAFE, OTHER, "ExecutionSuccess", 1n)]),
        SAFE,
        REVIEWED,
      ),
    ).not.toThrow();
  });
});
