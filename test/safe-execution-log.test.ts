import { findSafeExecutionTransaction } from "@/lib/safe-execution-log";
import { encodeAbiParameters, encodeFunctionResult, parseAbi, type Address, type Hex } from "viem";
import { describe, expect, it } from "vitest";
import { executionLog } from "./fixtures/safe-chain";

const SAFE = "0x000000000000000000000000000000000000dEaD" as Address;
const PROPOSAL = `0x${"12".repeat(32)}` as Hex;
const OTHER = `0x${"56".repeat(32)}` as Hex;
const EXECUTION = `0x${"ab".repeat(32)}` as Hex;
const nonceAbi = parseAbi(["function nonce() view returns (uint256)"]);

/** The canonical hash of block `number` on this chain. */
const blockHash = (number: bigint) => `0x${number.toString(16).padStart(64, "0")}` as Hex;
const AT_120 = { blockNumber: "0x78", blockHash: blockHash(120n) };

/** A Safe whose nonce moved from 7 to 8 at block 120, with `logs` in that block. */
function chain(logs: unknown[], usedAt = 120n) {
  return {
    request: async ({ method, params }: { method: string; params: unknown[] }) => {
      if (method === "eth_getBlockByNumber")
        return params[0] === "finalized"
          ? { number: "0xc8", hash: `0x${"cd".repeat(32)}` }
          : { number: params[0], hash: blockHash(BigInt(params[0] as string)) };
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
        { ...executionLog(SAFE, OTHER), ...AT_120, transactionHash: `0x${"99".repeat(32)}` },
        { ...executionLog(SAFE, PROPOSAL, eventName), ...AT_120, transactionHash: EXECUTION },
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
      ...AT_120,
      transactionHash: EXECUTION,
    };
    await expect(
      findSafeExecutionTransaction(chain([log]) as never, SAFE, PROPOSAL, 7n),
    ).resolves.toBe(EXECUTION);
  });

  it("finds nothing when the log's block is no longer canonical", async () => {
    const log = {
      ...executionLog(SAFE, PROPOSAL),
      blockNumber: "0x78",
      blockHash: `0x${"ee".repeat(32)}`,
      transactionHash: EXECUTION,
    };
    await expect(
      findSafeExecutionTransaction(chain([log]) as never, SAFE, PROPOSAL, 7n),
    ).resolves.toBeNull();
  });

  it("finds nothing when only other proposals executed there, or the node can't answer", async () => {
    await expect(
      findSafeExecutionTransaction(
        chain([{ ...executionLog(SAFE, OTHER), ...AT_120, transactionHash: EXECUTION }]) as never,
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
