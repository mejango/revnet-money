"use client";

import { chainDisplayName } from "@/app/constants";
import {
  failTransactionActivityVerification,
  holdTransactionActivityForVerification,
  releaseTransactionActivityVerification,
} from "@/lib/transaction-activity";
import { waitForReceiptWithRetry } from "@/lib/waitForReceipt";
import { multiSendCallsOf } from "@bananapus/nana-sdk-core/safe";
import {
  requireSafeExecutionSuccess,
  safeExecutionResult,
} from "@bananapus/nana-sdk-core/safe-service";
import {
  isAddressEqual,
  type Address,
  type Hex,
  type PublicClient,
  type TransactionReceipt,
} from "viem";

/** The origin every Safe proposal from this app names. */
export const SAFE_PROPOSAL_ORIGIN = "revnet.money";

/** Why a queued transaction that pays its executor a gas refund is never executed here. */
export const REFUND_REFUSAL = "This transaction pays a gas refund, so it can't be executed here.";

/** A call a Safe proposal was reviewed to run; its value in wei, as a decimal string in the journal. */
export type ReviewedSafeCall = { to: Address; value: bigint | string; data: Hex };

/** What a Safe proposal was reviewed to run: one call, or a batch of calls run in order. */
export type ReviewedSafeProposal = {
  safe: Address;
  calls: readonly ReviewedSafeCall[];
  batch: boolean;
};

/**
 * Whether the Safe transaction `tx` runs exactly the reviewed `calls`: the one call itself as a
 * CALL, or, for a batch, a MultiSendCallOnly delegatecall of every call in order.
 */
export function safeTransactionRunsCalls(
  tx: { to: Address; value: bigint; data: Hex; operation: number },
  calls: readonly ReviewedSafeCall[],
  batch: boolean,
): boolean {
  const runs = (call: ReviewedSafeCall, to: Address, value: bigint, data: Hex) =>
    isAddressEqual(call.to, to) &&
    BigInt(call.value) === value &&
    call.data.toLowerCase() === data.toLowerCase();
  if (calls.length === 1 && tx.operation === 0 && runs(calls[0]!, tx.to, tx.value, tx.data)) {
    return true;
  }
  if (!batch || tx.value !== 0n) return false;
  const inner = multiSendCallsOf(tx);
  return (
    !!inner &&
    inner.length === calls.length &&
    inner.every((call, index) => runs(calls[index]!, call.to, call.value, call.data))
  );
}

/** What a Safe queue shows on a chain where Safe hosts no transaction service. */
export function queueUnavailableMessage(chainId: number): string {
  return `Safe queue isn't available on ${chainDisplayName(chainId)}.`;
}

/**
 * Throws unless `receipt` proves the Safe transaction `safeTxHash` ran on `safe` and succeeded
 * ({@link requireSafeExecutionSuccess}) without paying a refund. Every transaction this app
 * executes or relays is zero-refund, so a refund in its own event means something else ran.
 */
export function requireRefundFreeSafeExecution(
  receipt: Parameters<typeof safeExecutionResult>[0],
  safe: Address,
  safeTxHash: Hex,
): void {
  requireSafeExecutionSuccess(receipt, safe, safeTxHash);
  const result = safeExecutionResult(receipt, safe, safeTxHash);
  if (result.status === "success" && result.payment !== 0n) {
    throw new Error("The Safe paid a gas refund for this transaction.");
  }
}

/**
 * Settles the journal entry of an `execTransaction` sent as `hash`, whose write left its receipt
 * to the caller: success only when the receipt proves `safeTxHash` succeeded with no refund and
 * `confirm` (the action's own postcondition) passes. Anything else marks it unverified and throws.
 */
export async function confirmSafeExecution({
  client,
  hash,
  safe,
  safeTxHash,
  confirm,
}: {
  client: PublicClient;
  hash: Hex;
  safe: Address;
  safeTxHash: Hex;
  confirm?: (receipt: TransactionReceipt) => Promise<void>;
}): Promise<TransactionReceipt> {
  holdTransactionActivityForVerification(hash, "Confirming the Safe's execution event.");
  try {
    const receipt = await waitForReceiptWithRetry(client, hash);
    requireRefundFreeSafeExecution(receipt, safe, safeTxHash);
    await confirm?.(receipt);
    releaseTransactionActivityVerification(hash, "The Safe's execution was confirmed onchain.");
    return receipt;
  } catch (cause) {
    failTransactionActivityVerification(
      hash,
      "The Safe transaction was submitted, but its result failed verification. Inspect it and do not submit it again yet.",
    );
    throw cause;
  }
}
