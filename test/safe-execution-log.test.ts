import { findSafeExecutionTransaction } from "@/lib/safe-execution-log";
import { encodeAbiParameters, encodeFunctionResult, parseAbi, type Address, type Hex } from "viem";
import { describe, expect, it } from "vitest";
import { executionLog } from "./fixtures/safe-chain";

const SAFE = "0x000000000000000000000000000000000000dEaD" as Address;
const PROPOSAL = `0x${"12".repeat(32)}` as Hex;
const OTHER = `0x${"56".repeat(32)}` as Hex;
const EXECUTION = `0x${"ab".repeat(32)}` as Hex;
const nonceAbi = parseAbi(["function nonce() view returns (uint256)"]);

/** A Safe whose nonce moved from 7 to 8 at block 120, with `logs` in that block. */
function chain(logs: unknown[], usedAt = 120n) {
  return {
    request: async ({ method, params }: { method: string; params: unknown[] }) => {
      if (method === "eth_getBlockByNumber")
        return { number: "0xc8", hash: `0x${"cd".repeat(32)}` };
      if (method === "eth_call") {
        const block = BigInt(params[1] as string);
        return encodeFunctionResult({
          abi: nonceAbi,
          functionName: "nonce",
          result: block >= usedAt ? 8n : 7n,
        });
      }
      if (method === "eth_getCode") return "0x60";
      if (method === "eth_getLogs") {
        const [filter] = params as [{ fromBlock: string; toBlock: string }];
        return BigInt(filter.fromBlock) === usedAt && BigInt(filter.toBlock) === usedAt ? logs : [];
      }
      throw new Error(`unexpected ${method}`);
    },
  };
}

describe("finding a proven Safe execution's transaction", () => {
  it.each(["ExecutionSuccess", "ExecutionFailure"] as const)(
    "returns the transaction of the %s event for the proposal in the block that used its nonce",
    async (eventName) => {
      const logs = [
        { ...executionLog(SAFE, OTHER), transactionHash: `0x${"99".repeat(32)}` },
        { ...executionLog(SAFE, PROPOSAL, eventName), transactionHash: EXECUTION },
      ];
      await expect(
        findSafeExecutionTransaction(chain(logs) as never, SAFE, PROPOSAL, 7n),
      ).resolves.toBe(EXECUTION);
    },
  );

  it("reads the Safe 1.3 layout, whose safeTxHash is the first data word", async () => {
    const log = {
      address: SAFE,
      topics: [executionLog(SAFE, PROPOSAL).topics[0]],
      data: encodeAbiParameters([{ type: "bytes32" }, { type: "uint256" }], [PROPOSAL, 0n]),
      transactionHash: EXECUTION,
    };
    await expect(
      findSafeExecutionTransaction(chain([log]) as never, SAFE, PROPOSAL, 7n),
    ).resolves.toBe(EXECUTION);
  });

  it("finds nothing when only other proposals executed there, or the node can't answer", async () => {
    await expect(
      findSafeExecutionTransaction(
        chain([{ ...executionLog(SAFE, OTHER), transactionHash: EXECUTION }]) as never,
        SAFE,
        PROPOSAL,
        7n,
      ),
    ).resolves.toBeNull();
    await expect(
      findSafeExecutionTransaction(
        { request: async () => Promise.reject(new Error("down")) } as never,
        SAFE,
        PROPOSAL,
        7n,
      ),
    ).resolves.toBeNull();
  });
});
