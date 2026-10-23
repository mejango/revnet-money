"use client";

import { legacyBatchNamespace } from "@/lib/legacy-intents";
import { ACCOUNT_CHANGED } from "@/lib/reviewed-call";
import { captureReviewedWalletContext } from "@/lib/reviewed-wallet-context";
import { isSafeConnection } from "@/lib/safe-connector";
import { safeProposalAt, type ReviewedSafeProposal } from "@/lib/safe-transactions";
import {
  recordTransactionActivity,
  refreshTransactionActivities,
  updateTransactionActivity,
} from "@/lib/transaction-activity";
import {
  requireTransactionReview,
  type ContractTransactionReviewCall,
} from "@/lib/transaction-review";
import { requireNoViewAs } from "@/lib/view-as";
import { SUPPORTED_CHAINS } from "@/lib/wagmiTransports";
import { waitForReceiptWithRetry } from "@/lib/waitForReceipt";
import {
  safeHoldInputOf,
  sendHeld,
  storedHoldOf,
  writeHolds,
  type HoldInput,
} from "@/lib/write-hold";
import {
  HELD_RELEASED_LINE,
  isDefiniteWalletRejection,
  safeBatchIntent,
  simulateCallSequence,
  type WriteHoldClient,
  type WriteHoldGate,
} from "@bananapus/nana-sdk-core/review";
import { useHeldSend, type UseHeldSendResult } from "@bananapus/nana-sdk-core/review/react";
import { readBoundedSafeNonce } from "@bananapus/nana-sdk-core/safe";
import { SAFE_NONCE_GUIDANCE, SAFE_PROPOSAL_AWAITING } from "@bananapus/nana-sdk-core/safe-service";
import { sendCalls } from "@wagmi/core";
import { useCallback, useMemo, useRef } from "react";
import {
  encodeFunctionData,
  keccak256,
  stringToHex,
  type Address,
  type Hex,
  type TransactionReceipt,
} from "viem";
import { useConfig } from "wagmi";
import { getAccount, getPublicClient, switchChain } from "wagmi/actions";

// REMOVE with SDK 4.0.0-local.8's ReviewedAction.batch: a Safe app batch as one proposal is the
// only send left here, with the journal row it follows.

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
  /** Sent under the hold: a Safe proposal's row is the hold's from its send. */
  held = false,
  /** A direct write's hold, so its screens can show it. */
  hold?: HoldInput,
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
    ...(hold && !safe ? { directHold: storedHoldOf(hold) } : {}),
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
  // A proposal is followed by its hold (HeldRowFollowers), adopted first when it wasn't sent
  // under it.
  if (safe) return;
  updateTransactionActivity(id, { status: "pending", message: "Pending onchain confirmation." });
  if (!publicClient) return;
  void waitForReceiptWithRetry(publicClient, hash)
    .then(async (receipt) => {
      // The hold learns it first: by the time the row says so, the next send goes straight on.
      await onReceipt?.(receipt).catch(() => undefined);
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
/** Proposes one Safe batch through the SDK's held send (useProposeSafeBatch). */
export type ProposeSafeBatch = ReturnType<typeof useProposeSafeBatch>;

export function useProposeSafeBatch() {
  const heldSends = useHeldSends();
  return useCallback(
    (
      ...args: Parameters<typeof proposeSafeBatch> extends [unknown, ...infer Rest] ? Rest : never
    ) => proposeSafeBatch(heldSends, ...args),
    [heldSends],
  );
}

async function proposeSafeBatch(
  heldSends: (chainId: number) => UseHeldSendResult,
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
  // A batch is held by its action's intent, or else by the SDK's safeBatchIntent of its exact
  // calls. REMOVE with legacy-intents.ts: the batch namespace the previous build held every
  // batch by holds it too.
  const proposal: ReviewedSafeProposal = {
    safe: account,
    calls: encoded.map((call) => ({ ...call, value: String(call.value ?? 0n) })),
    batch: true,
    holdNamespace: intent ?? safeBatchIntent({ chainId, safe: account, calls: encoded }),
    legacyNamespaces: [legacyBatchNamespace(calls)],
  };
  const publicClient = getPublicClient(config, { chainId });
  if (!publicClient) throw new Error(`No RPC client is configured for chain ${chainId}.`);
  // The batch is held by the SDK's write hold, as one proposal, until its watch or the chain
  // shows how it ended, or the user takes the hold's exit.
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
  return sendHeld(
    heldSends(chainId).send,
    safeHoldInputOf(chainId, proposal),
    publicClient as unknown as WriteHoldClient,
    submit,
  );
}

/**
 * The SDK's held send for each chain this app writes to, with that chain's client: a write's call
 * is known only at send time, so each send picks its chain's.
 */
function useHeldSends(): (chainId: number) => UseHeldSendResult {
  const config = useConfig();
  const clients = useMemo(
    () =>
      SUPPORTED_CHAINS.map(
        (chain) =>
          getPublicClient(config, { chainId: chain.id } as never) as unknown as
            WriteHoldClient | undefined,
      ),
    [config],
  );
  const byChain = new Map<number, UseHeldSendResult>();
  for (const [index, chain] of SUPPORTED_CHAINS.entries())
    // A module constant: the same hooks run in the same order on every render.
    // eslint-disable-next-line react-hooks/rules-of-hooks
    byChain.set(chain.id, useHeldSend({ hold: writeHolds, client: clients[index] }));
  const latest = useRef(byChain);
  latest.current = byChain;
  return useCallback((chainId: number) => {
    const held = latest.current.get(chainId);
    if (!held) throw new Error(`No RPC client is configured for chain ${chainId}.`);
    return held;
  }, []);
}
