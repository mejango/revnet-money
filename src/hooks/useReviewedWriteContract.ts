"use client";

import { readMultichainBatches } from "@/lib/multichain-batch";
import { captureReviewedWalletContext } from "@/lib/reviewed-wallet-context";
import { isSafeConnection } from "@/lib/safe-connector";
import { safeTransactionRunsCalls, type ReviewedSafeProposal } from "@/lib/safe-transactions";
import {
  contractTransactionKey,
  contractTransactionScope,
  recordTransactionActivity,
  refreshTransactionActivities,
  removeUnsentTransactionActivity,
  requireTransactionActivityPersistence,
  reserveTransactionActivity,
  submitTransactionActivity,
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
  gasWithHeadroom,
  simulateCallSequence,
  submitReviewedContractWrite,
  verifyReviewedWriteReceipt,
} from "@bananapus/nana-sdk-core/review";
import { readAuthorityIdentity, readBoundedSafeNonce } from "@bananapus/nana-sdk-core/safe";
import {
  hasSafeService,
  readSafeTransaction,
  SAFE_NONCE_GUIDANCE,
  safeExecutionResult,
  safeExecutionRunsCalls,
  safeTransactionMessage,
  usableSafeConfirmations,
  type SafeQueuedTransaction,
} from "@bananapus/nana-sdk-core/safe-service";
import { useQueryClient } from "@tanstack/react-query";
import { sendCalls } from "@wagmi/core";
import { useCallback, useEffect, useMemo, useRef } from "react";
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
const UNKNOWN_WRITE =
  "The wallet result is unknown. This action remains locked; do not submit it again. Keep this browser's recovery data.";

function reserveWalletWrite(
  chainId: number,
  account: Address,
  title: string,
  callKey: string,
  calls: readonly { to: Address; data: Hex; value?: bigint | string }[],
  safe: ReviewedSafeProposal | false,
): TransactionActivity {
  const id = `write:${crypto.randomUUID()}`;
  const call = calls[0];
  if (!call) throw new Error("The reviewed write contains no calls.");
  return reserveTransactionActivity({
    id,
    kind: safe ? "safe" : "direct",
    title,
    status: "pending",
    message: UNKNOWN_WRITE,
    chainId,
    account,
    callKey,
    safeProposal: safe || undefined,
    writeScopes: calls.map((call) =>
      contractTransactionScope(account, chainId, { address: call.to, data: call.data }),
    ),
    reviewedWrite: {
      version: 1,
      id,
      chainId,
      account,
      safe: !!safe,
      call: { ...call, value: String(call.value ?? 0n) },
    },
  });
}

/** Sorted constituent scopes serialize ordinary calls and overlapping Safe bundles together. */
function withWriteLocks<T>(scopes: readonly string[], work: () => Promise<T>): Promise<T> {
  const locks = typeof navigator === "undefined" ? undefined : navigator.locks;
  if (!locks)
    return Promise.reject(new Error("This browser cannot safely coordinate wallet writes."));
  const keys = [...new Set(scopes)].sort();
  const acquire = (index: number): Promise<T> =>
    index === keys.length
      ? work()
      : locks.request(`revnet:transaction:${keccak256(stringToHex(keys[index]))}`, () =>
          acquire(index + 1),
        );
  return acquire(0);
}

function requireNoPendingBatchWrite(
  account: Address,
  scopes: readonly string[],
  owner?: TransactionActivity["writeOwner"],
): void {
  const pending = readMultichainBatches().find(
    (batch) =>
      batch.account.toLowerCase() === account.toLowerCase() &&
      batch.status === "pending" &&
      batch.calls.some(
        (call, index) =>
          !(batch.id === owner?.batchId && index === owner.callIndex) &&
          ["submitting", "submitted", "safe"].includes(call.state) &&
          scopes.includes(contractTransactionScope(account, call.chainId, call)),
      ),
  );
  if (pending)
    throw new Error(
      "A saved batch has an unresolved wallet write for this action. Resume that batch; do not submit it again.",
    );
}
/** A watch looks for its proposal's result this often. */
const SAFE_LOOK_MS = 5_000;
/**
 * Looks in the minute after a reply, each of which checks the chain: an execution Safe{Wallet}
 * sent at once reaches it within that minute. Without a Safe service, this many chain checks that
 * find nothing end a proposal unconfirmed.
 */
const SAFE_EXECUTION_CHECKS = 12;
const RECEIPT_UNCONFIRMED =
  "Submitted, but this RPC could not confirm the receipt. Check the transaction before retrying.";
const SAFE_RESULT_UNCONFIRMED =
  "This Safe transaction's result can't be confirmed here. Check it in Safe before retrying.";
const SAFE_REPORTED_EXECUTED_UNCONFIRMED =
  "Safe reports this proposal as executed, but its result can't be confirmed here. Check it in Safe before retrying.";
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
  const executed = (
    isSuccessful: boolean,
    transactionHash: Hex | undefined,
    expected?: TransactionActivity,
  ) => {
    const needsReceiptVerification = tracked()?.manualVerificationRequired === true;
    updateTransactionActivity(
      id,
      {
        status: needsReceiptVerification ? "pending" : isSuccessful ? "success" : "failed",
        ...(expected ? { safeResultUnconfirmed: false } : {}),
        executionHash: transactionHash,
        message: needsReceiptVerification
          ? "Safe execution was reported. Its exact transaction and recipient results still require verification; resume the saved batch."
          : !isSuccessful
            ? "Safe executed this proposal, but the onchain transaction failed."
            : `Safe approvals completed and the proposal executed onchain${transactionHash ? ` as ${transactionHash}` : ""}.`,
      },
      expected,
    );
  };
  /** The service's latest record reports the proposal executed without its transaction. */
  let reportedExecuted = false;
  /**
   * The app can't confirm this proposal's result: the watch ends, and its account may dismiss it.
   * Each caller has just read the chain (the execution's receipt, or the transaction with this
   * hash) or has no client to read it with. `reported`: the Safe service reported the proposal
   * executed, which the line keeps for its account.
   */
  const unconfirmed = (executionHash?: Hex, reported = reportedExecuted) =>
    updateTransactionActivity(id, {
      ...(executionHash ? { executionHash } : {}),
      message: reported ? SAFE_REPORTED_EXECUTED_UNCONFIRMED : SAFE_RESULT_UNCONFIRMED,
      safeResultUnconfirmed: true,
    });
  /** Whether the hour after the proposal was made has passed. */
  const pastHorizon = () =>
    Date.now() - (tracked()?.createdAt ?? Date.now()) >= SAFE_RESULT_HORIZON_MS;
  /**
   * Settles the proposal from its execution's receipt: only the Safe's own
   * event for this proposal decides, never the receipt's status alone or
   * another proposal's event in the same receipt. `reported`: the Safe service
   * reported this execution.
   */
  const settle = async (executionHash: Hex, reported: boolean) => {
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
    if (!receipt && !noReceipt) {
      // The proposal stays held for the next look.
      updateTransactionActivity(id, { executionHash, message: RECEIPT_UNCONFIRMED });
      return;
    }
    if (!receipt || !safe) {
      // A receipt the chain still doesn't hold an hour after it first said so is not coming.
      const seen = tracked();
      const seenAt =
        seen?.executionHash?.toLowerCase() === executionHash.toLowerCase()
          ? (seen.executionSeenAt ?? Date.now())
          : Date.now();
      if (Date.now() - seenAt >= SAFE_RESULT_HORIZON_MS) {
        unconfirmed(executionHash, reported);
        return;
      }
      updateTransactionActivity(id, {
        executionHash,
        executionSeenAt: seenAt,
        message: RECEIPT_UNCONFIRMED,
      });
      return;
    }
    const recovery = tracked();
    if (recovery?.reviewedWrite) {
      try {
        const outcome = await verifyReviewedWriteReceipt(
          client!,
          recovery.reviewedWrite,
          receipt,
          recovery.safeProposal
            ? { calls: recovery.safeProposal.calls, batch: recovery.safeProposal.batch }
            : undefined,
        );
        executed(outcome === "success", executionHash, recovery);
      } catch {
        updateTransactionActivity(id, { executionHash, message: RECEIPT_UNCONFIRMED }, recovery);
      }
      return;
    }
    const result = safeExecutionResult(receipt, safe, hash);
    if (result.status === "unproven") {
      unconfirmed(executionHash, reported);
      return;
    }
    executed(result.status === "success", executionHash);
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
    if (execution === undefined) return false;
    if (execution && executesReviewed(execution)) await settle(hash, false);
    else unconfirmed();
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
      const executionHash =
        typeof proposal.transactionHash === "string" && isHash(proposal.transactionHash)
          ? proposal.transactionHash
          : undefined;
      reportedExecuted = proposal.isExecuted === true && !executionHash;
      const message = safeTransactionMessage(proposal);
      if (!runsReviewed(message)) {
        unfollowable = true;
        return "stuck";
      }
      if (proposal.isExecuted) {
        if (executionHash) {
          await settle(executionHash, true);
          return "done";
        }
        updateTransactionActivity(id, {
          status: "safe-proposed",
          message:
            "Safe reports this proposal as executed, but its transaction is not available yet. Do not submit it again while confirmation is unresolved.",
        });
        return "stuck";
      }
      // Only the Safe's current owners' well-formed confirmations count.
      const live = await livePolicy(safe);
      const approvals = live
        ? ` | ${usableSafeConfirmations(proposal, live.owners).length}/${live.threshold} approvals`
        : "";
      updateTransactionActivity(id, {
        status: "safe-proposed",
        message: `Safe proposal is not executed${approvals}. It remains asynchronous; do not submit it again.`,
      });
      // A nonce the Safe has moved past was taken by another transaction, or by this proposal's
      // own execution that the service has yet to list, which the watch's run of looks waits out.
      // It is read only after the hour, when the watch may end the proposal.
      if (!pastHorizon()) return "live";
      const nonce = await liveNonce(safe);
      if (nonce === null) return "unknown";
      return nonce > message.nonce ? "stuck" : "live";
    } catch {
      if (status === 404 || (status >= 200 && status < 300 && json)) {
        reportedExecuted = false;
        return "stuck";
      }
      updateTransactionActivity(id, {
        status: "safe-proposed",
        message:
          "Safe proposal submitted, but its service is temporarily unavailable. It is not confirmed executed; check Safe before retrying.",
      });
      return "unknown";
    }
  };
  // Without a Safe service or a client for its chain, nothing can follow the proposal.
  if (!service && !client) {
    unconfirmed();
    return;
  }
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
        if (executesReviewed(execution)) await settle(hash, false);
        else unconfirmed();
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
      const due = unfollowable || (stuckLooks >= stuckFor && (!service || pastHorizon()));
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
  const writeScopes = encoded.map((call) =>
    contractTransactionScope(account, chainId, { address: call.to, data: call.data }),
  );
  const callKey = `batch:${account.toLowerCase()}:${chainId}:${keccak256(
    stringToHex(encoded.map((call) => `${call.to}:${call.value ?? 0n}:${call.data}`).join("|")),
  )}`;
  const submit = async () => {
    requireTransactionActivityPersistence();
    requireNoPendingBatchWrite(account, writeScopes);
    const duplicate = refreshTransactionActivities().find(
      (activity) =>
        (activity.callKey === callKey ||
          activity.writeScopes?.some((scope) => writeScopes.includes(scope))) &&
        (activity.status === "submitted" ||
          activity.status === "pending" ||
          activity.status === "safe-proposed"),
    );
    if (duplicate && !duplicate.hash) throw new Error(UNKNOWN_WRITE);
    if (duplicate?.hash) {
      throw new SafeProposalPendingError(duplicate.hash, title, duplicate.safeResultUnconfirmed);
    }

    // The calls depend on each other (an allowance, then the spend), so the
    // SDK simulates them as one sequence where the RPC offers eth_simulateV1,
    // and otherwise each standalone call on its own, leaving a dependent one to
    // Safe's batch simulation before signing. Only a node that lacks the method
    // takes the fallback; a revert or a lagging node stops the proposal.
    const publicClient = getPublicClient(config, { chainId });
    if (!publicClient) throw new Error(`No RPC client is configured for chain ${chainId}.`);
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
      description: `These ${calls.length} calls go to Safe as one batch that executes together, in this order, once the Safe's approvals are in.\n\n${SAFE_NONCE_GUIDANCE}`,
    });
    const safe: ReviewedSafeProposal = {
      safe: account,
      calls: encoded.map((call) => ({ ...call, value: String(call.value ?? 0n) })),
      batch: true,
    };
    let reservation: TransactionActivity | undefined;
    const releaseUnsent = () => {
      if (reservation) removeUnsentTransactionActivity(reservation);
    };
    return submitReviewedContractWrite({
      request: { chainId },
      expectedAccount: account,
      currentAccount: () => getAccount(config).address,
      review: async () => undefined,
      switchChain: async () => {
        requireWalletContext();
        if (getAccount(config).chainId !== chainId)
          await switchChain(config, { chainId } as Parameters<typeof switchChain>[1]);
        requireWalletContext(chainId);
      },
      simulate: async () => encoded,
      beforeWrite: () => {
        reservation = reserveWalletWrite(chainId, account, title, callKey, encoded, safe);
      },
      beforeSend: () => requireWalletContext(chainId),
      onBeforeWriteAborted: releaseUnsent,
      onWriteRejected: releaseUnsent,
      onWriteSubmitted: (hash: Hex) => {
        reservation = submitTransactionActivity(reservation!, hash);
        followSubmission(config, hash, chainId, title, account, callKey, safe, false);
      },
      write: async (calls) => (await sendCalls(config, { chainId, calls })).id as Hex,
    });
  };
  return withWriteLocks(writeScopes, submit);
}

export function resumeSafeProposalTracking(config: ReturnType<typeof useConfig>): void {
  transactionActivitySnapshot()
    .filter(
      (activity) =>
        activity.status === "safe-proposed" &&
        (!activity.safeResultUnconfirmed || activity.reviewedWrite || activity.writeOwner) &&
        activity.hash &&
        activity.chainId,
    )
    .forEach(
      (activity) =>
        void watchSafeProposal(
          activity.id,
          activity.hash!,
          activity.chainId!,
          getPublicClient(config, { chainId: activity.chainId! }),
        ),
    );
  transactionActivitySnapshot()
    .filter(
      (activity) =>
        activity.kind === "direct" &&
        activity.reviewedWrite &&
        (activity.status === "submitted" || activity.status === "pending") &&
        activity.hash &&
        activity.chainId &&
        activity.account,
    )
    .forEach((activity) =>
      followSubmission(
        config,
        activity.hash!,
        activity.chainId!,
        activity.title,
        activity.account!,
        activity.callKey!,
        false,
        activity.manualVerificationRequired === true,
      ),
    );
}

const directInflight = new Map<string, Promise<void>>();

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
  writeOwner?: TransactionActivity["writeOwner"],
): void {
  const id = `tx:${chainId}:${hash.toLowerCase()}`;
  recordTransactionActivity({
    id,
    kind: safe ? "safe" : "direct",
    title,
    status: safe ? "safe-proposed" : "submitted",
    message: safe
      ? "Submitted to Safe. It is not executed yet; it still needs the Safe's approvals and asynchronous execution."
      : "Wallet submission accepted. Waiting for an onchain receipt.",
    chainId,
    account,
    hash,
    safeProposalHash: safe ? hash : undefined,
    safeProposal: safe || undefined,
    callKey,
    manualVerificationRequired: manualReceiptVerification || undefined,
    writeOwner,
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
  if (directInflight.has(id)) return;
  const expected = transactionActivityForHash(hash);
  const following = waitForReceiptWithRetry(publicClient, hash)
    .then(async (receipt) => {
      const outcome = expected?.reviewedWrite
        ? await verifyReviewedWriteReceipt(publicClient, expected.reviewedWrite, receipt)
        : receipt.status === "success"
          ? "success"
          : "failed";
      updateTransactionActivity(
        id,
        {
          status: outcome,
          message:
            outcome === "success"
              ? "Confirmed onchain."
              : "The transaction was mined but reverted. Its intended state changes did not occur.",
        },
        expected?.reviewedWrite ? expected : undefined,
      );
    })
    .catch(() => {
      updateTransactionActivity(
        id,
        {
          status: "pending",
          message: RECEIPT_UNCONFIRMED,
        },
        expected?.reviewedWrite ? expected : undefined,
      );
    })
    .finally(() => directInflight.delete(id));
  directInflight.set(id, following);
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
  /** Persist caller-specific recovery immediately before the wallet broadcast boundary. */
  beforeSubmission?: () => Promise<void>;
  /** The shared final gate refused after persistence, before the wallet writer was invoked. */
  onBeforeSubmissionAborted?: () => Promise<void>;
  /** A domain journal explicitly owns every durable transition for this write. */
  durableRecovery?: {
    owner: () => NonNullable<TransactionActivity["writeOwner"]>;
    reserve: () => Promise<void>;
    submitted: (hash: Hex) => Promise<void>;
    releaseUnsent: () => Promise<void>;
  };
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
  const scope = useRef({ mounted: true, generation: 0 });
  useEffect(() => {
    const active = scope.current;
    active.mounted = true;
    return () => {
      active.mounted = false;
      active.generation += 1;
    };
  }, []);
  const {
    transactionReview,
    reviewedInParent,
    beforeSubmission,
    onBeforeSubmissionAborted,
    durableRecovery,
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
      const generation = scope.current.generation;
      const requireActive = () => {
        if (!scope.current.mounted || scope.current.generation !== generation) {
          throw new Error("The transaction view changed. Review the action again.");
        }
      };
      requireActive();
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
      const writeScope = contractTransactionScope(initialAddress, chainId, { ...variables, data });
      const writeOwner = durableRecovery?.owner();
      const submitReviewedCall = async () => {
        requireActive();
        requireTransactionActivityPersistence();
        if (writeOwner) {
          const batch = readMultichainBatches().find((entry) => entry.id === writeOwner.batchId);
          const call = batch?.calls[writeOwner.callIndex];
          if (
            !batch ||
            batch.status !== "pending" ||
            batch.route !== "direct" ||
            batch.account.toLowerCase() !== initialAddress.toLowerCase() ||
            !call ||
            call.state !== "ready" ||
            !!call.hash ||
            contractTransactionKey(initialAddress, call.chainId, call) !== callKey
          ) {
            throw new Error("The durable recovery owner does not match the reviewed call.");
          }
        }
        requireNoPendingBatchWrite(initialAddress, [writeScope], writeOwner);
        const duplicate = refreshTransactionActivities().find(
          (activity) =>
            (activity.callKey === callKey || activity.writeScopes?.includes(writeScope)) &&
            (activity.manualVerificationRequired === true ||
              activity.status === "submitted" ||
              activity.status === "pending" ||
              activity.status === "safe-proposed"),
        );
        if (duplicate && !duplicate.hash) {
          throw new Error(
            "An earlier wallet write has an unknown result. This action remains locked; do not submit it again.",
          );
        }
        if (duplicate?.hash) {
          if (duplicate.status === "safe-proposed") {
            throw new SafeProposalPendingError(
              duplicate.hash,
              functionName,
              duplicate.safeResultUnconfirmed,
            );
          }
          throw new Error(
            `An identical ${functionName} transaction is already pending as ${duplicate.hash}. Check it before submitting again.`,
          );
        }

        const safe = isSafeConnection(config);
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
                  [transactionReview?.description, safe ? SAFE_NONCE_GUIDANCE : undefined]
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
        const assertWalletContext = () => {
          requireActive();
          requireWalletContext(chainId);
        };
        let reservation: TransactionActivity | undefined;
        const releaseUnsent = async () => {
          if (durableRecovery) await durableRecovery.releaseUnsent();
          else if (reservation) removeUnsentTransactionActivity(reservation);
        };
        const hash = await submitReviewedContractWrite({
          request: variables as typeof variables & { chainId: number },
          expectedAccount: initialAddress,
          guard: requireNoViewAs,
          accountChangedError: ACCOUNT_CHANGED,
          review,
          switchChain: async () => {
            // Refuse changed review identity before even opening a switch prompt.
            requireActive();
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
            await beforeSubmission?.();
            if (durableRecovery) await durableRecovery.reserve();
            else {
              const calls = [{ to: variables.address, data, value: String(variables.value ?? 0n) }];
              reservation = reserveWalletWrite(
                chainId,
                initialAddress,
                functionName,
                callKey,
                calls,
                safe ? { safe: initialAddress, calls, batch: false } : false,
              );
            }
          },
          onBeforeWriteAborted: async () => {
            await releaseUnsent();
            await onBeforeSubmissionAborted?.();
          },
          onWriteRejected: releaseUnsent,
          onWriteSubmitted: async (hash: Hex) => {
            try {
              if (durableRecovery) await durableRecovery.submitted(hash);
              else if (reservation) reservation = submitTransactionActivity(reservation, hash);
            } finally {
              // The wallet's reply belongs to this exact attempt even when the
              // owning batch journal became unwritable while its prompt was open.
              if (durableRecovery || reservation?.hash === hash)
                followSubmission(
                  config,
                  hash,
                  chainId,
                  functionName,
                  initialAddress,
                  callKey,
                  safe && {
                    safe: initialAddress,
                    calls: [{ to: variables.address, value: String(variables.value ?? 0n), data }],
                    batch: false,
                  },
                  ownsReceiptLifecycle,
                  writeOwner,
                );
            }
          },
          beforeSend: assertWalletContext,
          write: (prepared) =>
            mutation.writeContractAsync(
              prepared as Parameters<typeof mutation.writeContractAsync>[0],
            ),
        });
        return hash;
      };

      // Serialize identical submissions across same-origin tabs. The duplicate
      // check runs after the lock is acquired and refreshes persisted activity,
      // so a second tab cannot open another wallet prompt while the first is in
      // review or waiting for its Safe proposal hash.
      return withWriteLocks([writeScope], submitReviewedCall);
    },
    [
      config,
      manualReceiptVerification,
      mutation,
      preflightSimulation,
      reviewedInParent,
      reverify,
      beforeSubmission,
      onBeforeSubmissionAborted,
      durableRecovery,
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

  const reset = useCallback(() => {
    scope.current.generation += 1;
    mutation.reset();
  }, [mutation]);
  return { ...mutation, reset, writeContractAsync, writeContract } as ReturnType<
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
  const requiresVerifiedOutcome = !!(tracked?.reviewedWrite || tracked?.writeOwner);
  const isSuccess = isSafeSubmission
    ? tracked?.status === "success"
    : trackedDirectSuccess ||
      (!requiresVerifiedOutcome && query.isSuccess && receipt?.status === "success");
  const isError = isSafeSubmission
    ? tracked?.status === "failed"
    : trackedDirectFailure || (!requiresVerifiedOutcome && reverted) || (!tracked && query.isError);
  return {
    ...query,
    isLoading: isSafeSubmission ? isSafeProposal && !isSafeResultUnconfirmed : query.isLoading,
    isSuccess,
    isError,
    /**
     * A direct send whose watch ended, at its timeout or on a node failure, with
     * no receipt and no tracked outcome. It may still land, so its action stays
     * locked. (A Safe proposal whose result can't be confirmed is
     * `isSafeResultUnconfirmed`.)
     */
    isUnconfirmed: Boolean(hash) && !isSafeSubmission && query.isError && !isSuccess && !isError,
    error:
      isSafeSubmission && tracked?.status === "failed"
        ? new Error(tracked.message)
        : trackedDirectFailure
          ? new Error(tracked.message)
          : reverted && !requiresVerifiedOutcome
            ? new Error(`Transaction ${hash} reverted onchain.`)
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

/** What an account does about its Safe proposal whose result can't be confirmed. */
const CHECK_IN_SAFE = "Check it in Safe, then dismiss it in your account activity.";

/** The title a flow gives a step refused by a Safe proposal whose result can't be confirmed. */
export const SAFE_PROPOSAL_UNCONFIRMED_TITLE = "Safe proposal unconfirmed";

/** The status line a flow shows for that step. */
export const SAFE_PROPOSAL_UNCONFIRMED_LINE =
  "This step's Safe proposal can't be confirmed here. Check it in Safe. Keep this action locked until its execution is verified.";

/** Refuses a call while its Safe proposal is journaled and not yet settled. */
export class SafeProposalPendingError extends Error {
  readonly name = "SafeProposalPendingError";

  /** `unconfirmed`: the app can't confirm the proposal's result, so its account dismisses it. */
  constructor(
    readonly hash: Hex,
    action: string,
    readonly unconfirmed = false,
  ) {
    const activity = transactionActivityForHash(hash);
    const recovery = activity?.writeScopes?.length || activity?.writeOwner;
    super(
      unconfirmed
        ? `${action} was proposed to Safe as ${hash}, and its result can't be confirmed here. ${recovery ? "Check it in Safe. This action stays locked until its execution is verified." : CHECK_IN_SAFE}`
        : `${action} was proposed to Safe as ${hash}, but it has not executed. Complete its approvals and execution in Safe, then resume; do not submit it again.`,
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
export function requireOnchainExecution(hash: Hex, action: string): void {
  if (!submittedViaSafe(hash)) return;
  throw new SafeProposalPendingError(
    hash,
    action,
    transactionActivityForHash(hash)?.safeResultUnconfirmed,
  );
}
