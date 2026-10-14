"use client";

import { useWriteHoldWatch } from "@/hooks/useWriteHoldWatch";
import { legacyBatchNamespace, legacyCallNamespace } from "@/lib/legacy-intents";
import { captureReviewedWalletContext } from "@/lib/reviewed-wallet-context";
import { isSafeConnection } from "@/lib/safe-connector";
import {
  safeProposalAt,
  safeTransactionRunsCalls,
  type ReviewedSafeProposal,
} from "@/lib/safe-transactions";
import {
  contractTransactionKey,
  dismissTransactionActivity,
  recordTransactionActivity,
  refreshTransactionActivities,
  transactionActivityForHash,
  transactionActivitySnapshot,
  updateTransactionActivity,
  useTransactionActivities,
  type TransactionActivity,
} from "@/lib/transaction-activity";
import {
  requireContractTransactionReview,
  requireTransactionReview,
  type ContractTransactionReviewCall,
  type TransactionReviewOptions,
} from "@/lib/transaction-review";
import { requireNoViewAs } from "@/lib/view-as";
import {
  isTransactionReceiptUnavailableError,
  waitForReceiptWithRetry,
} from "@/lib/waitForReceipt";
import {
  adoptIntoHold,
  hidesShownExit,
  holdOfHash,
  legacyIntentsOf,
  legacyOf,
  offersExit,
  rememberHold,
  safeHoldOf,
  sendUnderHold,
  withNotice,
  writeHolds,
  writeIntentOf,
} from "@/lib/write-hold";
import {
  browserLocks,
  gasWithHeadroom,
  isDefiniteWalletRejection,
  SAFE_PROPOSAL_EXECUTED_LINE,
  SAFE_PROPOSAL_REPLACED_LINE,
  simulateCallSequence,
  submitReviewedContractWrite,
  WRITE_HOLD_REVERTED_LINE,
  WRITE_HOLD_SAFE_UNPROVEN_LINE,
  type WriteHoldClient,
  type WriteHoldGate,
  type WriteHoldHandle,
  type WriteHoldState,
} from "@bananapus/nana-sdk-core/review";
import { readAuthorityIdentity, readBoundedSafeNonce } from "@bananapus/nana-sdk-core/safe";
import {
  hasSafeService,
  lookAtSafeProposal,
  provenSafeProposalEnd,
  readSafeTransaction,
  SAFE_NONCE_GUIDANCE,
  SAFE_PROPOSAL_AWAITING,
  safeExecutionResult,
  safeExecutionRunsCalls,
  safeTransactionMessage,
  usableSafeConfirmations,
  type SafeQueuedTransaction,
} from "@bananapus/nana-sdk-core/safe-service";
import { useQueryClient } from "@tanstack/react-query";
import { sendCalls } from "@wagmi/core";
import { useCallback, useMemo, useState } from "react";
import {
  encodeFunctionData,
  isHash,
  keccak256,
  stringToHex,
  TransactionNotFoundError,
  type Abi,
  type Address,
  type Hex,
  type PublicClient,
  type TransactionReceipt,
} from "viem";
import {
  useConfig,
  useWaitForTransactionReceipt as useWagmiWaitForTransactionReceipt,
  useWriteContract as useWagmiWriteContract,
} from "wagmi";
import { getAccount, getPublicClient, simulateContract, switchChain } from "wagmi/actions";

export { isSafeConnection, isSafeConnector, useSafeConnection } from "@/lib/safe-connector";

/** Why a send was refused: its plan names one account (a beneficiary, a recipient, a position's owner) and another is connected. */
export const ACCOUNT_CHANGED = "The connected account changed. Review again.";

/**
 * Refuses a send whose plan was built for `planned` while another account is
 * connected: the plan pays out to `planned`, and the connected account would
 * pay for it. A plan that names no account may be sent by any.
 */
function requirePlannedAccount(planned: unknown, connected: Address): void {
  const address =
    typeof planned === "string"
      ? planned
      : planned && typeof planned === "object" && "address" in planned
        ? String((planned as { address: unknown }).address)
        : undefined;
  if (address !== undefined && address.toLowerCase() !== connected.toLowerCase()) {
    throw new Error(ACCOUNT_CHANGED);
  }
}

const safeInflight = new Map<string, Promise<void>>();
/** A watch looks for its proposal's result this often. */
const SAFE_LOOK_MS = 5_000;
/**
 * Looks in the minute after a reply, each of which checks the chain: an execution Safe{Wallet}
 * sent at once reaches it within that minute. Without a Safe service, this many chain checks that
 * find nothing end a proposal unconfirmed.
 */
const SAFE_EXECUTION_CHECKS = 12;
const RECEIPT_UNCONFIRMED = "Couldn't confirm this yet. Check your wallet before sending again.";
/** The Safe used a proposal's nonce, and the canonical chain has not yet said what ran there. */
const SAFE_NONCE_USED_LINE = "Your Safe moved past this proposal. Checking what ran.";
/** The transaction reported for a proposal holds no event for it. */
const SAFE_OTHER_RECEIPT_LINE = "Checking what your Safe ran.";
/** How far around the Safe's nonce a proposal's own nonce is looked for by its hash. */
const NONCE_SEARCH_BEHIND = 64;
const NONCE_SEARCH_AHEAD = 16;
/** A watch reads its Safe's state at most this often. */
const SAFE_REREAD_MS = 60_000;
/**
 * A proposal the app still can't follow this long after it was made ends unconfirmed: the hour a
 * watch lasts.
 */
const SAFE_RESULT_HORIZON_MS = 60 * 60_000;
/**
 * Looks at the Safe service, ten minutes of them, that must find the proposal where the app can't
 * follow it, with none between them showing it live, before it ends unconfirmed. A single look
 * proves nothing on its own: the Safe's nonce moves when an execution is mined, and the service may
 * list that execution later.
 */
const SAFE_STUCK_LOOKS = (10 * 60_000) / SAFE_LOOK_MS;

/** Whether `response`'s body is JSON. */
const isJson = (response: Response) =>
  response.json().then(
    () => true,
    () => false,
  );

/**
 * What one look of a Safe proposal's watch showed: the proposal settled or ended ("done"), able to
 * execute ("live"), where the app can't follow it ("stuck"), or nothing ("unknown").
 */
type SafeLook = "done" | "live" | "stuck" | "unknown";

/**
 * `read` of a Safe, answered from its last read for a minute after each one.
 * It keeps one read for any Safe: each watch reads only its own proposal's Safe.
 */
function rereadEveryMinute<T>(read: (safe: Address) => Promise<T>): (safe: Address) => Promise<T> {
  let last: { at: number; value: Promise<T> } | undefined;
  return (safe) => {
    if (!last || Date.now() - last.at >= SAFE_REREAD_MS) {
      last = { at: Date.now(), value: read(safe) };
    }
    return last.value;
  };
}

/** A Safe proposal's execution settled `success` or not: its row shows that result. */
function safeExecuted(id: string, isSuccessful: boolean, transactionHash: Hex | undefined) {
  const tracked = refreshTransactionActivities().find((activity) => activity.id === id);
  const needsReceiptVerification = tracked?.manualVerificationRequired === true;
  updateTransactionActivity(id, {
    status: needsReceiptVerification ? "pending" : isSuccessful ? "success" : "failed",
    executionHash: transactionHash,
    holdFollows: undefined,
    safeResultUnconfirmed: undefined,
    message: needsReceiptVerification
      ? "Your Safe ran this. Resume the saved batch to finish checking it."
      : !isSuccessful
        ? WRITE_HOLD_REVERTED_LINE
        : SAFE_PROPOSAL_EXECUTED_LINE,
  });
}

/** What a proposal shows while its hold checks its result and no exit is due. */
// TODO(SDK 2.39): use the SDK's shared confirming line; this matches jbm's until then.
const SAFE_CONFIRMING_LINE = "Executed by your Safe. Confirming it onchain.";
/** What a proposal the hold proved expired before it ran shows. */
const SAFE_EXPIRED_LINE = "This Safe transaction expired before it ran.";
/** Looks a hold loop takes a few seconds apart, before it asks once a minute. */
const HOLD_FAST_LOOKS = 12;
const HOLD_SLOW_MS = 60_000;
/** Each proposal's hold loop, by generation: a newer one ends the older. */
const holdLoops = new Map<string, number>();

/**
 * The Safe follower's one end besides the user's: the proposal's write hold decides. The hold
 * gets the evidence (a receipt, or an execution named without one), is told an unproven end, then
 * is asked until it clears. The row shows a confirming line until the hold offers its exit, and
 * never goes back to awaiting; a contended answer (`checked: false`) never hides an exit already
 * shown. It ends with the hold: success only on its authenticated settlement, or a failure, an
 * expiry or a release; or once the user dismissed the row or took the exit. A proposal the hold
 * can't hold (journaled without its reviewed calls, or no client) ends unconfirmed: its account
 * dismisses it.
 */
async function holdUntilResolved(
  id: string,
  chainId: number,
  client: PublicClient | undefined,
  evidence: { unproven: boolean; executionHash?: Hex; receipt?: TransactionReceipt },
): Promise<void> {
  const row = refreshTransactionActivities().find((activity) => activity.id === id);
  if (!row?.hash) return;
  const generation = (holdLoops.get(id) ?? 0) + 1;
  holdLoops.set(id, generation);
  const executionHash = evidence.receipt?.transactionHash ?? evidence.executionHash;
  updateTransactionActivity(id, {
    status: "safe-proposed",
    holdFollows: true,
    ...(executionHash ? { executionHash } : {}),
  });
  if (client && heldBeforeTheHold(row))
    await holdLegacySafeProposal(row, client).catch(() => undefined);
  const held = refreshTransactionActivities().find((activity) => activity.id === id);
  if (!client || !held?.safeProposal || !held.sdkHeld) {
    updateTransactionActivity(id, {
      message: WRITE_HOLD_SAFE_UNPROVEN_LINE,
      safeResultUnconfirmed: true,
    });
    return;
  }
  const { safeProposal, hash } = held;
  const followed = () => {
    const current = refreshTransactionActivities().find((activity) => activity.id === id);
    return (
      holdLoops.get(id) === generation &&
      current?.createdAt === row.createdAt &&
      current.status === "safe-proposed" &&
      current.obsoleteSafeNonce === undefined
    );
  };
  const hold = safeHoldOf(chainId, safeProposal);
  // The evidence goes to the hold first; its own answer, read below, decides.
  if (evidence.receipt)
    await hold
      .onReceipt(evidence.receipt, client, {
        calls: safeProposal.calls,
        batch: safeProposal.batch,
      })
      .catch(() => undefined);
  else if (evidence.executionHash)
    await hold.onExecuted(client, evidence.executionHash).catch(() => undefined);
  let state: WriteHoldState | null = await hold.state(client).catch(() => null);
  // An end the hold doesn't already decide (a clear, or an exit such as a replaced nonce) is
  // unproven: the hold offers its exit, and later evidence still settles it.
  if (evidence.unproven && (!state || (state.status !== "clear" && !state.exit))) {
    await hold.onUnproven(client, hash).catch(() => undefined);
    state = null;
  }
  let shown: WriteHoldState | null = null;
  for (let attempt = 0; followed(); attempt += 1) {
    state ??= await hold.state(client).catch(() => hold.peek());
    if (!followed()) return;
    if (state.status === "clear") {
      const settled = state.settled;
      const own = executionHash?.toLowerCase();
      if (settled?.result === "expired")
        updateTransactionActivity(id, {
          status: "failed",
          message: SAFE_EXPIRED_LINE,
          holdFollows: undefined,
        });
      else if (settled && (!own || settled.hash.toLowerCase() === own))
        safeExecuted(id, settled.result === "success", settled.hash);
      else {
        const current = refreshTransactionActivities().find((activity) => activity.id === id);
        if (current) releaseJournaledProposal(current);
      }
      return;
    }
    if (offersExit(shown, state)) {
      shown = state;
      updateTransactionActivity(id, { message: withNotice(state), safeResultUnconfirmed: true });
    } else if (!state.exit && !hidesShownExit(shown, state)) {
      shown = null;
      const current = refreshTransactionActivities().find((activity) => activity.id === id);
      if (current?.message !== SAFE_CONFIRMING_LINE || current.safeResultUnconfirmed)
        updateTransactionActivity(id, {
          message: SAFE_CONFIRMING_LINE,
          safeResultUnconfirmed: undefined,
        });
    }
    state = null;
    await new Promise((resolve) =>
      window.setTimeout(resolve, attempt < HOLD_FAST_LOOKS ? SAFE_LOOK_MS : HOLD_SLOW_MS),
    );
  }
}

async function watchSafeProposal(
  id: string,
  hash: Hex,
  chainId: number,
  client: PublicClient | undefined,
): Promise<void> {
  const service = hasSafeService(chainId);
  const existing = safeInflight.get(id);
  if (existing) return existing;
  const tracked = () => refreshTransactionActivities().find((activity) => activity.id === id);
  // A proposal journaled without its Safe was made by the Safe it names as its account.
  const safeOf = () => tracked()?.safeProposal?.safe ?? tracked()?.account;
  /**
   * Tells the SDK's write hold, which holds the proposal by what it was reviewed to run, how this
   * watch saw it end; the hold decides what it releases. A proposal journaled without reviewed
   * calls has no hold.
   */
  const tellHold = (
    report: (hold: WriteHoldHandle, chain: WriteHoldClient) => Promise<unknown>,
  ) => {
    const proposal = tracked()?.safeProposal;
    if (!proposal || !client) return;
    void report(safeHoldOf(chainId, proposal), client).catch(() => undefined);
  };
  /**
   * Whether a Safe transaction runs exactly what this proposal was reviewed to run. A proposal
   * journaled without reviewed calls is held to its authenticated hash and the Safe's own event
   * for it alone.
   */
  const runsReviewed = (tx: Parameters<typeof safeTransactionRunsCalls>[0]) => {
    const proposal = tracked()?.safeProposal;
    return !proposal || safeTransactionRunsCalls(tx, proposal.calls, proposal.batch);
  };
  /** Whether an execution the chain knows is this Safe's execTransaction of the reviewed calls. */
  const executesReviewed = (transaction: { to?: Address | null; input?: Hex }) => {
    // Without reviewed calls, the Safe's one execution in the receipt decides (see runsReviewed).
    const proposal = tracked()?.safeProposal;
    if (!proposal) return true;
    const safe = safeOf();
    return !!safe && safeExecutionRunsCalls(transaction, safe, proposal.calls, proposal.batch);
  };
  /** The Safe's live owners and threshold, for the approvals line. */
  const livePolicy = rereadEveryMinute(async (safe) => {
    const identity = client ? await readAuthorityIdentity(client, safe).catch(() => null) : null;
    return identity?.kind === "safe"
      ? { owners: identity.owners, threshold: identity.threshold }
      : null;
  });
  /** The Safe's live nonce, or null when it can't be read. */
  const liveNonce = rereadEveryMinute(async (safe) =>
    client ? await readBoundedSafeNonce(client, safe).catch(() => null) : null,
  );
  /**
   * The SDK's look at a proposal whose nonce the Safe has passed: the Safe's execution events
   * at a finalized block say whether this proposal ran ("executed") or another took its nonce
   * ("replaced"). Anything it can't prove reads "live".
   */
  const chainLook = rereadEveryMinute(async (safe) =>
    client
      ? await lookAtSafeProposal(client, chainId, safe, hash).catch(() => "live" as const)
      : ("live" as const),
  );
  /** Whether the SDK's hold can hold this proposal: it has its reviewed calls and a client. */
  const holdable = () => !!client && !!tracked()?.safeProposal;
  /** Hands the proposal to its hold, which decides from here on (see holdUntilResolved). */
  const toHold = (evidence: Parameters<typeof holdUntilResolved>[3]) =>
    void holdUntilResolved(id, chainId, client, evidence);
  /**
   * The watch can't confirm this proposal's result. Each caller has just read the chain (the
   * execution's receipt, or the transaction with this hash) or has no client to read it with. The
   * hold decides from here, an unproven end.
   */
  const unconfirmed = (executionHash?: Hex) => {
    const proof = tracked()?.safeExecutionProven;
    // Not an end: a proposal the chain proved executed, or whose nonce the Safe used, is followed
    // on until the canonical chain says what ran, on the next load too.
    if (nonceUsed || proof)
      updateTransactionActivity(id, {
        ...(executionHash ? { executionHash } : {}),
        message: proof ? SAFE_PROPOSAL_EXECUTED_LINE : SAFE_NONCE_USED_LINE,
      });
    else toHold({ unproven: true, executionHash });
  };
  /**
   * Another Safe transaction took the proposal's nonce. The hold never releases it on its own: it
   * offers the exit. A proposal no hold holds ends replaced.
   */
  const replaced = () => {
    if (holdable()) toHold({ unproven: true });
    else updateTransactionActivity(id, { status: "failed", message: SAFE_PROPOSAL_REPLACED_LINE });
  };
  /** The chain proved the proposal executed: it is followed until its receipt settles it. */
  const proven = () => tracked()?.safeExecutionProven !== undefined;
  /**
   * An end of the follower is unproven unless the chain proved the proposal executed or the Safe
   * used its nonce: only the canonical chain, which the hold reads, decides those.
   */
  const unprovenEnd = () => !nonceUsed && !proven();
  /** The proposal's nonce once a look saw the Safe pass it, for chain checks the service can't block. */
  let passedNonce: bigint | undefined;
  /** The proposal's saved nonce, or undefined. */
  const savedNonce = () => {
    const saved = tracked()?.safeProposalNonce;
    return saved && /^\d+$/.test(saved) ? BigInt(saved) : undefined;
  };
  /** The Safe's live nonce is past the saved one: only the canonical chain may end it now. */
  let nonceUsed = false;
  const saveNonce = (nonce: bigint) => {
    if (tracked()?.safeProposalNonce !== undefined) return;
    updateTransactionActivity(id, { safeProposalNonce: nonce.toString() });
    // The hold authenticates the nonce and takes it, so it can tell when that nonce is used.
    tellHold((hold, chain) =>
      hold.attachSafeNonce(chain, { safeTxHash: hash, nonce: Number(nonce) }),
    );
  };
  /**
   * A proposal saved without its nonce (made before it was saved) finds it from its hash: the
   * reviewed calls as this app proposes them, at each nonce around the Safe's.
   */
  const recoverNonce = rereadEveryMinute(async (safe) => {
    const proposal = tracked()?.safeProposal;
    if (savedNonce() !== undefined || !proposal?.calls.length) return;
    const live = await liveNonce(safe);
    if (live === null) return;
    const from = live > BigInt(NONCE_SEARCH_BEHIND) ? live - BigInt(NONCE_SEARCH_BEHIND) : 0n;
    const found = safeProposalAt(
      chainId,
      { ...proposal, safe },
      hash,
      from,
      live + BigInt(NONCE_SEARCH_AHEAD),
    );
    if (found) saveNonce(BigInt(found.nonce));
  });
  /**
   * What the canonical chain shows at the nonce the Safe passed, read without the Safe service
   * (from a saved proof, or from this watch's own look). Only the canonical execution log is a
   * proof: it is saved with its transaction, whose receipt then settles the proposal. Another
   * proposal's execution there releases it as replaced, and drops any older proof saved
   * without a hash. "done" once released; the execution's hash to settle from; otherwise
   * undefined.
   */
  const canonicalEnd = rereadEveryMinute(async (safe): Promise<Hex | "done" | undefined> => {
    const proof = tracked()?.safeExecutionProven;
    if (proof?.executionHash) return proof.executionHash;
    const nonce =
      proof && /^\d+$/.test(proof.nonce) ? BigInt(proof.nonce) : (savedNonce() ?? passedNonce);
    if (!client || nonce === undefined) return undefined;
    const found = await provenSafeProposalEnd(client, safe, hash, nonce);
    if (!found) return undefined;
    if (found.look === "replaced") {
      updateTransactionActivity(id, { safeExecutionProven: undefined });
      replaced();
      return "done";
    }
    // An execution proven without its transaction names nothing to settle from.
    if (found.look !== "executed" || !found.execution) return undefined;
    updateTransactionActivity(id, {
      message: SAFE_PROPOSAL_EXECUTED_LINE,
      safeExecutionProven: {
        safe,
        nonce: nonce.toString(),
        executionHash: found.execution.executionHash,
      },
      safeResultUnconfirmed: undefined,
    });
    const executionHash = found.execution.executionHash;
    tellHold((hold, chain) => hold.onExecuted(chain, executionHash));
    return executionHash;
  });
  /** Settles from the canonical chain: true once the proposal ended. */
  const settledFromChain = async (safe: Address): Promise<boolean> => {
    const end = await canonicalEnd(safe);
    if (end === "done") return true;
    if (!end) return false;
    return settle(end);
  };
  /** Whether the hour after the proposal was made has passed. */
  const pastHorizon = () =>
    Date.now() - (tracked()?.createdAt ?? Date.now()) >= SAFE_RESULT_HORIZON_MS;
  /**
   * Settles the proposal from its execution's receipt: only the Safe's own
   * event for this proposal decides, never the receipt's status alone or
   * another proposal's event in the same receipt. A proposal the hold holds is
   * the hold's from here, receipt or not: success only on its settlement.
   * True once the watch has ended.
   */
  const settle = async (executionHash: Hex): Promise<boolean> => {
    // The hold keeps every execution this watch follows as a candidate, before any receipt read
    // or unproven end: its exit stays closed while that transaction is pending.
    tellHold((hold, chain) => hold.onExecuted(chain, executionHash));
    let receipt: TransactionReceipt | undefined;
    // Whether the chain answered that it holds no receipt for the execution (a read that found
    // none, or a receipt of another transaction), or there is no client to ask. A node that
    // couldn't answer says nothing.
    let noReceipt = !client;
    if (client) {
      try {
        receipt = await waitForReceiptWithRetry(client, executionHash);
      } catch (error) {
        noReceipt = isTransactionReceiptUnavailableError(error) && error.noReceipt;
      }
      if (receipt && receipt.transactionHash?.toLowerCase() !== executionHash.toLowerCase()) {
        receipt = undefined;
        noReceipt = true;
      }
    }
    const safe = safeOf();
    // No receipt to read yet: the named execution is the hold's candidate, and the hold decides.
    if ((!receipt || !safe) && holdable()) {
      toHold({ unproven: unprovenEnd(), executionHash });
      return true;
    }
    if (!receipt && !noReceipt) {
      // The proposal stays held for the next look.
      updateTransactionActivity(id, { executionHash, message: RECEIPT_UNCONFIRMED });
      return false;
    }
    if (!receipt || !safe) {
      // A receipt the chain still doesn't hold an hour after it first said so is not coming.
      const seen = tracked();
      const seenAt =
        seen?.executionHash?.toLowerCase() === executionHash.toLowerCase()
          ? (seen.executionSeenAt ?? Date.now())
          : Date.now();
      if (Date.now() - seenAt >= SAFE_RESULT_HORIZON_MS) {
        unconfirmed(executionHash);
        return true;
      }
      updateTransactionActivity(id, {
        executionHash,
        executionSeenAt: seenAt,
        message: RECEIPT_UNCONFIRMED,
      });
      return false;
    }
    const result = safeExecutionResult(receipt, safe, hash);
    if (result.status === "unproven") {
      // A receipt without this proposal's own event says nothing about it: the hold decides.
      if (holdable()) {
        toHold({ unproven: unprovenEnd(), receipt });
        return true;
      }
      updateTransactionActivity(id, { executionHash, message: SAFE_OTHER_RECEIPT_LINE });
      return false;
    }
    // The Safe's own failure event is the result; a success is the hold's settlement of it.
    if (result.status === "success" && holdable()) {
      toHold({ unproven: false, receipt });
      return true;
    }
    safeExecuted(id, result.status === "success", executionHash);
    const proposal = tracked()?.safeProposal;
    const settledBy = receipt;
    if (proposal)
      tellHold((hold, chain) =>
        hold.onReceipt(settledBy, chain, { calls: proposal.calls, batch: proposal.batch }),
      );
    return true;
  };
  /**
   * The chain's transaction with the proposal's hash: null when the chain has none, and undefined
   * when the node can't be reached, which says nothing about it.
   */
  const findExecution = (chain: PublicClient) =>
    chain
      .getTransaction({ hash })
      .catch((error: unknown) => (error instanceof TransactionNotFoundError ? null : undefined));
  type ChainAnswer = Awaited<ReturnType<typeof findExecution>>;
  /**
   * Ends the proposal on the chain's word, which may show an execution Safe{Wallet} sent at once
   * since the watch last checked: `answer` is this look's own check of the chain, or one more check
   * when the look made none. An execution of the reviewed calls settles the proposal instead. False
   * when the node can't answer, and the proposal stays for the watch's next chain check.
   */
  const endUnconfirmed = async (answer: ChainAnswer | "unchecked"): Promise<boolean> => {
    const execution =
      answer === "unchecked" ? (client ? await findExecution(client) : null) : answer;
    // A node that can't answer is unknown evidence: the hold decides, with no wait before it.
    if (execution === undefined && !holdable()) return false;
    if (execution && executesReviewed(execution)) {
      await settle(hash);
    } else unconfirmed();
    return true;
  };
  /** The service's record of this proposal runs other calls, so the app can never follow it. */
  let unfollowable = false;
  /**
   * One look at the Safe service: "done" once the proposal is settled; "live" when it is listed
   * unexecuted with its nonce still to come; "stuck" when the app can't follow it: not listed, a
   * record it can't authenticate, a record of other calls (which makes it due to end), executed
   * without its transaction, or a nonce the Safe has moved past; and "unknown" when the service is
   * down or answers with a page that isn't JSON, or the nonce can't be read.
   */
  const askService = async (safe: Address): Promise<SafeLook> => {
    // The status of the service's answer tells "not indexed yet" (404) and a record it can't
    // read (a 2xx JSON answer) apart from an outage, without reading its error message. A 2xx page
    // that isn't JSON is not a record at all.
    let status = 0;
    let json = false;
    const observed: typeof fetch = async (input, init) => {
      const response = await fetch(input, init);
      status = response.status;
      json = response.ok && (await isJson(response.clone()));
      return response;
    };
    try {
      // The record must name this Safe and hash to this proposal.
      const proposal = (await readSafeTransaction(chainId, safe, hash, {
        fetch: observed,
      })) as SafeQueuedTransaction & { transactionHash?: unknown };
      if (tracked()?.obsoleteSafeNonce !== undefined) return "done";
      if (runsReviewed(safeTransactionMessage(proposal))) {
        // The nonce hold comes first: once the Safe has used it, only the canonical chain may
        // end this proposal, whatever settles below.
        saveNonce(safeTransactionMessage(proposal).nonce);
        const saved = savedNonce();
        const current = saved === undefined ? null : await liveNonce(safe);
        if (saved !== undefined && current !== null && current > saved) nonceUsed = true;
      }
      const executionHash =
        typeof proposal.transactionHash === "string" && isHash(proposal.transactionHash)
          ? proposal.transactionHash
          : undefined;
      const message = safeTransactionMessage(proposal);
      if (!runsReviewed(message)) {
        unfollowable = true;
        return "stuck";
      }
      if (proposal.isExecuted) {
        if (executionHash) {
          // The watch ends here either way; a proposal its receipt didn't settle stays held and
          // is followed again on the next load.
          await settle(executionHash);
          return "done";
        }
        updateTransactionActivity(id, {
          status: "safe-proposed",
          message: SAFE_CONFIRMING_LINE,
        });
        return "stuck";
      }
      // Only the Safe's current owners' well-formed confirmations count.
      const live = await livePolicy(safe);
      const approvals = live
        ? `: ${usableSafeConfirmations(proposal, live.owners).length} of ${live.threshold}`
        : "";
      updateTransactionActivity(id, {
        status: "safe-proposed",
        message: proven()
          ? SAFE_PROPOSAL_EXECUTED_LINE
          : nonceUsed
            ? SAFE_NONCE_USED_LINE
            : `Waiting for your Safe's approvals${approvals}.`,
      });
      // A nonce the Safe has moved past was taken by another transaction, or by this proposal's
      // own execution that the service has yet to list. The chain's execution events decide
      // as soon as a finalized block shows which; until then the watch's run of looks waits it
      // out, and only after the hour may it end the proposal.
      const nonce = await liveNonce(safe);
      if (nonce !== null && nonce > message.nonce) {
        const look = await chainLook(safe);
        if (look === "replaced") {
          replaced();
          return "done";
        }
        if (look === "executed") {
          // The SDK's "executed" may come from a log the canonical chain no longer holds, so
          // only the canonical log is saved as proof, with its transaction: its receipt settles
          // it without the Safe service (ExecutionSuccess as success, ExecutionFailure as
          // failed, which ends the hold), and until then it stays held through gaps, dismissal
          // and reloads. A canonical replacement releases it.
          passedNonce = message.nonce;
          return (await settledFromChain(safe)) ? "done" : "live";
        }
      }
      if (!pastHorizon()) return "live";
      if (nonce === null) return "unknown";
      return nonce > message.nonce ? "stuck" : "live";
    } catch {
      if (status === 404 || (status >= 200 && status < 300 && json)) {
        return "stuck";
      }
      updateTransactionActivity(id, {
        status: "safe-proposed",
        message: proven()
          ? SAFE_PROPOSAL_EXECUTED_LINE
          : "Couldn't check your Safe right now. Trying again.",
      });
      return "unknown";
    }
  };
  // Without a Safe service or a client for its chain, nothing can follow the proposal.
  if (!service && !client) {
    unconfirmed();
    return;
  }
  // An execution saved by an earlier load is the hold's candidate again before anything else.
  const savedExecution = tracked()?.safeExecutionProven?.executionHash ?? tracked()?.executionHash;
  if (savedExecution) tellHold((hold, chain) => hold.onExecuted(chain, savedExecution));
  const request = (async () => {
    // Looks that found the proposal where the app can't follow it since a look last showed it
    // live. A look that learns nothing leaves the count as it is.
    let stuckLooks = 0;
    // Whether the proposal is due to end but the node couldn't answer, so the watch waits for its
    // next chain check.
    let awaitingChain = false;
    // Without a Safe service only the chain can show an execution, and twelve of its checks must
    // find none.
    const stuckFor = service ? SAFE_STUCK_LOOKS : SAFE_EXECUTION_CHECKS;
    for (let attempt = 0; attempt < SAFE_RESULT_HORIZON_MS / SAFE_LOOK_MS; attempt += 1) {
      if (tracked()?.obsoleteSafeNonce !== undefined) return;
      // A proven execution, or a saved or seen nonce the Safe has used, is settled from the
      // canonical chain whatever the service says, at most once a minute.
      const chainSafe = tracked()?.safeExecutionProven?.safe ?? safeOf();
      if (chainSafe) {
        await recoverNonce(chainSafe);
        const saved = savedNonce();
        if (saved !== undefined) {
          const live = await liveNonce(chainSafe);
          nonceUsed = nonceUsed || (live !== null && live > saved);
        }
      }
      if (
        chainSafe &&
        (tracked()?.safeExecutionProven || nonceUsed || passedNonce !== undefined) &&
        (await settledFromChain(chainSafe))
      )
        return;
      // Over WalletConnect, Safe{Wallet} replies with the execution's own hash
      // when the owner executes at once. A safeTxHash is never a transaction.
      // The SDK then reads the Safe's one execution event in that receipt,
      // whatever its hash, so the execution must run the reviewed calls. The
      // chain is checked on every look of the minute after the reply, when such
      // an execution lands, then once a minute for a node that shows it late.
      const execution: ChainAnswer | "unchecked" =
        client && (attempt < SAFE_EXECUTION_CHECKS || attempt % SAFE_EXECUTION_CHECKS === 0)
          ? await findExecution(client)
          : "unchecked";
      if (execution && execution !== "unchecked") {
        if (executesReviewed(execution)) {
          await settle(hash);
        } else unconfirmed();
        return;
      }
      const safe = safeOf();
      let look: SafeLook;
      if (service) look = safe ? await askService(safe) : "stuck";
      // Without a Safe service only a check the chain answered shows anything.
      else look = execution === null ? "stuck" : "unknown";
      if (look === "done") return;
      if (look === "stuck") stuckLooks += 1;
      else if (look === "live") {
        stuckLooks = 0;
        awaitingChain = false;
      }
      // Without a service, twelve checks that find nothing end it. With one, what the app still
      // can't follow an hour after the proposal was made, it never will. It ends on this look's
      // check of the chain, or one more, and while the node can't answer, only the next chain
      // check asks again.
      const due =
        !proven() &&
        !nonceUsed &&
        (unfollowable || (stuckLooks >= stuckFor && (!service || pastHorizon())));
      if (due && (execution !== "unchecked" || !awaitingChain)) {
        if (await endUnconfirmed(execution)) return;
        awaitingChain = true;
      }
      await new Promise((resolve) => window.setTimeout(resolve, SAFE_LOOK_MS));
    }
    // The watch gives up. A proposal still awaiting approvals, one the watch learned nothing
    // about, one not stuck for long enough, or one the node couldn't answer for is followed again
    // on the next load; anything else ends unconfirmed.
    if (!awaitingChain && (unfollowable || stuckLooks >= stuckFor)) {
      await endUnconfirmed("unchecked");
    }
  })();
  safeInflight.set(id, request);
  void request.finally(() => safeInflight.delete(id)).catch(() => undefined);
  return request;
}

/**
 * The Safe transaction a new proposal's reply hashes to, found from the Safe's nonce read right
 * before the wallet: the hold keeps its nonce, so the chain can prove its end without the Safe
 * service.
 */
function proposedAt(
  chainId: number,
  proposal: ReviewedSafeProposal,
  hash: Hex,
  nonceBefore: bigint | null,
) {
  return nonceBefore === null
    ? undefined
    : safeProposalAt(
        chainId,
        proposal,
        hash,
        nonceBefore,
        nonceBefore + BigInt(NONCE_SEARCH_AHEAD),
      );
}

/**
 * Moves a Safe proposal journaled before the SDK's hold held it into that hold, with its saved
 * hash and nonce, so the hold settles it and only its exit sends it again: one still followed, one
 * the app can't confirm, or one another transaction replaced.
 */
function heldBeforeTheHold(row: TransactionActivity): boolean {
  if (row.kind !== "safe" || row.sdkHeld || !row.hash || !row.chainId || !row.safeProposal)
    return false;
  const replaced = row.status === "failed" && row.message === SAFE_PROPOSAL_REPLACED_LINE;
  return row.status === "safe-proposed" || replaced;
}

async function holdLegacySafeProposal(row: TransactionActivity, client: WriteHoldClient) {
  const { hash, chainId, safeProposal } = row;
  if (!heldBeforeTheHold(row) || !hash || !chainId || !safeProposal) return;
  const nonce =
    row.safeProposalNonce && /^\d+$/.test(row.safeProposalNonce)
      ? BigInt(row.safeProposalNonce)
      : undefined;
  const hold = safeHoldOf(chainId, safeProposal);
  const proposal =
    nonce === undefined ? undefined : safeProposalAt(chainId, safeProposal, hash, nonce, nonce);
  if (!(await adoptIntoHold(hold, client, hash, proposal))) return;
  updateTransactionActivity(row.id, { sdkHeld: true });
  if (row.safeResultUnconfirmed) await hold.onUnproven(client, hash).catch(() => undefined);
}

/**
 * Whether the SDK's hold, which held this call before the send, decides over a journaled Safe
 * proposal of it: the journal never refuses on its own while the hold holds the call. The hold
 * refuses while the proposal may still run and offers its warned exit when one is due.
 */
function holdDecides(duplicate: { status: string }, heldBefore: boolean) {
  return heldBefore && duplicate.status === "safe-proposed";
}

/**
 * The hold let this send through, on the user's exit or on authenticated evidence: the journaled
 * proposal it replaces stops refusing. One the app can't confirm leaves the journal; one still
 * followed stays as history, released, and its watch may still settle it.
 */
function releaseJournaledProposal(duplicate: TransactionActivity) {
  if (duplicate.safeResultUnconfirmed) dismissTransactionActivity(duplicate.id);
  else updateTransactionActivity(duplicate.id, { status: "failed", message: RELEASED_LINE });
}

/** A released proposal: nothing is sent until a new submission exists (see followSubmission). */
const RELEASED_LINE = "Released.";
const RESENT_LINE = "Released. You sent this again.";

/**
 * Before a Safe send under its hold: a journaled proposal of the call that still awaits the Safe
 * refuses it, as before. One the app can't confirm refuses it too when the hold never held it (a
 * proposal saved before the hold did); when it does, the hold is told its watch ended unproven, so
 * it offers the exit. Returns whether the hold held the call.
 */
async function refuseUnheldSafeDuplicate(
  callKey: string,
  duplicateOf: () => ReturnType<typeof transactionActivityForHash>,
  hold: WriteHoldHandle,
  client: WriteHoldClient,
): Promise<boolean> {
  for (const row of refreshTransactionActivities().filter((row) => row.callKey === callKey))
    await holdLegacySafeProposal(row, client);
  const duplicate = duplicateOf();
  let held: boolean;
  try {
    held = hold.peek().status !== "clear";
  } catch {
    // A record that can't be read is the hold's to answer.
    held = true;
  }
  if (!duplicate?.hash || duplicate.status !== "safe-proposed") return held;
  // The journal knows the proposal's Safe nonce: the hold, which authenticates it, takes it too,
  // so it can tell when that nonce is used.
  if (
    held &&
    duplicate.safeProposalNonce !== undefined &&
    /^\d+$/.test(duplicate.safeProposalNonce)
  )
    await hold
      .attachSafeNonce(client, {
        safeTxHash: duplicate.hash,
        nonce: Number(duplicate.safeProposalNonce),
      })
      .catch(() => undefined);
  if (!holdDecides(duplicate, held)) {
    throw new SafeProposalPendingError(duplicate.hash, duplicate.safeResultUnconfirmed);
  }
  // A proposal its watch ended unproven: the hold offers the exit at once.
  if (duplicate.safeResultUnconfirmed)
    await hold.onUnproven(client, duplicate.hash).catch(() => undefined);
  return held;
}

/**
 * A Safe connection can take a whole flow as ONE proposal: the Safe app folds
 * `wallet_sendCalls` into a MultiSend, so signers approve once and the calls
 * execute together, in order. Reviewed as one request; tracked like any other
 * Safe proposal.
 */
export async function proposeSafeBatch(
  config: ReturnType<typeof useConfig>,
  chainId: number,
  title: string,
  calls: readonly (Omit<ContractTransactionReviewCall, "chainId" | "account" | "safeTxGas"> & {
    /** Needs an earlier call's effect (an allowance), so it cannot simulate alone. */
    dependsOnPrior?: boolean;
  })[],
  /** The account the calls were built for, when they name one (a mint's recipient). */
  plannedAccount?: Address,
  /** The user action the batch is, as an SDK intent; without one it's held by its exact calls. */
  intent?: string,
): Promise<Hex> {
  requireNoViewAs();
  const account = getAccount(config).address;
  if (!account) throw new Error("Connect a wallet first.");
  requirePlannedAccount(plannedAccount, account);
  if (!isSafeConnection(config)) {
    throw new Error("A batch can only be proposed through a Safe connection.");
  }
  const requireWalletContext = captureReviewedWalletContext(
    config,
    account,
    "Connected account or chain changed. Review the transaction again.",
  );
  const encoded = calls.map((call) => ({
    to: call.address,
    value: call.value,
    data: encodeFunctionData({ abi: call.abi, functionName: call.functionName, args: call.args }),
  }));
  const callKey = `batch:${account.toLowerCase()}:${chainId}:${keccak256(
    stringToHex(encoded.map((call) => `${call.to}:${call.value ?? 0n}:${call.data}`).join("|")),
  )}`;
  // REMOVE with legacy-intents.ts: the previous build held every batch by its batch namespace;
  // an intent's batch is held by it too, and a batch with none keeps it.
  const previous = legacyBatchNamespace(calls);
  const proposal: ReviewedSafeProposal = {
    safe: account,
    calls: encoded.map((call) => ({ ...call, value: String(call.value ?? 0n) })),
    batch: true,
    holdNamespace: intent ?? previous,
    ...(intent ? { legacyNamespaces: [previous] } : {}),
  };
  const publicClient = getPublicClient(config, { chainId });
  if (!publicClient) throw new Error(`No RPC client is configured for chain ${chainId}.`);
  // The batch is held by the SDK's write hold, as one proposal, until its watch or the chain
  // shows how it ended, or the user takes the hold's exit.
  const hold = safeHoldOf(chainId, proposal);
  const duplicateOf = () =>
    refreshTransactionActivities().find(
      (activity) =>
        activity.callKey === callKey &&
        (activity.status === "submitted" ||
          activity.status === "pending" ||
          activity.status === "safe-proposed"),
    );
  const heldBefore = await refuseUnheldSafeDuplicate(callKey, duplicateOf, hold, publicClient);
  const submit = async (gate: WriteHoldGate) => {
    const duplicate = duplicateOf();
    if (duplicate?.hash && holdDecides(duplicate, heldBefore)) {
      releaseJournaledProposal(duplicate);
    } else if (duplicate?.hash) {
      throw new SafeProposalPendingError(duplicate.hash, duplicate.safeResultUnconfirmed);
    }

    // The calls depend on each other (an allowance, then the spend), so the
    // SDK simulates them as one sequence where the RPC offers eth_simulateV1,
    // and otherwise each standalone call on its own, leaving a dependent one to
    // Safe's batch simulation before signing. Only a node that lacks the method
    // takes the fallback; a revert or a lagging node stops the proposal.
    await simulateCallSequence(publicClient, {
      from: account,
      chainName: publicClient.chain?.name ?? `chain ${chainId}`,
      calls: encoded.map((call, index) => ({
        to: call.to,
        data: call.data,
        value: call.value,
        label: `${calls[index]!.functionName} (step ${index + 1})`,
        dependsOnPrior: calls[index]!.dependsOnPrior,
      })),
    });

    await requireTransactionReview({
      calls: encoded.map((call, index) => ({
        chainId,
        from: account,
        abi: calls[index]!.abi,
        functionName: calls[index]!.functionName,
        args: calls[index]!.args,
        label: calls[index]!.functionName,
        ...call,
      })),
      title,
      confirmLabel: "Agree & propose to Safe",
      description: [
        `These ${calls.length} calls go to Safe as one batch that executes together, in this order, once the Safe's approvals are in.`,
        SAFE_NONCE_GUIDANCE,
        writeHolds.reviewLine(),
      ]
        .filter(Boolean)
        .join("\n\n"),
    });
    requireWalletContext();
    if (getAccount(config).chainId !== chainId) {
      await switchChain(config, { chainId } as Parameters<typeof switchChain>[1]);
    }
    requireWalletContext(chainId);
    const nonceBefore = await readBoundedSafeNonce(publicClient, account).catch(() => null);
    await gate.beforeSend();
    let id: string;
    try {
      ({ id } = await sendCalls(config, { chainId, calls: encoded }));
    } catch (error) {
      // Only the wallet's explicit refusal proves nothing was proposed.
      if (isDefiniteWalletRejection(error)) gate.onRejected();
      throw error;
    }
    const hash = id as Hex;
    gate.afterSubmit(hash, proposedAt(chainId, proposal, hash, nonceBefore));
    followSubmission(config, hash, chainId, title, account, callKey, proposal, false);
    return hash;
  };
  return sendUnderHold(hold, publicClient, submit);
}

export function resumeSafeProposalTracking(config: ReturnType<typeof useConfig>): void {
  for (const row of transactionActivitySnapshot()) {
    const client = row.chainId ? getPublicClient(config, { chainId: row.chainId }) : undefined;
    // A proposal journaled before the hold held it moves into the hold first; only then does its
    // watch report to the hold, so the two never contend for its lock.
    const watch = () =>
      watchSafeProposal(row.id, row.hash!, row.chainId!, client as PublicClient | undefined);
    const watched =
      row.status === "safe-proposed" && !row.safeResultUnconfirmed && row.hash && row.chainId;
    // One its follower handed to the hold is the hold's to decide, through reloads.
    if (row.holdFollows && row.status === "safe-proposed" && row.hash && row.chainId)
      void holdUntilResolved(row.id, row.chainId, client as PublicClient | undefined, {
        unproven: false,
        executionHash: row.executionHash,
      });
    else if (client && heldBeforeTheHold(row)) {
      const adopted = holdLegacySafeProposal(row, client).catch(() => undefined);
      if (watched) void adopted.then(watch);
    } else if (watched) void watch();
  }
}

/**
 * Journal a submitted write and follow it to its result. `safe` is what a Safe proposal was
 * reviewed to run, or false for a transaction the wallet sent.
 */
export function followSubmission(
  config: ReturnType<typeof useConfig>,
  hash: Hex,
  chainId: number,
  title: string,
  account: Address,
  callKey: string,
  safe: ReviewedSafeProposal | false,
  manualReceiptVerification: boolean,
  /**
   * A sent write's receipt landed, whatever its status. A write whose caller verifies its own
   * receipt is released on its next send instead, once the chain shows it mined.
   */
  onReceipt?: (receipt: TransactionReceipt) => Promise<unknown>,
): void {
  const id = `tx:${chainId}:${hash.toLowerCase()}`;
  // Only now, with a new submission, was a released proposal of this call sent again.
  for (const row of refreshTransactionActivities())
    if (row.callKey === callKey && row.message === RELEASED_LINE)
      updateTransactionActivity(row.id, { message: RESENT_LINE });
  recordTransactionActivity({
    id,
    kind: safe ? "safe" : "direct",
    title,
    status: safe ? "safe-proposed" : "submitted",
    message: safe
      ? SAFE_PROPOSAL_AWAITING
      : "Wallet submission accepted. Waiting for an onchain receipt.",
    chainId,
    account,
    hash,
    safeProposalHash: safe ? hash : undefined,
    safeProposal: safe || undefined,
    // Held by the SDK's write hold from the send; an unmarked one is moved into it on load.
    sdkHeld: safe ? true : undefined,
    callKey,
    manualVerificationRequired: manualReceiptVerification || undefined,
  });
  if (manualReceiptVerification && !safe) {
    updateTransactionActivity(id, {
      status: "pending",
      message: "Pending action-specific receipt verification.",
    });
    return;
  }
  const publicClient = getPublicClient(config, { chainId });
  if (safe) {
    void watchSafeProposal(id, hash, chainId, publicClient);
    return;
  }
  updateTransactionActivity(id, { status: "pending", message: "Pending onchain confirmation." });
  if (!publicClient) return;
  void waitForReceiptWithRetry(publicClient, hash)
    .then((receipt) => {
      void onReceipt?.(receipt).catch(() => undefined);
      updateTransactionActivity(id, {
        status: receipt.status === "success" ? "success" : "failed",
        message:
          receipt.status === "success"
            ? "Confirmed onchain."
            : "The transaction was mined but reverted. Its intended state changes did not occur.",
      });
    })
    .catch(() => {
      updateTransactionActivity(id, {
        status: "pending",
        message: RECEIPT_UNCONFIRMED,
      });
    });
}

type ReviewedWriteContractOptions = Parameters<typeof useWagmiWriteContract>[0] & {
  transactionReview?: TransactionReviewOptions;
  /**
   * The exact call is already visible in a parent confirmation dialog. This
   * skips only the duplicate app review; duplicate detection, account checks,
   * revalidation, simulation, wallet confirmation, and receipt tracking stay
   * mandatory.
   */
  reviewedInParent?: boolean;
  /**
   * "caller": the caller's own journal holds this write's unknown results (a
   * multichain batch), so the SDK's ordinary write hold is not added.
   */
  recovery?: "caller";
  /** Persist caller-specific recovery immediately before the wallet broadcast boundary. */
  beforeSubmission?: () => Promise<void>;
  /** The shared final gate refused after persistence, before the wallet writer was invoked. */
  onBeforeSubmissionAborted?: () => Promise<void>;
  /** The wallet writer definitively rejected before broadcasting; ambiguous errors do not enter here. */
  onSubmissionRejected?: () => Promise<void>;
  /** A batch verifier reconstructs the exact Safe execution before releasing child activity. */
  allowSafeManualReceiptVerification?: boolean;
  reverify?: (
    variables: Parameters<ReturnType<typeof useWagmiWriteContract>["writeContractAsync"]>[0],
    account: Address,
  ) => Promise<void>;
  /**
   * Optional exact raw preflight for calls where Viem's generic simulation
   * semantics are not equivalent to a real transaction (notably ENS CCIP).
   */
  preflightSimulation?: (
    variables: Parameters<ReturnType<typeof useWagmiWriteContract>["writeContractAsync"]>[0],
    account: Address,
  ) => Promise<{ gas: bigint } | void>;
  /** Keep generic receipt success pending until the caller releases its exact postcondition. */
  manualReceiptVerification?: (
    variables: Parameters<ReturnType<typeof useWagmiWriteContract>["writeContractAsync"]>[0],
  ) => boolean;
};

export function useWriteContract(
  options?: ReviewedWriteContractOptions,
): ReturnType<typeof useWagmiWriteContract> {
  const config = useConfig();
  const queryClient = useQueryClient();
  const {
    transactionReview,
    reviewedInParent,
    recovery,
    beforeSubmission,
    onBeforeSubmissionAborted,
    onSubmissionRejected,
    allowSafeManualReceiptVerification,
    reverify,
    preflightSimulation,
    manualReceiptVerification,
    ...wagmiOptions
  } = options ?? {};
  const mutation = useWagmiWriteContract(wagmiOptions);

  const writeContractAsync = useCallback(
    async (variables: Parameters<typeof mutation.writeContractAsync>[0]) => {
      requireNoViewAs();
      // Every call names its chain. The wallet is switched to that chain after
      // review; a call without one would go to whichever chain the wallet is on.
      const chainId = Number(variables.chainId);
      if (!chainId) throw new Error("This transaction names no chain. Nothing was sent.");
      const before = getAccount(config);
      if (!before.address) throw new Error("Connect a wallet first.");
      // `account` names the account the call was built for. Every check below
      // binds the send to the account connected now, so the two must agree.
      requirePlannedAccount(variables.account, before.address);
      const initialAddress = before.address;
      const requireWalletContext = captureReviewedWalletContext(
        config,
        initialAddress,
        ACCOUNT_CHANGED,
        "The wallet chain changed. Review the transaction again.",
      );
      const functionName = String(variables.functionName);
      const data = encodeFunctionData({
        abi: variables.abi as Abi,
        functionName,
        args: variables.args,
      });
      const callKey = contractTransactionKey(initialAddress, chainId, { ...variables, data });
      const safe = isSafeConnection(config);
      // Held by the user's intent where a retry stamps its calldata again, else by its exact call.
      // REMOVE with legacy-intents.ts: the previous build's namespaces for it hold it too, and a
      // write no SDK builder names keeps the one it had.
      const previous = [
        ...legacyIntentsOf(variables),
        // An approval only sets an allowance, so no old key holds it.
        functionName === "approve"
          ? undefined
          : legacyCallNamespace(variables as Parameters<typeof legacyCallNamespace>[0]),
      ].filter((name): name is string => !!name);
      const namespace = writeIntentOf(variables) ?? previous[0];
      const legacyNamespaces = previous.filter((name) => name !== namespace);
      const safeProposal: ReviewedSafeProposal | false = safe && {
        safe: initialAddress,
        calls: [{ to: variables.address, value: String(variables.value ?? 0n), data }],
        batch: false,
        ...(namespace ? { holdNamespace: namespace } : {}),
        ...(legacyNamespaces.length ? { legacyNamespaces } : {}),
      };
      // A wallet write holds its exact call in the SDK's write hold until the chain shows what
      // happened to it, or the user says they checked their wallet; a Safe proposal is held by
      // what it was reviewed to run, and its watch tells the hold how it ended. A caller with its
      // own journal holds its own.
      const hold =
        recovery === "caller"
          ? undefined
          : safeProposal
            ? safeHoldOf(chainId, safeProposal)
            : writeHolds.open(
                {
                  chainId,
                  account: initialAddress,
                  safe: false,
                  ...(namespace ? { namespace } : {}),
                  call: { to: variables.address, data, value: variables.value ?? 0n },
                },
                // A write held by intent is held, through the SDK, by the exact-calldata holds an
                // earlier build left (#79), whatever calldata a retry regenerates.
                namespace
                  ? {
                      legacy: legacyOf(
                        { to: variables.address, data, value: variables.value ?? 0n },
                        legacyNamespaces,
                      ),
                    }
                  : undefined,
              );
      const holdClient = hold ? getPublicClient(config, { chainId }) : undefined;
      const duplicateOf = () =>
        refreshTransactionActivities().find(
          (activity) =>
            activity.callKey === callKey &&
            (activity.manualVerificationRequired === true || activity.status === "safe-proposed"),
        );
      /** Whether the hold held this call before the send: its own answer then decides. */
      let heldBefore = false;
      /** The Safe's nonce read right before the wallet, where a new proposal's own nonce starts. */
      let safeNonceBefore: bigint | null = null;
      const submitReviewedCall = async (gate?: WriteHoldGate) => {
        const duplicate = duplicateOf();
        if (duplicate?.hash && holdDecides(duplicate, heldBefore)) {
          releaseJournaledProposal(duplicate);
        } else if (duplicate?.hash) {
          if (duplicate.status === "safe-proposed") {
            throw new SafeProposalPendingError(duplicate.hash, duplicate.safeResultUnconfirmed);
          }
          throw new Error(
            `An identical ${functionName} transaction is already pending as ${duplicate.hash}. Check it before submitting again.`,
          );
        }
        const ownsReceiptLifecycle = manualReceiptVerification?.(variables) === true;
        if (safe && ownsReceiptLifecycle && !allowSafeManualReceiptVerification) {
          throw new Error(
            "This execution requires exact onchain result verification and cannot be proposed through a Safe connector. Connect an EOA owner of the executing Safe.",
          );
        }
        // A bounded preflight fixes the gas before review, so the review shows it.
        const reviewedGas = preflightSimulation && !safe ? variables.gas : undefined;
        const review = async () => {
          if (!reviewedInParent) {
            await requireContractTransactionReview(
              {
                chainId,
                address: variables.address,
                abi: variables.abi as Abi,
                functionName,
                args: variables.args,
                value: variables.value,
                gas: reviewedGas,
                account: initialAddress,
                safeTxGas: safe ? 0n : undefined,
              },
              {
                title: `Review ${functionName}`,
                label: functionName,
                ...transactionReview,
                confirmLabel: safe
                  ? "Agree & propose to Safe"
                  : (transactionReview?.confirmLabel ?? "Agree & continue"),
                description:
                  [
                    transactionReview?.description,
                    safe ? SAFE_NONCE_GUIDANCE : undefined,
                    hold ? writeHolds.reviewLine() : undefined,
                  ]
                    .filter(Boolean)
                    .join("\n\n") || undefined,
              },
            );
          }
        };
        const simulate = async (reviewedAccount: Address) => {
          const boundedPreflight = preflightSimulation
            ? await preflightSimulation(variables, reviewedAccount)
            : undefined;
          const simulation = preflightSimulation
            ? { request: { ...variables, chainId, account: reviewedAccount } }
            : await simulateContract(config, {
                ...variables,
                chainId,
                account: reviewedAccount,
              } as Parameters<typeof simulateContract>[1]);
          const publicClient = getPublicClient(config, { chainId });
          if (!publicClient) throw new Error(`No RPC client is configured for chain ${chainId}.`);
          const estimateRequest = {
            ...variables,
            gas: undefined,
            account: reviewedAccount,
          };
          const estimate = boundedPreflight?.gas
            ? boundedPreflight.gas
            : await publicClient.estimateContractGas(
                estimateRequest as Parameters<typeof publicClient.estimateContractGas>[0],
              );
          // Safe Apps maps the Ethereum gas field directly to Safe's signed
          // safeTxGas. Keep its canonical envelope at zero and let Safe estimate
          // execution gas; the bounded preflight above remains mandatory.
          const gas = safe ? 0n : (boundedPreflight?.gas ?? gasWithHeadroom(estimate));
          if (reviewedGas !== undefined && gas !== reviewedGas) {
            throw new Error(
              "The gas limit changed after review. Nothing was sent; review it again.",
            );
          }
          return { ...simulation.request, gas };
        };
        // Connector identity matters even when both wallets are ordinary EOAs.
        // Refuse known context drift before journaling, and at the shared final gate.
        const assertWalletContext = () => requireWalletContext(chainId);
        const hash = await submitReviewedContractWrite({
          request: variables as typeof variables & { chainId: number },
          expectedAccount: initialAddress,
          guard: requireNoViewAs,
          accountChangedError: ACCOUNT_CHANGED,
          review,
          switchChain: async () => {
            // Refuse changed review identity before even opening a switch prompt.
            requireWalletContext();
            if (getAccount(config).address?.toLowerCase() !== initialAddress.toLowerCase()) {
              throw new Error(ACCOUNT_CHANGED);
            }
            if (getAccount(config).chainId !== chainId) {
              try {
                await switchChain(config, { chainId } as Parameters<typeof switchChain>[1]);
              } catch {
                const target = config.chains.find((chain) => chain.id === chainId)?.name;
                throw new Error(
                  `Switch your wallet to ${target ?? `chain ${chainId}`} to continue.`,
                );
              }
            }
            assertWalletContext();
          },
          currentAccount: () => getAccount(config).address,
          reverify: async () => {
            await reverify?.(variables, initialAddress);
            assertWalletContext();
          },
          simulate: async () => {
            const prepared = await simulate(initialAddress);
            assertWalletContext();
            return prepared;
          },
          beforeWrite: async () => {
            if (safeProposal && holdClient)
              safeNonceBefore = await readBoundedSafeNonce(
                holdClient as PublicClient,
                initialAddress,
              ).catch(() => null);
            await gate?.beforeSend();
            try {
              await beforeSubmission?.();
            } catch (error) {
              gate?.onRejected();
              throw error;
            }
          },
          onBeforeWriteAborted: async () => {
            gate?.onRejected();
            await onBeforeSubmissionAborted?.();
          },
          onWriteRejected: async () => {
            gate?.onRejected();
            await onSubmissionRejected?.();
          },
          onWriteSubmitted: (sent: Hex) =>
            gate?.afterSubmit(
              sent,
              safeProposal ? proposedAt(chainId, safeProposal, sent, safeNonceBefore) : undefined,
            ),
          beforeSend: assertWalletContext,
          write: (prepared) =>
            mutation.writeContractAsync(
              prepared as Parameters<typeof mutation.writeContractAsync>[0],
            ),
        });
        if (hold && holdClient && !safe) rememberHold(hash, hold, holdClient);
        followSubmission(
          config,
          hash,
          chainId,
          functionName,
          initialAddress,
          callKey,
          safeProposal,
          ownsReceiptLifecycle,
          hold && holdClient && !safe
            ? (receipt) => hold.onReceipt(receipt, holdClient)
            : undefined,
        );
        return hash;
      };

      // Serialize identical submissions across same-origin tabs. The duplicate
      // check runs after the lock is acquired and refreshes persisted activity,
      // so a second tab cannot open another wallet prompt while the first is in
      // review or waiting for its Safe proposal hash.
      // Without a client for the chain the simulation refuses before any wallet opens.
      if (hold && holdClient) {
        heldBefore = await refuseUnheldSafeDuplicate(callKey, duplicateOf, hold, holdClient);
        return sendUnderHold(hold, holdClient, submitReviewedCall);
      }
      return browserLocks().request(
        `revnet:transaction:${keccak256(stringToHex(callKey))}`,
        { mode: "exclusive" },
        () => submitReviewedCall(),
      ) as Promise<Hex>;
    },
    [
      config,
      recovery,
      manualReceiptVerification,
      mutation,
      preflightSimulation,
      reviewedInParent,
      reverify,
      beforeSubmission,
      onBeforeSubmissionAborted,
      onSubmissionRejected,
      allowSafeManualReceiptVerification,
      transactionReview,
    ],
  );

  const writeContract = useCallback(
    (
      variables: Parameters<typeof mutation.writeContract>[0],
      callbacks?: Parameters<typeof mutation.writeContract>[1],
    ) => {
      const context = {
        client: queryClient,
        meta: wagmiOptions.mutation?.meta,
        mutationKey: ["writeContract"] as const,
      };
      void writeContractAsync(variables as Parameters<typeof mutation.writeContractAsync>[0]).then(
        (hash) => {
          callbacks?.onSuccess?.(hash, variables, undefined, context);
          callbacks?.onSettled?.(hash, null, variables, undefined, context);
        },
        (error) => {
          callbacks?.onError?.(error, variables, undefined, context);
          callbacks?.onSettled?.(undefined, error, variables, undefined, context);
        },
      );
    },
    [mutation, queryClient, wagmiOptions.mutation?.meta, writeContractAsync],
  );

  return { ...mutation, writeContractAsync, writeContract } as ReturnType<
    typeof useWagmiWriteContract
  >;
}

export function useWaitForTransactionReceipt(
  parameters: Parameters<typeof useWagmiWaitForTransactionReceipt>[0] = {},
) {
  const activities = useTransactionActivities();
  const hash = parameters.hash as Hex | undefined;
  // A write not yet sent has no hash; a hashless row (a multichain batch) is not its result.
  const tracked = useMemo(
    () =>
      hash ? activities.find((row) => row.hash?.toLowerCase() === hash.toLowerCase()) : undefined,
    [activities, hash],
  );
  const isSafeSubmission = tracked?.kind === "safe";
  const isSafeProposal = tracked?.status === "safe-proposed";
  // A proposal whose result can't be confirmed awaits nothing the app follows: not loading.
  const isSafeResultUnconfirmed = isSafeSubmission && tracked?.safeResultUnconfirmed === true;
  const trackedDirectSuccess = tracked?.kind === "direct" && tracked.status === "success";
  const trackedDirectFailure = tracked?.kind === "direct" && tracked.status === "failed";
  const query = useWagmiWaitForTransactionReceipt({
    ...parameters,
    // A tracked send is watched on the chain it went to, whatever the caller's
    // form shows by now; an untracked hash on the chain the caller names.
    chainId: tracked?.chainId ?? parameters.chainId,
    query: {
      ...parameters.query,
      enabled: (parameters.query?.enabled ?? true) && !!hash && !isSafeSubmission,
      // A bounded watch ends at its timeout. The app's retry would wait the
      // whole bound again.
      ...(parameters.timeout ? { retry: false } : {}),
    },
  });
  const receipt = query.data as TransactionReceipt | undefined;
  const reverted = receipt?.status === "reverted";
  const isSuccess = isSafeSubmission
    ? tracked?.status === "success"
    : trackedDirectSuccess || (query.isSuccess && receipt?.status === "success");
  const watchedIsError = isSafeSubmission
    ? tracked?.status === "failed"
    : trackedDirectFailure || reverted || (!tracked && query.isError);
  // The watch ended, at its timeout or on a node failure, with no receipt and no tracked outcome.
  const watchGaveUp =
    Boolean(hash) && !isSafeSubmission && query.isError && !isSuccess && !watchedIsError;
  // It may still land: the hold it was sent under is watched from here, so its line shows, an
  // exit that becomes due with time appears, and a receipt it finds settles it.
  const sentUnder = watchGaveUp ? holdOfHash(hash) : undefined;
  /** A state of the reservation this hash was sent under, not a later attempt's. */
  const ownReservation = (state: WriteHoldState) =>
    !state.reservation || !sentUnder?.reservation || state.reservation === sentUnder.reservation;
  /** A settlement of this observer's own hash: another attempt of the same call settles itself. */
  const settlesThis = (
    state: WriteHoldState,
  ): state is { status: "clear"; settled: { result: "success" | "failed"; hash: Hex } } =>
    state.status === "clear" &&
    ownReservation(state) &&
    !!state.settled &&
    "hash" in state.settled &&
    state.settled.hash.toLowerCase() === hash?.toLowerCase();
  const watchedHold = sentUnder?.hold;
  const [shown, setShown] = useState<{ hold: WriteHoldHandle; state: WriteHoldState }>();
  const heldState = watchedHold && shown?.hold === watchedHold ? shown.state : undefined;
  useWriteHoldWatch(
    watchedHold,
    sentUnder?.client,
    (state) => {
      // Only the hold's gate, its own state(), offers an exit (SDK 2.34.1); another attempt's
      // reservation is not this hash's.
      if (!watchedHold || (state.status !== "clear" && !ownReservation(state))) return;
      setShown({ hold: watchedHold, state });
      if (settlesThis(state) && tracked) {
        updateTransactionActivity(tracked.id, {
          status: state.settled.result === "success" ? "success" : "failed",
          message:
            state.settled.result === "success" ? "Confirmed onchain." : WRITE_HOLD_REVERTED_LINE,
        });
      }
    },
    { checkNow: true },
  );
  const settled = heldState && settlesThis(heldState) ? heldState.settled : undefined;
  const held = heldState && heldState.status !== "clear" ? heldState : undefined;
  const heldFailed = settled?.result === "failed";
  const isError = watchedIsError || heldFailed;
  return {
    ...query,
    isLoading: isSafeSubmission ? isSafeProposal && !isSafeResultUnconfirmed : query.isLoading,
    isSuccess: isSuccess || settled?.result === "success",
    isError,
    /**
     * A direct send whose watch ended with no receipt and no tracked outcome. It may still land,
     * so its action stays locked, until its hold offers the exit or ends. (A Safe proposal whose
     * result can't be confirmed is `isSafeResultUnconfirmed`.)
     */
    isUnconfirmed: watchGaveUp && heldState?.status !== "clear" && !held?.exit,
    /** The line of the hold that send is held by, while its watch has given up. */
    heldLine: held ? [held.line, heldState?.notice].filter(Boolean).join(" ") : undefined,
    error:
      isSafeSubmission && tracked?.status === "failed"
        ? new Error(tracked.message)
        : trackedDirectFailure
          ? new Error(tracked.message)
          : reverted
            ? new Error(`Transaction ${hash} reverted onchain.`)
            : heldFailed
              ? new Error(WRITE_HOLD_REVERTED_LINE)
              : !tracked
                ? query.error
                : undefined,
    isSafeProposal,
    isSafeResultUnconfirmed,
    statusMessage: tracked?.message,
  };
}

export function submittedViaSafe(hash?: Hex): boolean {
  return transactionActivityForHash(hash)?.status === "safe-proposed";
}

/** The title a flow gives a step refused by a Safe proposal whose result can't be confirmed. */
export const SAFE_PROPOSAL_UNCONFIRMED_TITLE = "Safe proposal unconfirmed";

/** The status line a flow shows for that step. */
export const SAFE_PROPOSAL_UNCONFIRMED_LINE =
  "Check this proposal in your Safe before sending it again.";

/** Refuses a call while its Safe proposal is journaled and not yet settled. */
export class SafeProposalPendingError extends Error {
  readonly name = "SafeProposalPendingError";

  /** `unconfirmed`: the app can't confirm the proposal's result, so its account dismisses it. */
  constructor(
    readonly hash: Hex,
    readonly unconfirmed = false,
  ) {
    super(
      unconfirmed
        ? SAFE_PROPOSAL_UNCONFIRMED_LINE
        : "This proposal is waiting in your Safe. Finish it there first.",
    );
  }
}

/**
 * Whether `error` refused a call because its Safe proposal still awaits the Safe. A proposal whose
 * result can't be confirmed awaits nothing the app can follow: callers show that refusal as they
 * show any error, with its line to check it in Safe and dismiss it.
 */
export function isSafeProposalPendingError(error: unknown): error is SafeProposalPendingError {
  return error instanceof SafeProposalPendingError && !error.unconfirmed;
}

/** Whether `error` refused a call because its Safe proposal's result can't be confirmed. */
export function isSafeProposalUnconfirmedError(error: unknown): error is SafeProposalPendingError {
  return error instanceof SafeProposalPendingError && error.unconfirmed;
}

/** Stop dependent steps after a Safe connector returns an asynchronous proposal hash. */
export function requireOnchainExecution(hash: Hex): void {
  if (!submittedViaSafe(hash)) return;
  throw new SafeProposalPendingError(hash, transactionActivityForHash(hash)?.safeResultUnconfirmed);
}
