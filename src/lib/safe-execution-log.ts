import { readBoundedSafeNonce } from "@bananapus/nana-sdk-core/safe";
import { isHash, type Address, type Hex, type PublicClient } from "viem";

const EXECUTION_SUCCESS_TOPIC =
  "0x442e715f626346e8c54381002da614f62bee8d27386535b2521ec8540898556e";
const EXECUTION_FAILURE_TOPIC =
  "0x23428b18acfb3ea64b08dc0c1d296ea9c09702c09083ca5272e64d115b687d23";
/** The nonce search stops after this many reads, as the SDK's does. */
const MAX_NONCE_READS = 64;

type RequestClient = Pick<PublicClient, "request">;

/**
 * The transaction that executed Safe proposal `safeTxHash` at `nonce`: the
 * block where the Safe's nonce first passed it, at or below a finalized block,
 * holds its ExecutionSuccess or ExecutionFailure event, in the Safe 1.4 layout
 * (safeTxHash indexed) or the 1.3 layout (its first data word). The SDK's
 * `lookAtSafeProposal` proves the proposal executed but does not return this
 * transaction, which its receipt needs. Null when it can't be found or read.
 */
export async function findSafeExecutionTransaction(
  client: RequestClient,
  safe: Address,
  safeTxHash: Hex,
  nonce: bigint,
): Promise<Hex | null> {
  const request = client.request as (args: {
    method: string;
    params: unknown[];
  }) => Promise<unknown>;
  try {
    const finalized = (await request({
      method: "eth_getBlockByNumber",
      params: ["finalized", false],
    })) as { number?: unknown } | null;
    if (typeof finalized?.number !== "string") return null;
    let reads = 0;
    const used = async (blockNumber: bigint) => {
      if ((reads += 1) > MAX_NONCE_READS) throw new Error("Safe nonce search exhausted");
      const value = await readBoundedSafeNonce(client, safe, { blockNumber });
      if (value === null) throw new Error("Unreadable Safe nonce");
      return value > nonce;
    };
    let high = BigInt(finalized.number);
    if (!(await used(high))) return null;
    let low = high;
    for (let step = 1n; ; step *= 2n) {
      low = high > step ? high - step : 0n;
      if (!(await used(low))) break;
      if (low === 0n) return null;
      high = low;
    }
    while (high - low > 1n) {
      const middle = (low + high) / 2n;
      if (await used(middle)) high = middle;
      else low = middle;
    }
    const block = `0x${high.toString(16)}`;
    const logs = await request({
      method: "eth_getLogs",
      params: [
        {
          address: safe,
          fromBlock: block,
          toBlock: block,
          topics: [[EXECUTION_SUCCESS_TOPIC, EXECUTION_FAILURE_TOPIC]],
        },
      ],
    });
    if (!Array.isArray(logs)) return null;
    const wanted = safeTxHash.toLowerCase();
    for (const log of logs as {
      address?: unknown;
      topics?: unknown;
      data?: unknown;
      transactionHash?: unknown;
    }[]) {
      if (typeof log?.address !== "string" || log.address.toLowerCase() !== safe.toLowerCase())
        continue;
      const topics = Array.isArray(log.topics) ? (log.topics as unknown[]) : [];
      const topic = typeof topics[0] === "string" ? topics[0].toLowerCase() : "";
      if (topic !== EXECUTION_SUCCESS_TOPIC && topic !== EXECUTION_FAILURE_TOPIC) continue;
      const data = typeof log.data === "string" ? log.data.toLowerCase() : "";
      const named =
        topics.length === 2
          ? typeof topics[1] === "string" && topics[1].toLowerCase() === wanted
          : topics.length === 1 && `0x${data.slice(2, 66)}` === wanted;
      if (named && typeof log.transactionHash === "string" && isHash(log.transactionHash))
        return log.transactionHash;
    }
    return null;
  } catch {
    return null;
  }
}
