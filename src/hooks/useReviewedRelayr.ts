"use client";

import { formatShortDateTime } from "@/lib/date";
import { releaseBatchRound } from "@/lib/multichain-batch";
import {
  requireRawPayerCall,
  requireRawSafeExecution,
  verifyActionReceipt,
  verifyCallPreconditions,
  type CallPrecondition,
  type ExpectedPayerDeployment,
  type ExpectedSafeExecution,
  type RejectedReceiptEvent,
} from "@/lib/multichain-guards";
import type {
  ChainPayment,
  JBChainId,
  RelayrGetBundleResponse,
  RelayrPostBundleResponse,
} from "@/lib/nana/types";
import { verifyMetadataSource, type MetadataSourceGuard } from "@/lib/project-metadata-write";
import { relayrSessionRequests } from "@/lib/relayr-activity";
import { areRelayrChainsCompatible, isRelayrSupportedChain } from "@/lib/relayr-chains";
import { isSafeConnection } from "@/lib/safe-connector";
import { requireRefundFreeSafeExecution } from "@/lib/safe-transactions";
import {
  dismissTransactionActivity,
  recordTransactionActivity,
  refreshTransactionActivities,
  requireTransactionActivityPersistence,
  transactionActivitySnapshot,
  updateTransactionActivity,
  type RelayrExpectedTransaction,
  type TransactionActivity,
} from "@/lib/transaction-activity";
import { requireTransactionReview } from "@/lib/transaction-review";
import { requireNoViewAs } from "@/lib/view-as";
import { erc2771ForwarderAbi, jbContractAddress, type JBVersion } from "@bananapus/nana-sdk-core";
import { gasWithHeadroom } from "@bananapus/nana-sdk-core/review";
import {
  bindRelayrQuote,
  FORWARD_REQUEST_TYPES,
  isRelayrDiscardReason,
  quoteExpired,
  readRelayrBundle,
  RELAYR_API,
  RELAYR_FORWARDER_DEADLINE_SECONDS,
  RELAYR_PAYMENT_CODE_HASH,
  RELAYR_PAYMENT_GAS,
  relayrBundleRequest,
  relayrDeadlinePassed,
  relayrDestinationHash,
  relayrForwardRequest,
  relayrPaymentDetails,
  RelayrPaymentRevertedError,
  RelayrProofError,
  relayrRequestsDead,
  relayrRequestStates,
  relayrRequestsVerdict,
  relayrSessionOutcome,
  requireRelayrBundleUnpaid,
  requireRelayrPaymentRetry,
  TRUSTED_FORWARDER_ABI,
  verifyRelayrPayment,
  type RelayrBundle,
  type RelayrDiscardReason,
  type RelayrEntry,
  type RelayrRequestsVerdict,
  type RelayrTransactionRecord,
} from "@bananapus/nana-sdk-core/review/relayr";
import type { ExpectedPayoutReceipt, ExpectedReservedReceipt } from "@bananapus/nana-sdk-core/v6";
import { useCallback, useEffect, useState } from "react";
import {
  encodeFunctionData,
  isHash,
  keccak256,
  maxUint256,
  stringToHex,
  type Abi,
  type Address,
  type Hex,
} from "viem";
import { useAccount, useConfig, useSendTransaction, useSignTypedData, useSwitchChain } from "wagmi";
import { getAccount, getPublicClient, waitForTransactionReceipt } from "wagmi/actions";

export type ReviewedRelayrRequest = {
  chainId: JBChainId;
  version?: JBVersion;
  /** Groups a non-idempotent workflow whose retries may change calldata. */
  recoveryScope?: string;
  metadataSource?: MetadataSourceGuard;
  /** "safe-exec" runs a fully signed Safe execTransaction; see requireRawSafeExecution. */
  relayrMode?: "raw" | "forwarded" | "safe-exec";
  /**
   * A parent review already showed this exact raw call, so its duplicate review
   * is skipped. A forwarded call's signature is always reviewed.
   */
  reviewedInParent?: boolean;
  expectedSafeExecution?: ExpectedSafeExecution;
  preconditions?: CallPrecondition[];
  expectedDeployment?: ExpectedPayerDeployment;
  rejectEvents?: RejectedReceiptEvent[];
  reservedReceipt?: ExpectedReservedReceipt;
  expectedPayout?: ExpectedPayoutReceipt;
  data: {
    from: Address;
    to: Address;
    value: bigint;
    gas: bigint;
    data: Hex;
  };
  review?: {
    abi?: Abi;
    functionName?: string;
    args?: readonly unknown[];
    label?: string;
    contractName?: string;
  };
};

type RememberedQuote = {
  bundleUuid: string;
  account: Address;
  callKey: string;
  callKeys: string[];
  chainIds: number[];
  payments: ChainPayment[];
  expectedTransactions: RelayrExpectedTransaction[];
};

const quotes = new Map<string, RememberedQuote>();
const bundleInflight = new Map<string, Promise<RelayrGetBundleResponse>>();
const paymentInflight = new Set<string>();
const fundedBundles = new Set<string>();
const bundleListeners = new Map<string, Set<(bundle: RelayrGetBundleResponse) => void>>();
const authorizingAccounts = new Set<string>();

async function withAuthorizationLock<T>(account: Address, action: () => Promise<T>): Promise<T> {
  const key = account.toLowerCase();
  if (authorizingAccounts.has(key))
    throw new Error("Another Relayr authorization is being prepared for this account.");
  authorizingAccounts.add(key);
  try {
    return await (typeof navigator !== "undefined" && navigator.locks
      ? navigator.locks.request(
          `revnet:relayr-authorizations:${key}`,
          { ifAvailable: true },
          (lock) => {
            if (!lock)
              throw new Error(
                "Another browser tab is preparing Relayr authorizations for this account.",
              );
            return action();
          },
        )
      : action());
  } finally {
    authorizingAccounts.delete(key);
  }
}

function paymentKey(payment: ChainPayment): string {
  return `${payment.chain}:${payment.target.toLowerCase()}:${payment.amount}:${payment.calldata.toLowerCase()}:${payment.token.toLowerCase()}:${payment.payment_deadline}`;
}

function rememberQuote(
  quote: RelayrPostBundleResponse,
  account: Address,
  callKey: string,
  callKeys: string[],
  expectedTransactions: RelayrExpectedTransaction[],
): void {
  const remembered = {
    bundleUuid: quote.bundle_uuid,
    account,
    callKey,
    callKeys,
    chainIds: expectedTransactions.map((transaction) => transaction.chainId),
    payments: quote.payment_info.map((payment) => ({ ...payment })),
    expectedTransactions,
  };
  quote.payment_info.forEach((payment) => quotes.set(paymentKey(payment), remembered));
}

function requestKey(account: Address, requests: ReviewedRelayrRequest[]): string {
  const calls = requests
    .map(
      (request) =>
        `${request.chainId}:${request.version ?? 6}:${request.data.to.toLowerCase()}:${request.data.value}:${request.data.data.toLowerCase()}`,
    )
    .sort();
  return `${account.toLowerCase()}:relayr:${keccak256(stringToHex(calls.join("|")))}`;
}

function scopeKey(account: Address, scope: string): string {
  return `${account.toLowerCase()}:relayr-scope:${scope}`;
}

const EXPIRED_QUOTE = "This Relayr quote expired. Review the action again for a new quote.";
const UNCHECKED = "Couldn't check the revnet. Try again.";
const FUNDED_ELSEWHERE =
  "Another payment funded this Relayr quote. Check again once its calls have run; do not pay again.";
const REPLACED_UNPAID = "This unpaid Relayr quote was replaced by a new one. Nothing was paid.";
const REPLACED = "A new quote replaced this one. Pay only the new quote.";
/** A quote whose latest payment reverted: only the SDK's retry rule lets it be paid again. */
const PAYMENT_REVERTED = {
  status: "failed",
  relayrPaymentStatus: "reverted",
  manualVerificationRequired: true,
  message:
    "The original Relayr funding transaction reverted onchain. Its destination authorizations remain reserved; retry only the exact saved quote.",
} as const;

/**
 * The line a session shows while one of its old requests can still run: until
 * `until` (seconds), or, once the clock is past it, until a finalized block is.
 */
function relayrHeldMessage(until: number, nowMs = Date.now()): string {
  return until * 1_000 > nowMs
    ? `This action's earlier signature can still run until ${formatShortDateTime(until * 1_000)}. Try again after that.`
    : "This action's earlier signature may still run. Try again in a few minutes.";
}

const RELAYR_DISCARD_LINES: Record<RelayrDiscardReason, string> = {
  ran: "This action's earlier signature may already have run. Check the revnet, then discard it in account activity.",
  changed: "The revnet changed since this review.",
  expired: "This action's earlier signatures expired without running.",
};

/** A saved session none of whose requests can run again: Discard ends it. `cause` is why its calls were not proven. */
class RelayrDiscardError extends Error {
  constructor(
    readonly activityId: string,
    readonly reason: RelayrDiscardReason,
    cause?: unknown,
  ) {
    super(RELAYR_DISCARD_LINES[reason], cause === undefined ? undefined : { cause });
    this.name = "RelayrDiscardError";
  }
}

/** Every saved session is read with the app's public client for its chain. */
function clientFor(config: Config) {
  return (chainId: number) => getPublicClient(config, { chainId: chainId as JBChainId });
}

/**
 * Ruling R114 for a saved session: each request it published at a canonical
 * finalized block on its chain, with the nonce it saved. Null when one of
 * them is not a forward request.
 */
async function savedRequestsVerdict(
  config: Config,
  activity: TransactionActivity,
): Promise<RelayrRequestsVerdict | null> {
  const requests = relayrSessionRequests(activity);
  return requests && relayrRequestsVerdict(await relayrRequestStates(clientFor(config), requests));
}

/** Mark a session for Discard (ruling R114), and the error its action throws until it is discarded. */
function discardableSession(
  activity: TransactionActivity,
  reason: RelayrDiscardReason,
  cause?: unknown,
): RelayrDiscardError {
  updateTransactionActivity(activity.id, {
    status: "failed",
    manualVerificationRequired: true,
    relayrDiscardable: reason,
    message: RELAYR_DISCARD_LINES[reason],
  });
  return new RelayrDiscardError(activity.id, reason, cause);
}

/**
 * Whether a session no longer reserves anything: its quote was proven
 * unfundable onchain or replaced at the same forwarder nonces ("expired"), or
 * every request it published is dead and none ran. One that may have run
 * keeps its calls until it is discarded.
 */
function sessionReleased(activity: TransactionActivity): boolean {
  return (
    activity.relayrPaymentStatus === "expired" ||
    activity.relayrDiscardable === "expired" ||
    activity.relayrDiscardable === "changed"
  );
}

/** The quote a session can still be paid with, by the clock, or undefined. */
function payableQuote(
  activity: TransactionActivity,
  destinationChains: number[],
): RelayrPostBundleResponse | undefined {
  if (!activity.relayrQuote) return undefined;
  try {
    return quoteForDestinationChains(activity.relayrQuote, destinationChains);
  } catch {
    return undefined;
  }
}

/** Every option of a session's quote that relayrPaymentDetails accepts, expired or not. */
function quotedOptions(activity: TransactionActivity) {
  const quote = activity.relayrQuote;
  const destinationChainIds =
    activity.relayrExpectedTransactions?.map((transaction) => transaction.chainId) ?? [];
  return (Array.isArray(quote?.payment_info) ? quote.payment_info : []).flatMap((option) => {
    try {
      return [
        relayrPaymentDetails(option, {
          bundleUuid: quote!.bundle_uuid,
          destinationChainIds,
          nowSeconds: 0,
        }),
      ];
    } catch {
      return [];
    }
  });
}

/**
 * Whether every deadline of these payments has passed at a canonical
 * finalized block on its chain. False while one is unknown.
 */
async function deadlinesPassed(
  config: Config,
  payments: { chainId: number; deadline: bigint }[],
): Promise<boolean> {
  for (const { chainId, deadline } of payments) {
    const client = clientFor(config)(chainId);
    if (!client || !(await relayrDeadlinePassed(client, deadline))) return false;
  }
  return payments.length > 0;
}

/**
 * A raw or Safe bundle has no forwarder nonce. An unpaid one can run only if
 * its quote is paid, so it stops reserving once the deadline of every option
 * of its quote passed at a canonical finalized block, never by the clock.
 */
async function releaseUnfundableQuote(
  config: Config,
  activity: TransactionActivity,
): Promise<boolean> {
  if (activity.relayrPaymentStatus !== "unfunded" || sentPayments(activity).length) return false;
  if (!(await deadlinesPassed(config, quotedOptions(activity)))) return false;
  updateTransactionActivity(activity.id, {
    status: "failed",
    relayrPaymentStatus: "expired",
    message:
      "This unpaid Relayr quote expired. Nothing was paid; review the action again for a new quote.",
  });
  forgetQuote(activity.bundleUuid);
  return true;
}

/** A paid bundle whose calls are still being proven: it reserves them until they are proven or fail. */
function paidInFlight(activity: TransactionActivity): boolean {
  return (
    (activity.relayrPaymentStatus === "submitted" ||
      activity.relayrPaymentStatus === "confirmed") &&
    activity.status !== "failed"
  );
}

/**
 * Ruling R114 for another saved session that shares a call or a recovery
 * scope with an action about to sign (R114 (g)): different calls never sign
 * at its nonces while one of its requests can still run. A live session
 * holds the action, saying until when, and a paid bundle still running keeps
 * its own refusal. Once every request is dead, whatever Relayr reports, the
 * session reserves nothing more and is marked for Discard, and one that may
 * have run refuses the action with its line until it is discarded
 * (R114 (f)). Resolves "reserved" while it can't be classified.
 */
async function reservationOf(
  config: Config,
  activity: TransactionActivity,
): Promise<"released" | "reserved"> {
  if (activity.relayrDiscardable === "ran") throw new RelayrDiscardError(activity.id, "ran");
  const verdict = await savedRequestsVerdict(config, activity);
  if (!verdict) return (await releaseUnfundableQuote(config, activity)) ? "released" : "reserved";
  if (verdict.live) {
    if (paidInFlight(activity)) return "reserved";
    throw new Error(relayrHeldMessage(verdict.until));
  }
  const outcome = await relayrSessionOutcome(verdict, { nonces: activity.relayrNonces });
  if (outcome.kind !== "discard") throw new Error(relayrHeldMessage(0));
  const discard = discardableSession(activity, outcome.reason);
  if (outcome.reason === "ran") throw discard;
  return "released";
}

/**
 * The saved nonce each chain's request of `session` was signed with. Throws,
 * holding, when one can't be read.
 */
function savedNonces(session: TransactionActivity): Map<number, bigint> {
  const nonces = new Map<number, bigint>();
  session.relayrExpectedTransactions?.forEach(({ chainId }, index) => {
    const saved = session.relayrNonces?.[index];
    if (!saved || !/^\d+$/.test(saved)) throw new Error(relayrHeldMessage(0));
    nonces.set(chainId, BigInt(saved));
  });
  return nonces;
}

/** Stop offering a session's quote for payment. */
function forgetQuote(bundleUuid: string | undefined): void {
  if (!bundleUuid) return;
  for (const [key, quote] of quotes)
    if (quote.bundleUuid.toLowerCase() === bundleUuid.toLowerCase()) quotes.delete(key);
}

/**
 * A new publication carries these sessions' calls: their published
 * signatures under a new quote, or new signatures at their saved nonces once
 * every request they published is dead. They are never paid from here, and
 * the new session reserves what they did.
 */
function supersede(sessions: TransactionActivity[]): void {
  for (const session of sessions) {
    updateTransactionActivity(session.id, {
      status: "failed",
      relayrPaymentStatus: "expired",
      manualVerificationRequired: false,
      message: sentPayments(session).length ? REPLACED : REPLACED_UNPAID,
    });
    forgetQuote(session.bundleUuid);
  }
}

/**
 * A changed payload or direct route must not bypass a published operation
 * (rulings R114 (g) and R117): a session in `scope` reserves it while one of
 * its requests can still run, saying until when, and one that may have run
 * until it is discarded.
 */
export async function requireRelayrRecoveryScopeAvailable(
  account: Address,
  scope: string,
): Promise<void> {
  requireTransactionActivityPersistence();
  const key = scopeKey(account, scope);
  const reserving = refreshTransactionActivities().filter(
    (activity) =>
      activity.relayrCallKeys?.includes(key) &&
      (activity.status !== "success" || activity.manualVerificationRequired) &&
      !sessionReleased(activity),
  );
  if (!reserving.length) return;
  const { wagmiConfig } = await import("@/lib/wagmiConfig");
  for (const activity of reserving) {
    if ((await reservationOf(wagmiConfig, activity)) === "reserved")
      throw new Error(
        scope === "revnet-launch"
          ? "A previous Relayr launch still requires reconciliation. Check its existing bundle in account activity before requesting another launch; do not sign or pay again."
          : "A previous Relayr update for this destination still requires reconciliation. Check its existing bundle in account activity before submitting another update; do not sign or pay again.",
      );
  }
}

function forwarderNonceKey(key: string): boolean {
  return key.includes(":relayr-scope:forwarder-nonce:");
}

/**
 * No other saved session may run, or may have run, what this quote runs
 * (rulings R114 and R117). One that shares only a forwarder nonce reserves it
 * while one of its requests can still run (relayrRequestsDead); one that
 * shares a call or a recovery scope is classified by reservationOf. `exempt`
 * names the session this action continues.
 */
async function requireUnfunded(
  config: Config,
  quote: Pick<RememberedQuote, "bundleUuid" | "callKey" | "callKeys">,
  exempt?: string,
): Promise<void> {
  requireTransactionActivityPersistence();
  if (fundedBundles.has(quote.bundleUuid))
    throw new Error(
      "This Relayr action already has a submitted payment. Do not pay again; check the existing bundle.",
    );
  const activities = refreshTransactionActivities();
  // A quote that expired, was replaced or was marked for Discard is never paid.
  if (
    activities.some(
      (activity) =>
        activity.bundleUuid === quote.bundleUuid &&
        (activity.relayrPaymentStatus === "expired" ||
          isRelayrDiscardReason(activity.relayrDiscardable)),
    )
  )
    throw new Error(EXPIRED_QUOTE);
  for (const existing of activities) {
    const shared = existing.relayrCallKeys?.filter((key) => quote.callKeys.includes(key)) ?? [];
    if (
      existing.id === exempt ||
      !(
        existing.bundleUuid === quote.bundleUuid ||
        ((existing.callKey === quote.callKey || shared.length) && existing.status !== "success")
      ) ||
      (existing.bundleUuid === quote.bundleUuid && existing.relayrPaymentStatus === "unfunded") ||
      (existing.bundleUuid === quote.bundleUuid && existing.relayrPaymentStatus === "reverted") ||
      sessionReleased(existing)
    )
      continue;
    const nonceOnly =
      existing.bundleUuid !== quote.bundleUuid &&
      existing.callKey !== quote.callKey &&
      shared.every(forwarderNonceKey);
    if (nonceOnly) {
      if (existing.relayrDiscardable === "ran") continue;
      if (await relayrRequestsDead(clientFor(config), relayrSessionRequests(existing))) continue;
    } else if (
      existing.bundleUuid !== quote.bundleUuid &&
      (await reservationOf(config, existing)) === "released"
    )
      continue;
    throw new Error(
      `This Relayr action already has ${existing.relayrPaymentStatus === "unfunded" ? "published authorizations" : "a submitted payment"}${existing.hash ? ` (${existing.hash})` : existing.relayrPaymentStatus === "unfunded" ? " awaiting reconciliation" : " with an uncertain wallet result"}. Do not authorize or pay again; check the existing bundle.`,
    );
  }
}

/**
 * Sessions saved before the nonce scope keys reserve their signer's forwarder
 * nonce through their exact outer targets. Each reserves it while one of its
 * requests can still run (ruling R117).
 */
async function requireForwarderNoncesFree(
  config: Config,
  account: Address,
  forwarded: ReviewedRelayrRequest[],
  exempt: string[],
): Promise<void> {
  for (const activity of refreshTransactionActivities()) {
    if (
      exempt.includes(activity.id) ||
      activity.account?.toLowerCase() !== account.toLowerCase() ||
      !(activity.status !== "success" || activity.manualVerificationRequired) ||
      sessionReleased(activity) ||
      activity.relayrDiscardable === "ran" ||
      !activity.relayrExpectedTransactions?.some((expected) =>
        forwarded.some(
          (request) =>
            request.chainId === expected.chainId &&
            expected.target.toLowerCase() ===
              jbContractAddress[request.version ?? 6].ERC2771Forwarder[
                request.chainId
              ]?.toLowerCase(),
        ),
      )
    )
      continue;
    if (await relayrRequestsDead(clientFor(config), relayrSessionRequests(activity))) continue;
    throw new Error(
      "This signer and destination forwarder already has published authorizations awaiting reconciliation. Complete the original bundle before authorizing a different operation.",
    );
  }
}

/** Each forwarded request with the client and forwarder of its chain. */
function forwardedTargets(config: Config, requests: ReviewedRelayrRequest[]) {
  return requests
    .filter((request) => request.relayrMode !== "raw" && request.relayrMode !== "safe-exec")
    .map((request) => {
      const client = getPublicClient(config, { chainId: request.chainId });
      const forwarder = jbContractAddress[request.version ?? 6].ERC2771Forwarder[request.chainId];
      if (!client || !forwarder)
        throw new Error(`Relayr is unavailable on chain ${request.chainId}.`);
      return { request, client, forwarder };
    });
}

/**
 * The action's own proof that its calls still apply (ruling R114): each
 * destination's reviewed source and preconditions, and each call run from the
 * forwarder with the signer appended, against live state. Throws when one no
 * longer applies.
 */
async function recheck(
  targets: ReturnType<typeof forwardedTargets>,
  account: Address,
): Promise<void> {
  for (const { request, client, forwarder } of targets) {
    if (request.metadataSource) await verifyMetadataSource(client, request.metadataSource, account);
    await verifyCallPreconditions(client, request.preconditions);
    await simulateForwardedCall(client, forwarder, account, request);
  }
}

/**
 * A live session's saved signatures can be quoted again (jbm
 * verifyForwardedEntries, relayr.ts:837-857): each is this account's forward
 * request for its value, its deadline is more than two minutes away, the
 * action's recheck passes, and the exact signed outer call runs.
 */
async function requireSavedSignaturesRun(
  config: Config,
  account: Address,
  saved: TransactionActivity,
  requests: ReviewedRelayrRequest[],
): Promise<void> {
  const now = Math.floor(Date.now() / 1_000);
  for (const transaction of saved.relayrExpectedTransactions ?? []) {
    const request = relayrForwardRequest({
      chain: transaction.chainId,
      target: transaction.target,
      data: transaction.data,
    });
    if (
      !request ||
      request.from.toLowerCase() !== account.toLowerCase() ||
      request.value !== BigInt(transaction.value) ||
      request.deadline <= now + 120
    )
      throw new Error("The saved Relayr authorization can't be quoted again.");
  }
  await recheck(forwardedTargets(config, requests), account);
  await revalidateSignedCalls(config, account, saved.relayrExpectedTransactions ?? []);
}

/** Relayr reports a payment for the bundle, or a call running or run. */
function relayrBundleFunded(bundle: RelayrBundle): boolean {
  const records = Array.isArray(bundle.transactions)
    ? (bundle.transactions as RelayrTransactionRecord[])
    : [];
  return (
    bundle.payment_received === true ||
    records.some(
      (record) =>
        relayrDestinationHash(record) !== null ||
        typeof record?.status?.state !== "string" ||
        record.status.state.trim().toLowerCase() !== "pending",
    )
  );
}

/**
 * Nothing can fund the quote any more (ruling R104): every payment it sent is
 * proven canonically reverted, and the deadline of each of those payments and
 * of every option of its quote passed at a canonical finalized block.
 */
async function quoteUnfundable(
  config: Config,
  activity: TransactionActivity,
  options: ReturnType<typeof quotedOptions>,
): Promise<boolean> {
  const sent = sentPayments(activity);
  if (!sent.length || !activity.account || !activity.bundleUuid) return false;
  const deadlines = new Map<string, { chainId: number; deadline: bigint }>();
  for (const payment of sent) {
    const client = clientFor(config)(payment.chainId);
    const option = options.find(
      ({ chainId, calldata }) =>
        chainId === payment.chainId && calldata === payment.data.toLowerCase(),
    );
    if (!client || !option) return false;
    try {
      await verifyRelayrPayment(client, {
        hash: payment.hash,
        from: activity.account,
        payment: {
          chainId: payment.chainId,
          target: payment.target,
          calldata: payment.data,
          amount: payment.value,
          bundleUuid: activity.bundleUuid,
        },
      });
      return false;
    } catch (error) {
      if (!(error instanceof RelayrPaymentRevertedError)) return false;
    }
    deadlines.set(`${option.chainId}:${option.deadline}`, option);
  }
  for (const option of options) deadlines.set(`${option.chainId}:${option.deadline}`, option);
  return deadlinesPassed(config, [...deadlines.values()]);
}

/**
 * What a quote whose own payments reverted allows, from one read of its
 * bundle (ruling R104, as jbm's revertedRelayrQuote, relayr.ts:1544-1573):
 * "funded" when Relayr reports a payment or a call running or run, so another
 * payment funded it and it is never paid again; "payable" while the quote of
 * its latest payment is open, for the SDK's retry rule; "released" once
 * nothing can fund it and Relayr, read once more right before, reports it
 * unpaid with every call pending. Throws while an expired quote's release is
 * unproven.
 */
async function revertedRelayrQuote(
  config: Config,
  activity: TransactionActivity,
): Promise<"funded" | "payable" | "released"> {
  const bundleUuid = activity.bundleUuid ?? "";
  const bundle = await readRelayrBundle(bundleUuid).catch(() => null);
  if (bundle && relayrBundleFunded(bundle)) return "funded";
  const options = quotedOptions(activity);
  const latest = sentPayments(activity).at(-1);
  const latestOption = options.find(
    ({ chainId, calldata }) =>
      chainId === latest?.chainId && calldata === latest.data.toLowerCase(),
  );
  if (latestOption && !quoteExpired(latestOption.deadline)) return "payable";
  if (
    bundle &&
    (await quoteUnfundable(config, activity, options)) &&
    (await requireRelayrBundleUnpaid(bundleUuid).then(
      () => true,
      () => false,
    ))
  )
    return "released";
  throw new Error(
    "This Relayr quote expired after its payment reverted. A new quote needs its deadline final onchain and Relayr to report nothing ran; try again in a few minutes.",
  );
}

/** How an action goes on from its own saved session. */
type Continuation =
  /** Pay the saved quote. */
  | { kind: "quote"; quote: RelayrPostBundleResponse }
  /** Quote the saved signatures again. */
  | { kind: "requote" }
  /** Sign the calls again at the saved nonces. */
  | { kind: "sign" }
  /** A raw or Safe bundle whose quote can no longer be paid: quote the calls anew. */
  | { kind: "fresh" };

/**
 * Ruling R114 for an action's own saved session (as jbm's executeRelayrCalls,
 * relayr.ts:1867-1953): its requests are classified at a canonical finalized
 * block before the action's recheck, since a request that ran would make the
 * recheck refuse. While one can still run, the session holds when one may
 * have run, and otherwise pays its saved quote or quotes its saved signatures
 * again once they still run. A quote whose payment reverted is first read
 * for another payer (R104). Once every request is dead, relayrSessionOutcome
 * decides: sign the calls again at the saved nonces after the recheck passes,
 * Discard, or hold. Null while a paid bundle can still run, which the
 * reservation checks refuse.
 */
async function continueSession(
  config: Config,
  account: Address,
  saved: TransactionActivity,
  requests: ReviewedRelayrRequest[],
  chains: number[],
): Promise<Continuation | null> {
  const verdict = await savedRequestsVerdict(config, saved);
  // A paid bundle still running is the reservation checks' to refuse while one of
  // its requests can still run; once every one is dead, Relayr's state no longer
  // matters (R114 (c)).
  if (paidInFlight(saved) && verdict?.live !== false) return null;
  let released = false;
  if (saved.relayrPaymentStatus === "reverted" && verdict?.live !== false) {
    let state: Awaited<ReturnType<typeof revertedRelayrQuote>>;
    try {
      state = await revertedRelayrQuote(config, saved);
    } catch (error) {
      // Its release is unproven while an old request can still run: it holds, saying until when.
      throw verdict?.live ? new Error(relayrHeldMessage(verdict.until), { cause: error }) : error;
    }
    if (state === "funded") {
      // What Relayr ran is proven from the chain; the quote is never paid again.
      void waitForRelayrBundle(saved.bundleUuid!).catch(() => undefined);
      throw new Error(FUNDED_ELSEWHERE);
    }
    if (state === "payable") {
      const quote = payableQuote(saved, chains);
      if (!quote) throw new Error(EXPIRED_QUOTE);
      return { kind: "quote", quote };
    }
    released = true;
  } else if (saved.relayrPaymentStatus !== "unfunded" && verdict?.live !== false) {
    // A paid bundle whose calls are not proven, or a quote the device clock
    // expired before sessions saved their nonces, holds while one can still run.
    if (verdict?.live) throw new Error(relayrHeldMessage(verdict.until));
    return null;
  }
  const quote = !released && payableQuote(saved, chains);
  if (!verdict) {
    if (quote) return { kind: "quote", quote };
    return released || (await releaseUnfundableQuote(config, saved)) ? { kind: "fresh" } : null;
  }
  if (verdict.live) {
    if (verdict.mayHaveRun) throw new Error(relayrHeldMessage(verdict.until));
    if (quote) return { kind: "quote", quote };
    try {
      await requireSavedSignaturesRun(config, account, saved, requests);
    } catch (error) {
      throw new Error(relayrHeldMessage(verdict.until), { cause: error });
    }
    return { kind: "requote" };
  }
  // Every request is dead, so none can run again whatever Relayr reports.
  const targets = forwardedTargets(config, requests);
  const outcome = await relayrSessionOutcome(verdict, {
    nonces: saved.relayrNonces,
    recheck: () => recheck(targets, account),
  });
  if (outcome.kind === "re-sign") return { kind: "sign" };
  if (outcome.kind === "discard") throw discardableSession(saved, outcome.reason, outcome.error);
  if (outcome.kind === "unchecked") throw new Error(UNCHECKED, { cause: outcome.error });
  throw new Error(relayrHeldMessage(0));
}

/**
 * An action's saved session: the newest one for exactly its calls that is not
 * settled. A quote the device clock expired before sessions saved their
 * nonces is one while it has forward requests: they may still run, or may
 * have run, so its calls are never signed again at the live nonce.
 */
function savedSessionOf(account: Address, callKey: string): TransactionActivity | undefined {
  const saved = refreshTransactionActivities()
    .filter(
      (activity) =>
        activity.kind === "relayr-bundle" &&
        activity.callKey === callKey &&
        activity.account?.toLowerCase() === account.toLowerCase() &&
        !!activity.relayrExpectedTransactions?.length &&
        (activity.status !== "success" || activity.manualVerificationRequired),
    )
    .sort((a, b) => b.createdAt - a.createdAt)[0];
  return saved?.relayrPaymentStatus === "expired" &&
    (saved.relayrNonces || !relayrSessionRequests(saved))
    ? undefined
    : saved;
}

/**
 * The account view's check of a saved session that awaits its payment
 * (ruling R114 (e)): its requests are classified at a canonical finalized
 * block with no recheck, since only its action can run one. Once every one
 * is dead it is marked for Discard, as "expired" when none ran (its action
 * still signs them again at their saved nonces); while one can still run it
 * says until when.
 */
export async function checkRelayrSession(id: string): Promise<void> {
  const activity = refreshTransactionActivities().find((row) => row.id === id);
  if (!activity) return;
  const { wagmiConfig } = await import("@/lib/wagmiConfig");
  const verdict = await savedRequestsVerdict(wagmiConfig, activity);
  if (!verdict) return;
  const outcome = await relayrSessionOutcome(verdict, { nonces: activity.relayrNonces });
  if (outcome.kind === "discard") discardableSession(activity, outcome.reason);
  // A paid bundle still running keeps its own line while a request can run.
  else if (
    !paidInFlight(activity) &&
    (outcome.kind === "hold" || outcome.kind === "refresh" || outcome.kind === "reorg-hold")
  )
    updateTransactionActivity(id, {
      message: relayrHeldMessage(outcome.kind === "reorg-hold" ? 0 : outcome.until),
    });
}

/**
 * Discard a session marked for it (ruling R114): every request it published
 * is dead. Only the session goes, never what its action saved. After a "ran"
 * Discard, a pending batch with its calls is abandoned, so they go out again
 * only after a fresh review (R114 (f)); after another, its round quotes again.
 */
export function discardRelayrSession(id: string): void {
  requireTransactionActivityPersistence();
  const activity = refreshTransactionActivities().find((row) => row.id === id);
  if (!activity || !isRelayrDiscardReason(activity.relayrDiscardable))
    throw new Error("Only an action whose earlier signatures can no longer run can be discarded.");
  if (activity.bundleUuid)
    for (const batchId of releaseBatchRound(
      activity.bundleUuid,
      activity.relayrDiscardable === "ran",
    ))
      updateTransactionActivity(batchId, {
        status: "failed",
        manualVerificationRequired: false,
        message: "This batch was discarded. Review it again.",
      });
  forgetQuote(activity.bundleUuid);
  dismissTransactionActivity(id);
}

/**
 * Ruling R114 for a paid bundle whose calls are not proven (as jbm's
 * holdUnprovenSession, relayr.ts:1470-1480): it keeps reserving them while a
 * request can still run, and once every one is dead it is marked for Discard,
 * as "expired" when none ran (a forwarder execute that reverts leaves its
 * nonce unused, so its action signs it again) and "ran" when one may have.
 */
async function holdUnprovenSession(activityId: string): Promise<void> {
  const activity = refreshTransactionActivities().find((row) => row.id === activityId);
  if (!activity || activity.relayrPaymentStatus === "reverted") return;
  const { wagmiConfig } = await import("@/lib/wagmiConfig");
  const verdict = await savedRequestsVerdict(wagmiConfig, activity);
  if (verdict?.live !== false) return;
  const outcome = await relayrSessionOutcome(verdict, { nonces: activity.relayrNonces });
  if (outcome.kind === "discard") discardableSession(activity, outcome.reason);
}

type SentPayment = NonNullable<TransactionActivity["relayrPayments"]>[number];

/** Every payment broadcast for a bundle. A row that lists none names its one payment by `hash`. */
function sentPayments(activity: TransactionActivity | undefined): SentPayment[] {
  if (activity?.relayrPayments?.length) return activity.relayrPayments;
  return activity?.hash && activity.relayrPayment && activity.chainId
    ? [{ hash: activity.hash, chainId: activity.chainId, ...activity.relayrPayment }]
    : [];
}

/**
 * A bundle that was paid before is paid again only on the SDK's rule: every
 * payment sent for it canonically reverted, its quote is still open, and
 * Relayr, read without a cache, reports it unpaid with every call pending.
 */
async function requirePaymentRetry(
  config: ReturnType<typeof useConfig>,
  account: Address,
  bundleUuid: string,
  sent: SentPayment[],
): Promise<void> {
  const byPayment = new Map<string, { payment: SentPayment; hashes: Hex[] }>();
  for (const sentPayment of sent) {
    const key = `${sentPayment.chainId}:${sentPayment.target.toLowerCase()}:${sentPayment.data.toLowerCase()}:${sentPayment.value}`;
    const group = byPayment.get(key) ?? { payment: sentPayment, hashes: [] };
    group.hashes.push(sentPayment.hash);
    byPayment.set(key, group);
  }
  for (const { payment, hashes } of byPayment.values()) {
    const client = getPublicClient(config, { chainId: payment.chainId as JBChainId });
    if (!client)
      throw new Error("The funding RPC is unavailable. Do not pay again; check this bundle later.");
    await requireRelayrPaymentRetry(client, {
      hashes,
      from: account,
      payment: {
        chainId: payment.chainId,
        target: payment.target,
        calldata: payment.data,
        amount: payment.value,
        bundleUuid,
      },
    });
  }
}

function quoteForDestinationChains(
  quote: RelayrPostBundleResponse,
  destinationChains: number[],
): RelayrPostBundleResponse {
  const payments = quote.payment_info.filter((payment) =>
    areRelayrChainsCompatible([...destinationChains, payment.chain]),
  );
  if (!payments.length)
    throw new Error(
      "Relayr returned no funding option for the selected mainnet or testnet family.",
    );
  payments.forEach((payment) =>
    relayrPaymentDetails(payment, {
      bundleUuid: quote.bundle_uuid,
      destinationChainIds: destinationChains,
    }),
  );
  // Recovery quotes must not share nested payment objects with caller-owned
  // responses. A later UI update cannot rewrite the already published fee.
  return structuredClone({ ...quote, payment_info: payments });
}

type Config = ReturnType<typeof useConfig>;

/**
 * The destination trusts the forwarder, and its call runs from the forwarder
 * with `account` appended as ERC-2771's sender against live state.
 */
async function simulateForwardedCall(
  client: NonNullable<ReturnType<typeof getPublicClient>>,
  forwarder: Address,
  account: Address,
  request: ReviewedRelayrRequest,
): Promise<void> {
  const trusted = await client.readContract({
    address: request.data.to,
    abi: TRUSTED_FORWARDER_ABI,
    functionName: "isTrustedForwarder",
    args: [forwarder],
  });
  if (trusted !== true)
    throw new Error(
      "The destination contract does not trust this forwarder. Use a direct transaction.",
    );
  await client.call({
    account: forwarder,
    stateOverride: [{ address: forwarder, balance: maxUint256 }],
    to: request.data.to,
    value: request.data.value,
    data: `${request.data.data}${account.slice(2).toLowerCase()}` as Hex,
  });
}

/**
 * Re-run the exact signed outer calls against live state, so consumed nonces,
 * expired signatures, changed permissions and destination reverts are refused.
 */
async function revalidateSignedCalls(
  config: Config,
  account: Address,
  expectedTransactions: RelayrExpectedTransaction[],
): Promise<void> {
  for (const expected of expectedTransactions) {
    const client = getPublicClient(config, { chainId: expected.chainId as JBChainId });
    if (!client || !expected.gas)
      throw new Error("The signed destination call cannot be revalidated. Do not pay this quote.");
    if (expected.metadataSource)
      await verifyMetadataSource(client, expected.metadataSource, account);
    await verifyCallPreconditions(client, expected.preconditions);
    await client.call({
      account,
      to: expected.target,
      data: expected.data,
      value: BigInt(expected.value),
      gas: BigInt(expected.gas),
      stateOverride: [{ address: account, balance: maxUint256 }],
    });
  }
}

class RelayrVerificationError extends Error {}

function expectedBundleTransactions(bundleUuid: string): RelayrExpectedTransaction[] {
  const expected = transactionActivitySnapshot().find(
    (activity) => activity.bundleUuid === bundleUuid,
  )?.relayrExpectedTransactions;
  if (!expected?.length || new Set(expected.map((item) => item.chainId)).size !== expected.length)
    throw new RelayrVerificationError(
      "The signed destination calls for this bundle are unavailable. Its execution cannot be verified; do not pay again.",
    );
  return expected;
}

function verifyBundleIdentity(
  bundleUuid: string,
  bundle: RelayrGetBundleResponse,
  expected: RelayrExpectedTransaction[],
): void {
  if (
    typeof bundle.bundle_uuid !== "string" ||
    bundle.bundle_uuid.toLowerCase() !== bundleUuid.toLowerCase() ||
    !Array.isArray(bundle.transactions) ||
    bundle.transactions.length !== expected.length
  )
    throw new RelayrVerificationError(
      "Relayr's response does not match the signed bundle and destination count. Do not pay again.",
    );
  // Relayr lists tx_uuids out of request order, so a record is bound by its
  // exact request; its ID only has to be one this quote issued, used once.
  const quotedIds = new Set(expected.map((item) => item.transactionUuid));
  const seenIds = new Set<string>();
  const seen = new Set<number>();
  for (const transaction of bundle.transactions) {
    const request = transaction.request;
    const identity = expected.find((item) => item.chainId === request?.chain);
    let value: bigint | undefined;
    try {
      value = BigInt(request?.value);
    } catch {
      /* Invalid API data fails identity verification below. */
    }
    if (
      !identity ||
      seen.has(request.chain) ||
      !quotedIds.has(transaction.tx_uuid) ||
      seenIds.has(transaction.tx_uuid) ||
      request.target?.toLowerCase() !== identity.target.toLowerCase() ||
      request.data?.toLowerCase() !== identity.data.toLowerCase() ||
      value !== BigInt(identity.value)
    )
      throw new RelayrVerificationError(
        "Relayr's destination call does not match the signed request. Do not pay again.",
      );
    seen.add(request.chain);
    seenIds.add(transaction.tx_uuid);
  }
}

async function verifyDestinationReceipts(
  bundle: RelayrGetBundleResponse,
  expected: RelayrExpectedTransaction[],
): Promise<void> {
  const { wagmiConfig } = await import("@/lib/wagmiConfig");
  for (const transaction of bundle.transactions) {
    const hash = relayrDestinationHash(transaction);
    if (!hash)
      throw new RelayrVerificationError(
        "Relayr reported completion without a destination transaction hash. Do not pay again.",
      );
    const identity = expected.find((item) => item.chainId === transaction.request.chain)!;
    const client = getPublicClient(wagmiConfig, { chainId: identity.chainId as JBChainId });
    if (!client) throw new Error("The destination RPC is unavailable.");
    const [onchain, receipt] = await Promise.all([
      client.getTransaction({ hash }),
      client.getTransactionReceipt({ hash }),
    ]);
    if (
      onchain.hash.toLowerCase() !== hash.toLowerCase() ||
      receipt.transactionHash.toLowerCase() !== hash.toLowerCase() ||
      onchain.to?.toLowerCase() !== identity.target.toLowerCase() ||
      onchain.input.toLowerCase() !== identity.data.toLowerCase() ||
      onchain.value !== BigInt(identity.value) ||
      receipt.to?.toLowerCase() !== identity.target.toLowerCase() ||
      onchain.blockHash !== receipt.blockHash ||
      onchain.blockNumber !== receipt.blockNumber
    )
      throw new RelayrVerificationError(
        "The onchain destination transaction does not match the signed request. Do not pay again.",
      );
    const block = await client.getBlock({ blockNumber: receipt.blockNumber });
    if (block.hash !== receipt.blockHash)
      throw new Error("Destination receipt is not in the current canonical chain.");
    if (receipt.status !== "success")
      throw new RelayrVerificationError(
        "A destination transaction reverted onchain. Review the original bundle before attempting recovery.",
      );
    try {
      await verifyActionReceipt(
        client,
        receipt,
        identity.target,
        identity.expectedDeployment,
        identity.rejectEvents,
        identity.reservedReceipt,
        identity.expectedPayout,
      );
    } catch (cause) {
      throw new RelayrVerificationError(
        cause instanceof Error
          ? cause.message
          : "The destination action result could not be verified.",
      );
    }
    if (identity.expectedSafeExecution) {
      try {
        requireRefundFreeSafeExecution(
          receipt,
          identity.expectedSafeExecution.safe,
          identity.expectedSafeExecution.safeTxHash,
        );
      } catch (cause) {
        throw new RelayrVerificationError(
          cause instanceof Error ? cause.message : "The Safe execution could not be verified.",
        );
      }
    }
  }
}

/**
 * Prove a bundle's latest payment from the chain with the SDK, under the hash
 * it was mined: the exact reviewed payment from the session's account,
 * canonically included and successful. A canonical revert leaves the quote to
 * the SDK's retry rule; another transaction at that hash is never paid again.
 */
async function provePayment(bundleUuid: string): Promise<void> {
  const activity = transactionActivitySnapshot().find((item) => item.bundleUuid === bundleUuid);
  if (!activity?.hash || !activity.relayrPayment || !activity.account || !activity.chainId)
    throw new RelayrVerificationError(
      "The original funding transaction cannot be verified. Do not pay again; inspect the existing bundle and wallet activity.",
    );
  const { wagmiConfig } = await import("@/lib/wagmiConfig");
  const client = getPublicClient(wagmiConfig, { chainId: activity.chainId as JBChainId });
  if (!client) throw new Error("The funding RPC is unavailable.");
  try {
    await verifyRelayrPayment(client, {
      hash: activity.hash,
      from: activity.account,
      payment: {
        chainId: activity.chainId,
        target: activity.relayrPayment.target,
        calldata: activity.relayrPayment.data,
        amount: activity.relayrPayment.value,
        bundleUuid,
      },
    });
  } catch (error) {
    if (error instanceof RelayrPaymentRevertedError) {
      fundedBundles.delete(bundleUuid);
      updateTransactionActivity(activity.id, PAYMENT_REVERTED);
      throw new RelayrVerificationError("The Relayr funding transaction reverted onchain.");
    }
    if (error instanceof RelayrProofError) throw new RelayrVerificationError(error.message);
    throw error;
  }
  updateTransactionActivity(activity.id, { relayrPaymentStatus: "confirmed" });
}

function stateIsSuccess(state?: string): boolean {
  return state === "Success" || state === "Completed";
}

function stateIsFailed(state?: string): boolean {
  return state === "Failed" || state === "Reverted" || state === "Dropped";
}

/** Never from a cache: a stale answer could hide a payment or a destination result. */
async function fetchBundle(bundleUuid: string): Promise<RelayrGetBundleResponse> {
  const response = await fetch(`${RELAYR_API}/v1/bundle/${bundleUuid}`, {
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`Relayr bundle check failed (${response.status}).`);
  return response.json();
}

function bundleSummary(bundle: RelayrGetBundleResponse): string {
  return bundle.transactions
    .map((transaction) => {
      const hash = relayrDestinationHash(transaction);
      return `Chain ${transaction.request.chain}: ${transaction.status?.state ?? "Pending"}${hash ? ` (${hash})` : ""}`;
    })
    .join(" | ");
}

function bundleChainStates(bundle: RelayrGetBundleResponse) {
  return bundle.transactions.map((transaction) => ({
    chainId: Number(transaction.request.chain),
    status: transaction.status?.state ?? "Pending",
    hash: relayrDestinationHash(transaction) ?? undefined,
  }));
}

export async function waitForRelayrBundle(
  bundleUuid: string,
  onUpdate?: (bundle: RelayrGetBundleResponse) => void,
): Promise<RelayrGetBundleResponse> {
  const listeners =
    bundleListeners.get(bundleUuid) ?? new Set<(bundle: RelayrGetBundleResponse) => void>();
  if (onUpdate) listeners.add(onUpdate);
  bundleListeners.set(bundleUuid, listeners);
  const notify = (bundle: RelayrGetBundleResponse) =>
    listeners.forEach((listener) => listener(bundle));
  const existing = bundleInflight.get(bundleUuid);
  if (existing) return existing;
  const activityId = `relayr:${bundleUuid}`;
  const request = (async () => {
    let last: RelayrGetBundleResponse | null = null;
    for (let attempt = 0; attempt < 180; attempt += 1) {
      try {
        // A quote whose own payment reverted runs only if another payment funded it,
        // which Relayr's record shows; its destinations are then proven from the chain.
        const reverted =
          transactionActivitySnapshot().find((item) => item.id === activityId)
            ?.relayrPaymentStatus === "reverted";
        if (!reverted) await provePayment(bundleUuid);
        const expected = expectedBundleTransactions(bundleUuid);
        last = await fetchBundle(bundleUuid);
        verifyBundleIdentity(bundleUuid, last, expected);
        if (reverted && !relayrBundleFunded(last))
          throw new RelayrVerificationError("The Relayr funding transaction reverted onchain.");
        const states = last.transactions.map((transaction) => transaction.status?.state);
        const summary = bundleSummary(last);
        if (states.some(stateIsFailed)) {
          updateTransactionActivity(activityId, {
            status: "failed",
            manualVerificationRequired: true,
            message: `Do not pay again. Relayr reported a failed destination transaction. ${summary}`,
            chainStates: bundleChainStates(last),
          });
          notify(last);
          await holdUnprovenSession(activityId);
          throw new Error(`Relayr bundle ${bundleUuid} failed. ${summary}`);
        }
        if (states.length > 0 && states.every(stateIsSuccess)) {
          await verifyDestinationReceipts(last, expected);
          updateTransactionActivity(activityId, {
            status: "success",
            manualVerificationRequired: false,
            message: `All ${states.length} destination transactions confirmed. ${summary}`,
            chainStates: bundleChainStates(last),
          });
          notify(last);
          return last;
        }
        updateTransactionActivity(activityId, {
          status: "pending",
          message: `${reverted ? FUNDED_ELSEWHERE : "Relayr payment confirmed; destination transactions are still executing."} ${summary}`,
          chainStates: bundleChainStates(last),
        });
        notify(last);
      } catch (error) {
        if (error instanceof RelayrVerificationError) {
          const reverted =
            transactionActivitySnapshot().find((item) => item.id === activityId)
              ?.relayrPaymentStatus === "reverted";
          if (!reverted) {
            updateTransactionActivity(activityId, {
              status: "failed",
              manualVerificationRequired: true,
              message: error.message,
            });
            await holdUnprovenSession(activityId);
          }
          throw error;
        }
        if (error instanceof Error && /bundle .* failed/.test(error.message)) throw error;
        updateTransactionActivity(activityId, {
          status: "pending",
          message:
            "Relayr confirmation is temporarily unavailable. Do not pay again; check this bundle again.",
        });
      }
      await new Promise((resolve) => window.setTimeout(resolve, 2_000));
    }
    // A bundle Relayr leaves pending is classified like any unproven one (R114 (c)).
    await holdUnprovenSession(activityId);
    throw new Error(
      `Relayr bundle ${bundleUuid} is still pending after the status timeout. Do not pay again; resume checking this bundle.`,
    );
  })();
  bundleInflight.set(bundleUuid, request);
  void request
    .finally(() => {
      bundleInflight.delete(bundleUuid);
      bundleListeners.delete(bundleUuid);
    })
    .catch(() => undefined);
  return request;
}

export function resumePendingRelayrBundles(): void {
  transactionActivitySnapshot()
    .filter(
      (activity) =>
        activity.kind === "relayr-bundle" &&
        activity.relayrPaymentStatus !== "unfunded" &&
        activity.bundleUuid &&
        (activity.status === "submitted" || activity.status === "pending"),
    )
    .forEach((activity) => void waitForRelayrBundle(activity.bundleUuid!).catch(() => undefined));
}

export function useGetRelayrTxQuote() {
  const config = useConfig();
  const { address } = useAccount();
  const { switchChainAsync } = useSwitchChain();
  const { signTypedDataAsync } = useSignTypedData();
  const [data, setData] = useState<RelayrPostBundleResponse>();
  const [error, setError] = useState<Error | null>(null);
  const [isPending, setIsPending] = useState(false);

  const reset = useCallback(() => {
    setData(undefined);
    setError(null);
    setIsPending(false);
  }, []);

  const getRelayrTxQuote = useCallback(
    async (requests: ReviewedRelayrRequest[]) => {
      if (!address) throw new Error("Connect a wallet first.");
      return withAuthorizationLock(address, async () => {
        requireNoViewAs();
        requests = requests.map((request) => ({ ...request, data: { ...request.data } }));
        if (!address) throw new Error("Connect a wallet first.");
        if (!requests.length) throw new Error("There are no Relayr calls to quote.");
        if (isSafeConnection(config)) {
          throw new Error(
            "A Safe cannot authorize these ERC-2771 requests as an EOA. Submit each action through the Safe proposal flow instead.",
          );
        }
        const requestChains = new Set<number>();
        for (const request of requests) {
          if (request.data.from.toLowerCase() !== address.toLowerCase()) {
            throw new Error("Relayr request sender does not match the connected account.");
          }
          if (requestChains.has(request.chainId)) {
            throw new Error(
              `Relayr cannot safely sign two requests for account ${address} on chain ${request.chainId} with the same onchain nonce.`,
            );
          }
          if (!isRelayrSupportedChain(request.chainId))
            throw new Error(
              "Relayr is unavailable on this network. Use the direct transaction flow.",
            );
          requestChains.add(request.chainId);
        }
        if (!areRelayrChainsCompatible([...requestChains]))
          throw new Error("Choose only mainnets or only testnets for one Relayr bundle.");
        const callKey = requestKey(address, requests);
        const callKeys = requests.flatMap((request) => [
          requestKey(address, [request]),
          ...(request.recoveryScope ? [scopeKey(address, request.recoveryScope)] : []),
          ...(request.relayrMode === "raw" || request.relayrMode === "safe-exec"
            ? []
            : [
                scopeKey(
                  address,
                  `forwarder-nonce:${request.chainId}:${jbContractAddress[request.version ?? 6].ERC2771Forwarder[request.chainId]?.toLowerCase()}`,
                ),
              ]),
        ]);
        // Ruling R114: this action's own saved session, classified before its recheck.
        const saved = savedSessionOf(address, callKey);
        const continuation = saved
          ? await continueSession(config, address, saved, requests, [...requestChains])
          : null;
        if (saved && continuation?.kind === "quote") {
          const quote = continuation.quote;
          updateTransactionActivity(saved.id, {
            relayrCallKeys: Array.from(new Set([...(saved.relayrCallKeys ?? []), ...callKeys])),
          });
          requireTransactionActivityPersistence();
          rememberQuote(quote, address, callKey, callKeys, saved.relayrExpectedTransactions!);
          setData(quote);
          setError(null);
          return quote;
        }
        const continued = continuation ? saved : undefined;
        const forwarded = requests.filter(
          (request) => request.relayrMode !== "raw" && request.relayrMode !== "safe-exec",
        );
        // Ruling R117: every other session that shares a call, a recovery scope or a
        // forwarder nonce reserves it while one of its requests can still run.
        await requireUnfunded(config, { bundleUuid: "", callKey, callKeys }, continued?.id);
        await requireForwarderNoncesFree(
          config,
          address,
          forwarded,
          continued ? [continued.id] : [],
        );
        // A new signature for saved calls goes only to their saved nonces, once every
        // request is dead and unused (R104).
        const signAt =
          continuation?.kind === "sign" && saved ? savedNonces(saved) : new Map<number, bigint>();
        setIsPending(true);
        setError(null);
        try {
          /** The outer calls this publication posts, with what proves each one. */
          let expected: RelayrExpectedTransaction[];
          /** The forwarder nonce each one was signed with, when every one is a forward request. */
          let nonces: string[] | undefined;
          if (continuation?.kind === "requote" && saved?.relayrExpectedTransactions) {
            // A refresh (R114 (a)): the saved signatures go out again under a new quote.
            expected = saved.relayrExpectedTransactions.map((transaction) => ({
              ...transaction,
              transactionUuid: "",
            }));
            nonces = saved.relayrNonces;
          } else {
            const executionGas: string[] = [];
            const transactions: RelayrEntry[] = [];
            const signedNonces: string[] = [];
            const safeExecutions = requests.filter(
              (request) => request.relayrMode === "safe-exec",
            ).length;
            if (safeExecutions && safeExecutions !== requests.length)
              throw new Error("Safe executions are quoted as a Relayr bundle of their own.");
            if (safeExecutions) {
              // One review for the whole bundle: every chain's exact execTransaction.
              await requireTransactionReview({
                kind: "transaction",
                title: `Review ${requests.length} Safe executions`,
                description:
                  "Relayr submits each fully signed Safe transaction below from its own account; the Safe signatures authorize it. A separate payment funds the bundle.",
                confirmLabel: "Agree & request Relayr quote",
                calls: requests.map((request) => ({
                  chainId: request.chainId,
                  from: address,
                  to: request.data.to,
                  value: request.data.value,
                  data: request.data.data,
                  ...request.review,
                })),
              });
              if (getAccount(config).address?.toLowerCase() !== address.toLowerCase())
                throw new Error("Connected account changed. Review the Safe executions again.");
            }
            for (const request of requests) {
              if (request.relayrMode === "safe-exec") {
                // Reads only, so no chain switch: pin the Safe's live nonce and
                // exact transaction hash, then simulate the execution.
                const client = getPublicClient(config, { chainId: request.chainId });
                if (!client) throw new Error(`Relayr is unavailable on chain ${request.chainId}.`);
                request.preconditions = [
                  ...(request.preconditions ?? []),
                  ...requireRawSafeExecution(
                    request.data.to,
                    request.data.data,
                    request.data.value,
                    request.expectedSafeExecution,
                  ),
                ];
                await verifyCallPreconditions(client, request.preconditions);
                await client.call({
                  account: address,
                  to: request.data.to,
                  data: request.data.data,
                  value: request.data.value,
                });
                executionGas.push(gasWithHeadroom(request.data.gas + 100_000n).toString());
                transactions.push({
                  chain: request.chainId,
                  target: request.data.to,
                  data: request.data.data,
                  value: request.data.value.toString(),
                });
                continue;
              }
              await switchChainAsync({ chainId: request.chainId });
              const current = getAccount(config);
              if (!current.address || current.address.toLowerCase() !== address.toLowerCase()) {
                throw new Error(
                  "Connected account changed. Review the Relayr authorization again.",
                );
              }
              if (current.chainId !== request.chainId) {
                throw new Error(
                  "Connected chain did not switch. Review the Relayr authorization again.",
                );
              }
              const version = request.version ?? 6;
              const forwarder = jbContractAddress[version].ERC2771Forwarder[request.chainId];
              const client = getPublicClient(config, { chainId: request.chainId });
              if (!client || !forwarder)
                throw new Error(`Relayr is unavailable on chain ${request.chainId}.`);
              if (request.metadataSource)
                await verifyMetadataSource(client, request.metadataSource, address);
              await verifyCallPreconditions(client, request.preconditions);
              if (request.relayrMode === "raw") {
                requireRawPayerCall(
                  request.data.to,
                  request.data.data,
                  request.data.value,
                  request.expectedDeployment,
                );
                if (!request.reviewedInParent)
                  await requireTransactionReview({
                    kind: "transaction",
                    title: `Review payer deployment on chain ${request.chainId}`,
                    description:
                      "Relayr deploys this payer from its own sending account. The exact owner, project, beneficiary and settings below are independent of that sender. A separate payment funds the selected deployments.",
                    confirmLabel: "Agree & request Relayr quote",
                    calls: [
                      {
                        chainId: request.chainId,
                        from: address,
                        to: request.data.to,
                        value: request.data.value,
                        data: request.data.data,
                        ...request.review,
                      },
                    ],
                  });
                if (getAccount(config).address?.toLowerCase() !== address.toLowerCase())
                  throw new Error("Connected account changed. Review the deployment again.");
                await verifyCallPreconditions(client, request.preconditions);
                await client.call({
                  account: address,
                  to: request.data.to,
                  data: request.data.data,
                  value: request.data.value,
                });
                executionGas.push(gasWithHeadroom(request.data.gas + 100_000n).toString());
                transactions.push({
                  chain: request.chainId,
                  target: request.data.to,
                  data: request.data.data,
                  value: request.data.value.toString(),
                });
                continue;
              }
              await simulateForwardedCall(client, forwarder, address, request);
              const measuredGas = gasWithHeadroom(
                await client.estimateGas({
                  account: forwarder,
                  stateOverride: [{ address: forwarder, balance: maxUint256 }],
                  to: request.data.to,
                  value: request.data.value,
                  data: `${request.data.data}${address.slice(2).toLowerCase()}` as Hex,
                }),
              );
              const nonce = await client.readContract({
                address: forwarder,
                abi: erc2771ForwarderAbi,
                functionName: "nonces",
                args: [address],
              });
              const savedNonce = signAt.get(request.chainId);
              if (savedNonce !== undefined && nonce !== savedNonce)
                throw new Error(
                  "The previous relay authorization may have executed. Check its original bundle before signing again.",
                );
              const fields = await client.readContract({
                address: forwarder,
                abi: erc2771ForwarderAbi,
                functionName: "eip712Domain",
              });
              if (
                fields[0] !== "0x0f" ||
                fields[3] !== BigInt(request.chainId) ||
                fields[4].toLowerCase() !== forwarder.toLowerCase() ||
                fields[6].length
              )
                throw new Error("The forwarder domain does not match this chain and deployment.");
              const deadline = Math.floor(Date.now() / 1_000) + RELAYR_FORWARDER_DEADLINE_SECONDS;
              const domain = {
                name: fields[1],
                version: fields[2],
                chainId: request.chainId,
                verifyingContract: forwarder,
              } as const;
              const message = {
                ...request.data,
                gas: measuredGas > request.data.gas ? measuredGas : request.data.gas,
                nonce,
                deadline,
              };
              await requireTransactionReview({
                kind: "authorization",
                title: `Review Relayr authorization on chain ${request.chainId}`,
                description:
                  "This EIP-712 signature authorizes Relayr's forwarder to submit the exact destination call below. The separate Relayr payment will be reviewed later.",
                confirmLabel: "Agree & sign Relayr request",
                authorization: {
                  type: "EIP-712 ForwardRequest",
                  domain,
                  primaryType: "ForwardRequest",
                  types: FORWARD_REQUEST_TYPES,
                  message,
                },
                calls: [
                  {
                    chainId: request.chainId,
                    from: address,
                    to: request.data.to,
                    value: request.data.value,
                    // The forwarder runs the call with exactly the signed gas.
                    gas: message.gas,
                    data: request.data.data,
                    abi: request.review?.abi,
                    functionName: request.review?.functionName,
                    args: request.review?.args,
                    label: request.review?.label,
                    contractName: request.review?.contractName,
                  },
                ],
              });
              const live = getAccount(config);
              if (
                !live.address ||
                live.address.toLowerCase() !== address.toLowerCase() ||
                live.chainId !== request.chainId
              ) {
                throw new Error(
                  "Connected account changed. Review the Relayr authorization again.",
                );
              }
              if (request.metadataSource)
                await verifyMetadataSource(client, request.metadataSource, address);
              await verifyCallPreconditions(client, request.preconditions);
              const signature = await signTypedDataAsync({
                domain,
                types: FORWARD_REQUEST_TYPES,
                primaryType: "ForwardRequest",
                message,
              });
              const afterSignature = getAccount(config);
              if (
                !afterSignature.address ||
                afterSignature.address.toLowerCase() !== address.toLowerCase() ||
                afterSignature.chainId !== request.chainId
              ) {
                throw new Error(
                  "Connected account changed while signing. Review the Relayr authorization again.",
                );
              }
              executionGas.push(gasWithHeadroom(message.gas + 100_000n).toString());
              const signedData = encodeFunctionData({
                abi: erc2771ForwarderAbi,
                functionName: "execute",
                args: [{ ...message, signature }],
              });
              signedNonces.push(nonce.toString());
              transactions.push({
                chain: request.chainId,
                target: forwarder,
                data: signedData,
                value: request.data.value.toString(),
              });
            }
            expected = transactions.map((transaction, index) => ({
              gas: executionGas[index],
              metadataSource: requests[index].metadataSource,
              preconditions: requests[index].preconditions,
              expectedSafeExecution: requests[index].expectedSafeExecution,
              expectedDeployment: requests[index].expectedDeployment,
              rejectEvents: requests[index].rejectEvents,
              reservedReceipt: requests[index].reservedReceipt,
              expectedPayout: requests[index].expectedPayout,
              chainId: transaction.chain,
              target: transaction.target,
              data: transaction.data,
              value: transaction.value,
              transactionUuid: "",
            }));
            nonces = signedNonces.length === transactions.length ? signedNonces : undefined;
          }
          const bundleRequest = relayrBundleRequest(
            expected.map(({ chainId, target, data, value }) => ({
              chain: chainId,
              target,
              data,
              value,
            })),
          );
          // A response can be lost after Relayr receives executable signatures. Persist
          // the intent first so a reload cannot authorize a fresh copy of the same calls.
          await requireUnfunded(config, { bundleUuid: "", callKey, callKeys }, continued?.id);
          const publicationId = `relayr-publication:${callKey}`;
          recordTransactionActivity({
            id: publicationId,
            kind: "relayr-bundle",
            title: "Relayr authorization publication",
            status: "pending",
            message:
              "Signed Relayr calls were published. If the quote response is lost, do not authorize the same action again until the existing signed calls have been reconciled onchain.",
            account: address,
            callKey,
            relayrCallKeys: callKeys,
            relayrPaymentStatus: "unfunded",
            relayrExpectedTransactions: expected,
            relayrNonces: nonces,
            relayrDiscardable: undefined,
            manualVerificationRequired: undefined,
          });
          requireTransactionActivityPersistence();
          // The new publication carries the continued session's calls: its own
          // signatures again, or new ones once every request it published is dead.
          if (continued && continued.id !== publicationId) supersede([continued]);
          const response = await fetch(`${RELAYR_API}/v1/bundle/prepaid`, {
            method: "POST",
            signal: AbortSignal.timeout(45_000),
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(bundleRequest),
          });
          // Relayr's records must be exactly the signed calls before any payment is offered.
          const bound = await bindRelayrQuote(response, bundleRequest);
          const quote = quoteForDestinationChains(
            { bundle_uuid: bound.bundle_uuid, payment_info: bound.payment_info as ChainPayment[] },
            [...requestChains],
          );
          const expectedTransactions = bound.expectedTransactions.map((binding, index) => ({
            ...expected[index],
            chainId: binding.chain,
            target: binding.entry.target,
            data: binding.entry.data,
            value: binding.entry.value,
            transactionUuid: binding.txUuid,
          }));
          recordTransactionActivity({
            id: `relayr:${quote.bundle_uuid}`,
            kind: "relayr-bundle",
            title: "Relayr bundle ready for payment",
            status: "pending",
            message:
              "The destination authorizations are signed. Choose a funding chain to pay this existing quote once.",
            account: address,
            callKey,
            relayrCallKeys: callKeys,
            bundleUuid: quote.bundle_uuid,
            relayrPaymentStatus: "unfunded",
            relayrExpectedTransactions: expectedTransactions,
            relayrNonces: nonces,
            relayrQuote: structuredClone(quote),
          });
          dismissTransactionActivity(publicationId);
          rememberQuote(quote, address, callKey, callKeys, expectedTransactions);

          setData(quote);
          return quote;
        } catch (cause) {
          const next =
            cause instanceof Error ? cause : new Error("Could not request a Relayr quote.");
          setError(next);
          throw next;
        } finally {
          setIsPending(false);
        }
      });
    },
    [address, config, signTypedDataAsync, switchChainAsync],
  );

  return { getRelayrTxQuote, data, reset, error, isPending, isSuccess: !!data };
}

export function useSendRelayrTx() {
  const config = useConfig();
  const { address } = useAccount();
  const { switchChainAsync } = useSwitchChain();
  const transaction = useSendTransaction();

  const sendRelayrTx = useCallback(
    async (offeredPayment: ChainPayment): Promise<Hex> => {
      requireNoViewAs();
      if (!address) throw new Error("Connect a wallet first.");
      if (isSafeConnection(config))
        throw new Error(
          "Submit each action through the Safe proposal flow instead of paying an EOA Relayr quote.",
        );
      const payment = { ...offeredPayment };
      const remembered = quotes.get(paymentKey(payment));
      if (!remembered || remembered.account.toLowerCase() !== address.toLowerCase())
        throw new Error(
          "This payment does not belong to a reviewed Relayr quote for the connected account. Review the action again.",
        );
      const activityId = `relayr:${remembered.bundleUuid}`;
      const submit = async () => {
        await requireUnfunded(config, remembered);
        const { amount: value } = relayrPaymentDetails(payment, {
          bundleUuid: remembered.bundleUuid,
          destinationChainIds: remembered.chainIds,
        });
        await switchChainAsync({ chainId: payment.chain });
        const requireAccount = () => {
          requireNoViewAs();
          const current = getAccount(config);
          if (
            !current.address ||
            current.address.toLowerCase() !== address.toLowerCase() ||
            current.chainId !== payment.chain ||
            isSafeConnection(config)
          )
            throw new Error("Connected account or chain changed. Review the Relayr payment again.");
        };
        requireAccount();
        await requireTransactionReview({
          kind: "transaction",
          title: "Review Relayr payment",
          description:
            "This one payment funds the signed calls on every selected chain. Destination transactions confirm separately.",
          confirmLabel: "Agree & pay Relayr",
          calls: [
            {
              chainId: payment.chain,
              from: address,
              to: payment.target,
              value,
              gas: RELAYR_PAYMENT_GAS,
              data: payment.calldata,
              label: "Pay Relayr bundle fee",
            },
          ],
        });
        requireAccount();
        const publicClient = getPublicClient(config, { chainId: payment.chain });
        if (!publicClient) throw new Error("Relayr payment network is unavailable.");
        const code = await publicClient.getCode({ address: payment.target });
        if (!code || keccak256(code) !== RELAYR_PAYMENT_CODE_HASH)
          throw new Error("Relayr payment contract code is not recognized.");
        // Funding may be approved long after signing.
        await revalidateSignedCalls(config, address, remembered.expectedTransactions);
        // The payment is sent with the reviewed gas, so it must succeed within it.
        const simulation = await publicClient.call({
          account: address,
          to: payment.target,
          value,
          data: payment.calldata,
          gas: RELAYR_PAYMENT_GAS,
        });
        if (simulation.data && simulation.data !== "0x")
          throw new Error("Relayr payment simulation returned an unexpected result.");
        const sent = sentPayments(
          refreshTransactionActivities().find((row) => row.id === activityId),
        );
        if (sent.length) await requirePaymentRetry(config, address, remembered.bundleUuid, sent);
        requireAccount();
        relayrPaymentDetails(payment, {
          bundleUuid: remembered.bundleUuid,
          destinationChainIds: remembered.chainIds,
        });
        await requireUnfunded(config, remembered);
        recordTransactionActivity({
          id: activityId,
          kind: "relayr-bundle",
          title: "Relayr multi-chain bundle",
          status: "submitted",
          message:
            "Relayr funding is being submitted. Do not pay again while the wallet result is uncertain.",
          chainId: payment.chain,
          account: address,
          bundleUuid: remembered.bundleUuid,
          relayrExpectedTransactions: remembered.expectedTransactions,
          relayrPayment: {
            target: payment.target,
            data: payment.calldata,
            value: value.toString(),
          },
          relayrPayments: sent,
          relayrPaymentStatus: "submitted",
          chainStates: remembered.chainIds.map((chainId) => ({ chainId, status: "Pending" })),
          callKey: remembered.callKey,
        });
        requireTransactionActivityPersistence();
        let hash: Hex;
        try {
          hash = await transaction.sendTransactionAsync({
            account: address,
            chainId: payment.chain,
            to: payment.target,
            value,
            data: payment.calldata,
            gas: RELAYR_PAYMENT_GAS,
          });
        } catch (error) {
          // Only an explicit wallet rejection proves that no transaction was broadcast.
          let cause: unknown = error;
          let rejected = false;
          const seen = new Set<unknown>();
          while (cause && typeof cause === "object" && !seen.has(cause)) {
            seen.add(cause);
            const details = cause as { code?: number; cause?: unknown };
            if (details.code === 4001) rejected = true;
            cause = details.cause;
          }
          // A quote paid before stays on the SDK's retry rule when the wallet declines
          // to pay it again: another payment may still fund it.
          if (rejected)
            updateTransactionActivity(
              activityId,
              sent.length
                ? PAYMENT_REVERTED
                : {
                    status: "pending",
                    relayrPaymentStatus: "unfunded",
                    message:
                      "The wallet declined payment. The existing signed quote can still be funded once before it expires.",
                  },
            );
          else
            updateTransactionActivity(activityId, {
              status: "pending",
              message:
                "The wallet's funding result is uncertain. Do not pay again; inspect wallet activity and this bundle.",
            });
          throw error;
        }
        fundedBundles.add(remembered.bundleUuid);
        /** The payment under `sentHash`, after every one sent before it. */
        const sentAs = (sentHash: Hex) => ({
          hash: sentHash,
          relayrPayments: [
            ...sent,
            {
              hash: sentHash,
              chainId: payment.chain,
              target: payment.target,
              data: payment.calldata,
              value: value.toString(),
            },
          ],
        });
        updateTransactionActivity(activityId, {
          ...sentAs(hash),
          message: "Relayr payment submitted. Do not pay again while its receipt is pending.",
        });
        let mined = hash;
        try {
          const receipt = await waitForTransactionReceipt(config, { chainId: payment.chain, hash });
          // A wallet that sped the payment up mined it under another hash; that
          // transaction is the payment to prove and to remember.
          if (typeof receipt?.transactionHash !== "string" || !isHash(receipt.transactionHash))
            throw new Error("The payment receipt names no transaction hash.");
          if (receipt.transactionHash.toLowerCase() !== hash.toLowerCase()) {
            mined = receipt.transactionHash;
            updateTransactionActivity(activityId, sentAs(mined));
          }
          await provePayment(remembered.bundleUuid);
        } catch (error) {
          if (!(error instanceof RelayrVerificationError))
            updateTransactionActivity(activityId, {
              status: "pending",
              message:
                "Relayr payment was submitted, but confirmation is uncertain. Do not pay again; check this hash and bundle.",
            });
          throw new Error(
            `Relayr payment ${mined} was submitted, but confirmation is uncertain. Do not pay again.`,
            { cause: error },
          );
        }
        updateTransactionActivity(activityId, {
          status: "pending",
          message: "Relayr payment confirmed. Destination transactions are now pending.",
        });
        void waitForRelayrBundle(remembered.bundleUuid).catch(() => undefined);
        return mined;
      };
      if (paymentInflight.has(remembered.callKey))
        throw new Error("This Relayr payment is already in progress. Do not pay again.");
      paymentInflight.add(remembered.callKey);
      try {
        const locks = typeof navigator === "undefined" ? undefined : navigator.locks;
        return await (locks
          ? locks.request(`revnet:relayr:${remembered.callKey}`, submit)
          : submit());
      } finally {
        paymentInflight.delete(remembered.callKey);
      }
    },
    [address, config, switchChainAsync, transaction],
  );

  return {
    sendRelayrTx,
    isPending: transaction.isPending,
    error: transaction.error,
    isSuccess: transaction.isSuccess,
    data: transaction.data,
  };
}

export function useGetRelayrTxBundle() {
  const [uuid, setUuid] = useState<string>();
  const [response, setResponse] = useState<RelayrGetBundleResponse>();
  const [error, setError] = useState<unknown>();
  const [isPolling, setIsPolling] = useState(false);
  const [pollAttempt, setPollAttempt] = useState(0);
  const startPolling = useCallback((bundleUuid: string) => {
    setResponse(undefined);
    setError(undefined);
    setIsPolling(true);
    setUuid(bundleUuid);
    setPollAttempt((attempt) => attempt + 1);
  }, []);

  useEffect(() => {
    if (!uuid) return;
    let active = true;
    setIsPolling(true);
    void waitForRelayrBundle(uuid, (next) => active && setResponse(next))
      .then((next) => active && setResponse(next))
      .catch((cause) => active && setError(cause))
      .finally(() => active && setIsPolling(false));
    return () => {
      active = false;
    };
  }, [uuid, pollAttempt]);

  const states = response?.transactions.map((item) => item.status?.state) ?? [];
  const isComplete = !error && !isPolling && states.length > 0 && states.every(stateIsSuccess);
  const hasFailed = !!error || states.some(stateIsFailed);
  return { startPolling, isComplete, hasFailed, uuid, response, isPolling, error };
}
