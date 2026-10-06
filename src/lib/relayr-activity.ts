import type { TransactionActivity } from "@/lib/transaction-activity";
import { relayrSignedRequests } from "@bananapus/nana-sdk-core/review/relayr";

export function canCheckRelayrBundle(activity: TransactionActivity): boolean {
  return (
    activity.kind === "relayr-bundle" &&
    Boolean(activity.bundleUuid) &&
    activity.relayrPaymentStatus !== "unfunded" &&
    activity.relayrPaymentStatus !== "reverted" &&
    (activity.relayrPaymentStatus === "submitted" ||
      activity.relayrPaymentStatus === "confirmed" ||
      Boolean(activity.hash)) &&
    (activity.status === "submitted" ||
      activity.status === "pending" ||
      activity.status === "failed" ||
      activity.manualVerificationRequired === true)
  );
}

/**
 * The forward requests a Relayr session published, each with the nonce it was
 * signed with when it saved them. Null when one is a raw or Safe call: it has
 * no forwarder nonce to classify, so it never counts as dead.
 */
export function relayrSessionRequests(activity: TransactionActivity) {
  return relayrSignedRequests(
    activity.relayrExpectedTransactions?.map(({ chainId, target, data, value }) => ({
      chain: chainId,
      target,
      data,
      value,
    })),
    activity.relayrNonces,
  );
}

/**
 * A session awaiting its payment whose signatures the account view can check
 * at a finalized block (ruling R114 (e)).
 */
export function canCheckRelayrSignatures(activity: TransactionActivity): boolean {
  return (
    activity.kind === "relayr-bundle" &&
    !activity.relayrDiscardable &&
    (activity.relayrPaymentStatus === "unfunded" || activity.relayrPaymentStatus === "reverted") &&
    !!relayrSessionRequests(activity)
  );
}
