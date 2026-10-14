"use client";

import { legacyBatchNamespace, legacyCallNamespace } from "@/lib/legacy-intents";
import { captureReviewedWalletContext } from "@/lib/reviewed-wallet-context";
import { isSafeConnection } from "@/lib/safe-connector";
import { safeProposalAt, type ReviewedSafeProposal } from "@/lib/safe-transactions";
import {
  contractTransactionKey,
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
import { waitForReceiptWithRetry } from "@/lib/waitForReceipt";
import {
  followHeld,
  heldLineOf,
  heldView,
  heldViewOf,
  legacyIntentsOf,
  legacyOf,
  safeHoldOf,
  sendHeld,
  writeHolds,
  writeIntentOf,
} from "@/lib/write-hold";
import {
  browserLocks,
  gasWithHeadroom,
  HELD_RELEASED_ELSEWHERE_LINE,
  HELD_RELEASED_LINE,
  isDefiniteWalletRejection,
  SAFE_PROPOSAL_EXECUTED_LINE,
  SAFE_PROPOSAL_REPLACED_LINE,
  settledLine,
  simulateCallSequence,
  submitReviewedContractWrite,
  WRITE_HOLD_REVERTED_LINE,
  WRITE_HOLD_SAFE_UNPROVEN_LINE,
  type HeldWriteView,
  type WriteHoldGate,
} from "@bananapus/nana-sdk-core/review";
import { readAuthorityIdentity, readBoundedSafeNonce } from "@bananapus/nana-sdk-core/safe";
import {
  hasSafeService,
  readSafeTransaction,
  SAFE_NONCE_GUIDANCE,
  SAFE_PROPOSAL_AWAITING,
  safeExecutionResult,
  usableSafeConfirmations,
  waitForSafeExecutionHash,
} from "@bananapus/nana-sdk-core/safe-service";
import { useQueryClient } from "@tanstack/react-query";
import { sendCalls } from "@wagmi/core";
import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";
import {
  encodeFunctionData,
  keccak256,
  stringToHex,
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

const RECEIPT_UNCONFIRMED = "Couldn't confirm this yet. Check your wallet before sending again.";
/** How far past the Safe's nonce read before the wallet a new proposal's own nonce is looked for. */
const NONCE_SEARCH_AHEAD = 16;

/**
 * What a Safe proposal's row shows of its SDK view: the view's own line in every phase. A
 * success the hold settled names the execution; one whose caller verifies its exact result waits
 * for that caller.
 */
function showSafeView(id: string, view: HeldWriteView, client?: PublicClient): void {
  const row = refreshTransactionActivities().find((activity) => activity.id === id);
  if (!row) return;
  shownPhase.set(id, view.phase);
  if (view.phase === "awaiting" || view.phase === "confirming" || view.phase === "held") {
    updateTransactionActivity(id, {
      status: "safe-proposed",
      sdkHeld: true,
      message: (view.phase === "awaiting" && approvalLines.get(id)) || heldLineOf(view),
      safeResultUnconfirmed: view.exit || undefined,
    });
    if (view.phase === "awaiting" && client) void showApprovals(row, client);
    return;
  }
  if (view.phase === "settled" && view.settled) {
    const executionHash = "hash" in view.settled ? view.settled.hash : undefined;
    const verify = view.settled.result === "success" && row.manualVerificationRequired;
    updateTransactionActivity(id, {
      status: verify ? "pending" : view.settled.result === "success" ? "success" : "failed",
      executionHash,
      safeResultUnconfirmed: undefined,
      message: verify
        ? "Your Safe ran this. Resume the saved batch to finish checking it."
        : settledLine(view.settled),
    });
    return;
  }
  if (view.phase === "released")
    updateTransactionActivity(id, {
      status: "failed",
      safeResultUnconfirmed: undefined,
      message: view.line ?? undefined,
    });
}

/** The phase each Safe row last showed, and its approvals line while it awaits its signers. */
const shownPhase = new Map<string, HeldWriteView["phase"]>();
const approvalLines = new Map<string, string>();
const approvalsReadAt = new Map<string, number>();
/** A row's approvals are read from Safe's service at most this often. */
const APPROVALS_REREAD_MS = 60_000;

/**
 * While a proposal awaits its signers, how many of the Safe's current owners approved it, from
 * Safe's service: domain information the hold's own line doesn't carry. Only well-formed
 * confirmations of current owners count.
 */
async function showApprovals(row: TransactionActivity, client: PublicClient): Promise<void> {
  const { id, hash, chainId } = row;
  const safe = row.safeProposal?.safe ?? row.account;
  if (!hash || !chainId || !safe || !hasSafeService(chainId)) return;
  if (Date.now() - (approvalsReadAt.get(id) ?? 0) < APPROVALS_REREAD_MS) return;
  approvalsReadAt.set(id, Date.now());
  try {
    const [proposal, identity] = await Promise.all([
      readSafeTransaction(chainId, safe, hash),
      readAuthorityIdentity(client, safe).catch(() => null),
    ]);
    if (proposal.isExecuted) return;
    const approvals =
      identity?.kind === "safe"
        ? `: ${usableSafeConfirmations(proposal, identity.owners).length} of ${identity.threshold}`
        : "";
    const line = `Waiting for your Safe's approvals${approvals}.`;
    approvalLines.set(id, line);
    if (shownPhase.get(id) === "awaiting") updateTransactionActivity(id, { message: line });
  } catch {
    // Safe's service can't say: the hold's own line stays.
  }
}

/**
 * A proposal journaled without its reviewed calls, which no hold can hold, settles from the chain
 * as on main: its execution (Safe's reply when it executed at once, or Safe's service's record),
 * then the Safe's own execution event in that receipt. Anything it can't prove leaves it
 * unconfirmed, for its account to dismiss.
 */
async function settleUnheldProposal(row: TransactionActivity, client: PublicClient) {
  const { id, hash, chainId } = row;
  const safe = row.account;
  if (!hash || !chainId || !safe) return;
  try {
    const executionHash = await waitForSafeExecutionHash(chainId, hash, { client });
    const receipt = await waitForReceiptWithRetry(client, executionHash);
    if (receipt.transactionHash?.toLowerCase() !== executionHash.toLowerCase()) return;
    const result = safeExecutionResult(receipt, safe, hash);
    if (result.status === "unproven") return;
    updateTransactionActivity(id, {
      status: result.status === "success" ? "success" : "failed",
      executionHash,
      safeResultUnconfirmed: undefined,
      message: result.status === "success" ? SAFE_PROPOSAL_EXECUTED_LINE : WRITE_HOLD_REVERTED_LINE,
    });
  } catch {
    // Not proven: it stays unconfirmed.
  }
}

/**
 * Follows a Safe proposal's row through the hold. One the hold doesn't hold (proposed through
 * Safe's service, or journaled by an earlier build) is adopted into it first, by its safeTxHash;
 * one journaled without its reviewed calls can't be held, and its account dismisses it.
 */
function followSafeRow(row: TransactionActivity, client: PublicClient | undefined): void {
  if (!row.hash || !row.chainId) return;
  if (!client || !row.safeProposal) {
    updateTransactionActivity(row.id, {
      message: WRITE_HOLD_SAFE_UNPROVEN_LINE,
      safeResultUnconfirmed: true,
    });
    if (client) void settleUnheldProposal(row, client);
    return;
  }
  const handle = safeHoldOf(row.chainId, row.safeProposal);
  const view = heldView(
    handle,
    client,
    row.sdkHeld ? undefined : { safe: { safeTxHash: row.hash } },
  );
  const { hash } = row;
  // A nonce the earlier build saved for it lets the hold prove what used that nonce.
  const nonce =
    !row.sdkHeld && row.safeProposalNonce && /^\d+$/.test(row.safeProposalNonce)
      ? Number(row.safeProposalNonce)
      : undefined;
  let seenHeld = false;
  followHeld(view, (now) => {
    if (now.phase === "awaiting" || now.phase === "confirming" || now.phase === "held") {
      if (!seenHeld && nonce !== undefined)
        void handle.attachSafeNonce(client, { safeTxHash: hash, nonce }).catch(() => undefined);
      seenHeld = true;
    }
    // A row the hold no longer holds (another window's exit, or a settlement no view here saw)
    // shows what the hold kept of it.
    if (now.phase === "clear" && !now.adopting && !seenHeld && now.state)
      showSafeView(row.id, {
        ...now,
        phase: now.settled ? "settled" : "released",
        line: now.settled ? null : HELD_RELEASED_ELSEWHERE_LINE,
      });
    else showSafeView(row.id, now, client);
  });
}

export function resumeSafeProposalTracking(config: ReturnType<typeof useConfig>): void {
  for (const row of transactionActivitySnapshot()) {
    // An earlier build's proposal another transaction replaced may still have run: it is held too.
    const replaced =
      !row.sdkHeld &&
      !!row.safeProposal &&
      row.status === "failed" &&
      row.message === SAFE_PROPOSAL_REPLACED_LINE;
    if (row.kind !== "safe" || (row.status !== "safe-proposed" && !replaced)) continue;
    if (!row.hash || !row.chainId) continue;
    followSafeRow(
      row,
      getPublicClient(config, { chainId: row.chainId }) as PublicClient | undefined,
    );
  }
}

/**
 * Journal a submitted write and follow it to its result. `safe` is what a Safe proposal was
 * reviewed to run, or false for a transaction the wallet sent. A proposal sent under the hold
 * (`held`) is followed by the view that sent it; any other is adopted into the hold.
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
  held = false,
): void {
  const id = `tx:${chainId}:${hash.toLowerCase()}`;
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
    sdkHeld: held || undefined,
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
    if (!held) {
      const row = refreshTransactionActivities().find((activity) => activity.id === id);
      if (row) followSafeRow(row, publicClient as PublicClient | undefined);
    }
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

/**
 * The hold let a new send of this call through: its earlier proposals' rows are no longer held,
 * whatever they last showed.
 */
function retireEarlierRows(callKey: string): void {
  for (const row of refreshTransactionActivities())
    if (row.callKey === callKey && row.status === "safe-proposed")
      updateTransactionActivity(row.id, {
        status: "failed",
        safeResultUnconfirmed: undefined,
        message: HELD_RELEASED_LINE,
      });
}

/** What a hold-following send shows of its Safe proposal: its row, by the hash it sent. */
function showSentSafeView(chainId: number, client?: PublicClient) {
  return (hash: Hex, view: HeldWriteView) =>
    showSafeView(`tx:${chainId}:${hash.toLowerCase()}`, view, client);
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
  const submit = async (gate: WriteHoldGate) => {
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
    retireEarlierRows(callKey);
    followSubmission(
      config,
      hash,
      chainId,
      title,
      account,
      callKey,
      proposal,
      false,
      undefined,
      true,
    );
    return hash;
  };
  return sendHeld(hold, publicClient, submit, showSentSafeView(chainId, publicClient));
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
      /** The Safe's nonce read right before the wallet, where a new proposal's own nonce starts. */
      let safeNonceBefore: bigint | null = null;
      const submitReviewedCall = async (gate?: WriteHoldGate) => {
        // A write its caller journals (no hold) refuses while that journal shows it pending; a
        // held write is the hold's to refuse.
        const duplicate = hold ? undefined : duplicateOf();
        if (duplicate?.hash) {
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
        if (safeProposal) retireEarlierRows(callKey);
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
          !!hold,
        );
        return hash;
      };

      // The hold serializes the call across tabs and decides what is sent. A write its caller
      // journals is serialized here, and its journal is checked under the lock.
      // Without a client for the chain the simulation refuses before any wallet opens.
      if (hold && holdClient)
        return sendHeld(
          hold,
          holdClient,
          submitReviewedCall,
          safeProposal ? showSentSafeView(chainId, holdClient as PublicClient) : undefined,
        );
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

const noView = () => () => {};
const idleView = () => undefined;

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
  // It may still land: the SDK view it was sent under shows it from here, its line, an exit that
  // becomes due with time, and the hold's settlement.
  const sentUnder = watchGaveUp ? heldViewOf(hash) : undefined;
  const view = useSyncExternalStore(
    sentUnder?.subscribe ?? noView,
    sentUnder?.get ?? idleView,
    idleView,
  );
  const settled =
    view?.phase === "settled" &&
    view.settled &&
    "hash" in view.settled &&
    view.settled.hash.toLowerCase() === hash?.toLowerCase()
      ? view.settled
      : undefined;
  const trackedId = tracked?.id;
  useEffect(() => {
    if (!settled || !trackedId) return;
    updateTransactionActivity(trackedId, {
      status: settled.result === "success" ? "success" : "failed",
      message: settled.result === "success" ? "Confirmed onchain." : WRITE_HOLD_REVERTED_LINE,
    });
  }, [settled, trackedId]);
  const held =
    view && (view.phase === "held" || view.phase === "confirming" || view.phase === "awaiting")
      ? view
      : undefined;
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
    isUnconfirmed: watchGaveUp && !settled && view?.phase !== "released" && !held?.exit,
    /** The line of the hold that send is held by, while its watch has given up. */
    heldLine: held ? heldLineOf(held) : undefined,
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
