import { MARKEE_CHAIN_ID } from "@/lib/markee";
import type { TransactionActivity } from "@/lib/transaction-activity";
import { waitForReceiptWithRetry } from "@/lib/waitForReceipt";
import { safeExecutionResult, safeExecutionRunsCalls } from "@bananapus/nana-sdk-core/safe-service";
import type { Address, Hex, PublicClient } from "viem";

/** Associate a lost wallet reply only with an exact direct call or canonically proven Safe execution. */
export async function recoverMarkeeSubmission(
  client: PublicClient,
  account: Address,
  pending: { target: Address; data: Hex; value: string },
  hash: Hex,
): Promise<Pick<TransactionActivity, "kind" | "executionHash" | "safeProposal">> {
  if ((await client.getChainId()) !== MARKEE_CHAIN_ID)
    throw new Error("Markee recovery requires Base.");
  const transaction = await client.getTransaction({ hash });
  if (transaction.hash.toLowerCase() !== hash.toLowerCase())
    throw new Error("The recovered transaction hash does not match.");
  if (
    transaction.from.toLowerCase() === account.toLowerCase() &&
    transaction.to?.toLowerCase() === pending.target.toLowerCase() &&
    transaction.input.toLowerCase() === pending.data.toLowerCase() &&
    transaction.value === BigInt(pending.value)
  )
    return { kind: "direct", executionHash: undefined, safeProposal: undefined };

  const safeProposal = {
    safe: account,
    calls: [{ to: pending.target, data: pending.data, value: pending.value }],
    batch: false,
  };
  if (!safeExecutionRunsCalls(transaction, account, safeProposal.calls, false))
    throw new Error("That transaction does not match the saved Markee submission.");
  const receipt = await waitForReceiptWithRetry(client, hash);
  if (
    receipt.transactionHash.toLowerCase() !== hash.toLowerCase() ||
    safeExecutionResult(receipt, account, hash).status !== "success"
  )
    throw new Error("The exact recovered Safe execution could not be verified.");
  return { kind: "safe", executionHash: hash, safeProposal };
}

/**
 * Whether a settlement the write hold saw is the saved submission's: its own transaction, or, for
 * a Safe proposal, the execution the journal bound to that exact proposal.
 */
export function markeeSettlementIsSaved(
  settled: { result: string; hash?: Hex } | undefined,
  hash: Hex,
  row?: Pick<TransactionActivity, "kind" | "executionHash">,
): boolean {
  const seen = settled?.hash?.toLowerCase();
  if (!seen) return false;
  return (
    seen === hash.toLowerCase() ||
    (row?.kind === "safe" && seen === row.executionHash?.toLowerCase())
  );
}
