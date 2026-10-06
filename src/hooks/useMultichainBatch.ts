"use client";

import {
  requireRelayrRecoveryScopeAvailable,
  useGetRelayrTxQuote,
  useSendRelayrTx,
  waitForRelayrBundle,
} from "@/hooks/useReviewedRelayr";
import {
  isSafeConnection,
  submittedViaSafe,
  useWriteContract,
} from "@/hooks/useReviewedWriteContract";
import {
  batchCallKey,
  batchCallScope,
  createMultichainBatch,
  findPendingBatch,
  isBatchCallHandled,
  removeUnsubmittedBatch,
  saveMultichainBatch,
  type FrozenBatchCall,
  type MultichainBatch,
  type MultichainCall,
} from "@/lib/multichain-batch";
import {
  readRouterPendingAdvance,
  verifyActionReceipt,
  verifyCallPreconditions,
} from "@/lib/multichain-guards";
import type { JBChainId } from "@/lib/nana/types";
import {
  findPendingRoutingBatch,
  simulatePendingRouterCall,
  type PendingProject,
} from "@/lib/pending-router-calls";
import { areRelayrChainsCompatible, isRelayrSupportedChain } from "@/lib/relayr-chains";
import { safeTransactionRunsCalls } from "@/lib/safe-transactions";
import {
  recordTransactionActivity,
  refreshTransactionActivities,
  updateTransactionActivity,
} from "@/lib/transaction-activity";
import { chooseRelayrPayment, requireTransactionReview } from "@/lib/transaction-review";
import { requireNoViewAs } from "@/lib/view-as";
import { gasWithHeadroom } from "@bananapus/nana-sdk-core/review";
import { relayrDestinationHash } from "@bananapus/nana-sdk-core/review/relayr";
import {
  readSafeTransaction,
  SAFE_EXEC_ABI,
  SAFE_NONCE_GUIDANCE,
  safeExecutionResult,
  safeTransactionMessage,
} from "@bananapus/nana-sdk-core/safe-service";
import { useCallback, useRef, useState } from "react";
import {
  decodeFunctionData,
  isAddressEqual,
  type Address,
  type Hash,
  type PublicClient,
} from "viem";
import { useConfig } from "wagmi";
import { getAccount, getPublicClient } from "wagmi/actions";

export type BatchResult = {
  status: "success" | "pending";
  hashes: Array<{ chainId: number; hash: Hash; callIndex: number }>;
  revertedHashes?: Array<{ chainId: number; hash: Hash; callIndex: number }>;
  obsoleteSafeProposals?: Array<{
    chainId: number;
    safe: Address;
    hash: Hash;
    nonce: number;
    callIndex: number;
  }>;
};
type BatchInput = {
  label: string;
  scope: string;
  calls: MultichainCall[];
  onProgress?: (message: string) => void;
};
const running = new Set<string>();

/** The one call a saved batch call proposes to its Safe. */
function savedCall(call: FrozenBatchCall) {
  return { to: call.address, value: call.value ?? 0n, data: call.data };
}

function explicitRejection(cause: unknown): boolean {
  const seen = new Set<unknown>();
  while (cause && typeof cause === "object" && !seen.has(cause)) {
    seen.add(cause);
    const error = cause as { code?: number; cause?: unknown };
    if (error.code === 4001) return true;
    cause = error.cause;
  }
  return false;
}

async function verifyDirectResult(
  client: PublicClient,
  batch: MultichainBatch,
  call: FrozenBatchCall,
): Promise<
  | { hash: Hash; state: "success" | "reverted" }
  | {
      hash: Hash;
      state: "skipped";
      skipReason: "obsolete-safe";
      safeNonce: number;
    }
> {
  let hash = call.hash!;
  const safe = call.state === "safe";
  if (safe) {
    const activity = refreshTransactionActivities().find(
      (row) =>
        row.safeProposalHash?.toLowerCase() === call.hash?.toLowerCase() &&
        row.chainId === call.chainId,
    );
    if (!activity?.executionHash) {
      if (
        activity &&
        call.expectedRouterPending &&
        (await readRouterPendingAdvance(client, call.expectedRouterPending, call.preconditions)) ===
          "resolved-externally"
      ) {
        // The service's record of the proposal, authenticated against its hash.
        const record = await readSafeTransaction(call.chainId, batch.account, call.hash!);
        const proposal = safeTransactionMessage(record);
        if (
          // The service writes a nonce as a JSON number; any other form is refused.
          typeof record.nonce !== "number" ||
          !safeTransactionRunsCalls(proposal, [savedCall(call)], false)
        )
          throw new Error(
            "The authenticated Safe proposal does not match this exact routing call.",
          );
        if (
          (await readRouterPendingAdvance(
            client,
            call.expectedRouterPending,
            call.preconditions,
          )) !== "resolved-externally"
        )
          throw new Error(
            "The payment is pending again. Keep the original Safe proposal for reconciliation.",
          );
        const safeNonce = Number(proposal.nonce);
        updateTransactionActivity(activity.id, {
          status: "failed",
          manualVerificationRequired: false,
          obsoleteSafeNonce: safeNonce,
          message: `Payment resolved elsewhere. Safe proposal ${call.hash} is obsolete, not verified executed. Cancel or replace nonce ${safeNonce} in Safe if it blocks the queue.`,
        });
        return { hash, state: "skipped", skipReason: "obsolete-safe", safeNonce };
      }
      throw new Error(
        "The saved Safe proposal still needs approvals and execution. Resume after it executes; do not propose it again.",
      );
    }
    hash = activity.executionHash;
  }
  const [transaction, receipt] = await Promise.all([
    client.getTransaction({ hash }),
    client.getTransactionReceipt({ hash }),
  ]);
  const block = await client.getBlock({ blockNumber: receipt.blockNumber });
  if (
    receipt.transactionHash.toLowerCase() !== hash.toLowerCase() ||
    transaction.hash.toLowerCase() !== hash.toLowerCase() ||
    block.hash !== receipt.blockHash ||
    transaction.blockHash !== receipt.blockHash ||
    transaction.blockNumber !== receipt.blockNumber
  )
    throw new Error(
      "The saved transaction has no canonical successful receipt. Keep it for reconciliation; do not replay it.",
    );
  if (safe) {
    const decoded = decodeFunctionData({ abi: SAFE_EXEC_ABI, data: transaction.input });
    if (
      !transaction.to ||
      !isAddressEqual(transaction.to, batch.account) ||
      decoded.functionName !== "execTransaction" ||
      !safeTransactionRunsCalls(
        {
          to: decoded.args[0],
          value: decoded.args[1],
          data: decoded.args[2],
          operation: decoded.args[3],
        },
        [savedCall(call)],
        false,
      )
    )
      throw new Error("The Safe execution does not match the saved destination call.");
    // Over WalletConnect, Safe{Wallet} replies with the execution itself when
    // the owner executes at once: the SDK then reads the Safe's one execution
    // event in that receipt, whose execTransaction was checked above.
    if (safeExecutionResult(receipt, batch.account, call.hash!).status !== "success")
      throw new Error("The exact Safe proposal has not executed successfully.");
  } else if (
    !transaction.to ||
    !isAddressEqual(transaction.to, call.address) ||
    !isAddressEqual(transaction.from, batch.account) ||
    transaction.input.toLowerCase() !== call.data.toLowerCase() ||
    transaction.value !== (call.value ?? 0n)
  )
    throw new Error("The saved transaction does not match the exact reviewed call.");
  if (receipt.status !== "success") {
    if (!safe && call.expectedRouterPending && receipt.status === "reverted") {
      updateTransactionActivity(`tx:${call.chainId}:${call.hash!.toLowerCase()}`, {
        status: "failed",
        manualVerificationRequired: false,
        message:
          "The exact routing transaction reverted. No routing changes from this attempt took effect. Refresh the payment and prepare a new review to try again.",
      });
      return { hash, state: "reverted" };
    }
    throw new Error(
      "The saved transaction has no canonical successful receipt. Keep it for reconciliation; do not replay it.",
    );
  }
  const routerResult = await verifyActionReceipt(
    client,
    receipt,
    call.address,
    call.expectedDeployment,
    call.rejectEvents,
    call.reservedReceipt,
    call.expectedPayout,
    call.expectedRouterPending,
  );
  updateTransactionActivity(`tx:${call.chainId}:${call.hash!.toLowerCase()}`, {
    status: "success",
    manualVerificationRequired: false,
    executionHash: safe ? hash : undefined,
    message:
      routerResult === "pending"
        ? "The routing attempt was verified. The payment remains in gateway custody awaiting another attempt."
        : "The exact transaction and every required recipient result were verified.",
  });
  return { hash, state: "success" };
}

/** One frozen job, explicit rounds, one payment per independent multichain round. */
export function useMultichainBatch() {
  const config = useConfig();
  const [isPending, setIsPending] = useState(false);
  const direct = useRef<{ batch: MultichainBatch; index: number } | null>(null);
  const { getRelayrTxQuote } = useGetRelayrTxQuote();
  const { sendRelayrTx } = useSendRelayrTx();
  const writeOptions: NonNullable<Parameters<typeof useWriteContract>[0]> = {
    manualReceiptVerification: () => true,
    allowSafeManualReceiptVerification: true,
    preflightSimulation: async (_variables, account) => {
      const active = direct.current;
      if (!active) throw new Error("The saved batch call is unavailable.");
      const call = active.batch.calls[active.index];
      const client = getPublicClient(config, { chainId: call.chainId });
      if (!client) throw new Error("Destination RPC unavailable.");
      if (call.expectedRouterPending) {
        if (!call.gas || (call.value && call.value !== 0n))
          throw new Error("The saved routing attempt has no valid bounded gas envelope.");
        await simulatePendingRouterCall(client, {
          from: account,
          to: call.address,
          data: call.data,
          gas: call.gas,
        });
        return { gas: call.gas };
      }
      const request = {
        account,
        address: call.address,
        abi: call.abi,
        functionName: call.functionName,
        args: call.args,
        value: call.value,
        gas: call.gas,
      };
      await client.simulateContract(request);
      return {
        gas: call.gas ?? gasWithHeadroom(await client.estimateContractGas(request)),
      };
    },
    reverify: async () => {
      const active = direct.current;
      if (!active) throw new Error("The saved batch call is unavailable.");
      const call = active.batch.calls[active.index];
      const client = getPublicClient(config, { chainId: call.chainId });
      if (!client) throw new Error("Destination RPC unavailable.");
      await verifyCallPreconditions(client, call.preconditions);
    },
    beforeSubmission: async () => {
      const active = direct.current;
      if (!active) throw new Error("The saved batch call is unavailable.");
      const call = active.batch.calls[active.index];
      const client = getPublicClient(config, { chainId: call.chainId });
      if (!client) throw new Error("Destination RPC unavailable.");
      await verifyCallPreconditions(client, call.preconditions);
      const live = getAccount(config);
      if (
        live.address?.toLowerCase() !== active.batch.account.toLowerCase() ||
        live.chainId !== active.batch.calls[active.index].chainId
      )
        throw new Error(
          "The account or chain changed before submission. Resume with the reviewed account.",
        );
      active.batch.calls[active.index].state = "submitting";
      saveMultichainBatch(active.batch);
    },
  };
  // A resumed batch was reviewed in an earlier run, so each call is reviewed as it is sent.
  const { writeContractAsync } = useWriteContract(writeOptions);
  // The batch review in this run already showed these exact calls.
  const { writeContractAsync: writeReviewedAsync } = useWriteContract({
    ...writeOptions,
    reviewedInParent: true,
  });
  const getPendingBatch = useCallback(
    (scope: string, routingDestinations?: readonly PendingProject[]) => {
      const account = getAccount(config).address;
      if (!account) return undefined;
      const batch = routingDestinations
        ? findPendingRoutingBatch(account, routingDestinations)
        : findPendingBatch(account, scope);
      return batch
        ? {
            scope: batch.scope,
            label: batch.label,
            total: batch.calls.length,
            completed: batch.calls.filter((call) => isBatchCallHandled(call)).length,
          }
        : undefined;
    },
    [config],
  );

  const runBatch = useCallback(
    async (input: BatchInput): Promise<BatchResult> => {
      requireNoViewAs();
      const { address: account, chainId: startChainId } = getAccount(config);
      if (!account) throw new Error("Connect a wallet first.");
      const lock = `revnet:multichain:${account.toLowerCase()}`;
      if (running.has(lock))
        throw new Error("Another multichain batch is already being processed.");
      const execute = async (): Promise<BatchResult> => {
        setIsPending(true);
        let batch: MultichainBatch | undefined;
        // True once this run showed the batch review of every exact call.
        let reviewedHere = false;
        const progress = (message: string) => {
          input.onProgress?.(message);
          if (batch) updateTransactionActivity(batch.id, { message });
        };
        const requireAccount = () => {
          requireNoViewAs();
          if (getAccount(config).address?.toLowerCase() !== account.toLowerCase())
            throw new Error("The connected account changed. Resume with the original account.");
        };
        const result = (status: BatchResult["status"]): BatchResult => ({
          status,
          hashes: batch!.calls.flatMap((call, callIndex) =>
            call.state === "success" && call.hash
              ? [{ chainId: call.chainId, hash: call.hash, callIndex }]
              : [],
          ),
          ...(batch!.calls.some((call) => call.state === "reverted")
            ? {
                revertedHashes: batch!.calls.flatMap((call, callIndex) =>
                  call.state === "reverted" && call.hash
                    ? [{ chainId: call.chainId, hash: call.hash, callIndex }]
                    : [],
                ),
              }
            : {}),
          ...(batch!.calls.some((call) => call.skipReason === "obsolete-safe")
            ? {
                obsoleteSafeProposals: batch!.calls.flatMap((call, callIndex) =>
                  call.skipReason === "obsolete-safe" && call.hash && call.safeNonce !== undefined
                    ? [
                        {
                          chainId: call.chainId,
                          safe: batch!.account,
                          hash: call.hash,
                          nonce: call.safeNonce,
                          callIndex,
                        },
                      ]
                    : [],
                ),
              }
            : {}),
        });
        const reconcileReadyCall = async (call: FrozenBatchCall, index: number) => {
          if (call.state !== "ready" || call.hash || !call.expectedRouterPending) return false;
          // Lost publication responses also reserve this scope. Never skip a
          // signed/published call just because its journal still says ready.
          await requireRelayrRecoveryScopeAvailable(account, batchCallScope(batch!, call, index));
          const client = getPublicClient(config, { chainId: call.chainId });
          if (!client) throw new Error("Destination RPC unavailable.");
          const advance = await readRouterPendingAdvance(
            client,
            call.expectedRouterPending,
            call.preconditions,
          );
          if (advance) {
            call.state = "skipped";
            call.skipReason = advance;
            saveMultichainBatch(batch!);
            return true;
          }
          return false;
        };
        try {
          batch = findPendingBatch(account, input.scope);
          if (batch && input.calls.length && batch.key !== batchCallKey(input.calls))
            throw new Error(
              "A different saved batch is unresolved. Resume its original calls before changing the selection or amounts.",
            );
          if (!batch) {
            if (!input.calls.length) throw new Error("There is no saved batch to resume.");
            const multichainEoa =
              (input.calls.length > 1 ||
                input.calls.every(
                  (call) => call.relayrMode === "raw" && call.expectedRouterPending,
                )) &&
              !isSafeConnection(config);
            const chainIds = input.calls.map((call) => call.chainId);
            const compatible = areRelayrChainsCompatible(chainIds);
            if (multichainEoa && chainIds.every(isRelayrSupportedChain) && !compatible)
              throw new Error(
                "Choose destinations from one network family. Mainnet and testnet transactions cannot share a Relayr batch.",
              );
            // Routing is decided only for a new journal. An older direct testnet
            // job must resume its original transport and skip confirmed calls.
            // A keeper can resolve these calls at any time. Direct transactions
            // have a final receipt; a reverted forwarder signature remains live.
            const relayr =
              multichainEoa &&
              compatible &&
              (!input.calls.some((call) => call.expectedRouterPending) ||
                input.calls.every(
                  (call) => call.expectedRouterPending && call.relayrMode === "raw",
                ));
            batch = createMultichainBatch(
              account,
              input.scope,
              input.label,
              input.calls,
              relayr ? "relayr" : "direct",
            );
            for (const call of input.calls) await call.validate?.();
            // A Safe proposes each call with gas 0, so its reviewed envelope is
            // safeTxGas 0 rather than the EOA gas limit.
            const safe = isSafeConnection(config);
            await requireTransactionReview({
              title: `Review ${input.label}`,
              description: relayr
                ? `All ${batch.calls.length} selected calls are retained in ${batch.rounds.length} round(s). Each round uses one funding payment for its independent destinations. Confirmed rounds are skipped when resuming.`
                : `Calls are submitted in order on their selected chains. A Safe proposal must execute before the next call. Confirmed calls are skipped when resuming.${safe ? `\n\n${SAFE_NONCE_GUIDANCE}` : ""}`,
              confirmLabel: safe ? "Agree & propose to Safe" : "Agree & prepare batch",
              calls: batch.calls.map((call) => ({
                chainId: call.chainId,
                from: account,
                to: call.address,
                value: call.value,
                ...(safe ? { safeTxGas: 0n } : { gas: call.gas }),
                data: call.data,
                abi: call.abi,
                functionName: call.functionName,
                args: call.args,
                contractName: call.contractName,
              })),
            });
            reviewedHere = true;
            requireAccount();
            for (const call of batch.calls) {
              const client = getPublicClient(config, { chainId: call.chainId });
              if (!client) throw new Error("Destination RPC unavailable.");
              await verifyCallPreconditions(client, call.preconditions);
            }
            saveMultichainBatch(batch);
            recordTransactionActivity({
              id: batch.id,
              kind: "direct",
              title: input.label,
              status: "pending",
              manualVerificationRequired: true,
              account,
              message: "The exact selected calls are saved. Resume this batch to continue safely.",
            });
          }
          if (batch.route === "relayr") {
            if (batch.calls.some((call) => call.expectedRouterPending && call.relayrMode !== "raw"))
              throw new Error(
                "The saved routing batch contains a Relayr authorization. Reconcile that original authorization before starting a direct retry.",
              );
            if (isSafeConnection(config))
              throw new Error(
                "Resume this Relayr batch using its original EOA account connection.",
              );
            for (const [roundIndex, round] of batch.rounds.entries()) {
              if (round.state === "success") continue;
              if (round.state === "funding" && round.bundleUuid) {
                const activity = refreshTransactionActivities().find(
                  (item) => item.bundleUuid === round.bundleUuid,
                );
                if (
                  activity?.relayrPaymentStatus === "unfunded" ||
                  activity?.relayrPaymentStatus === "reverted" ||
                  activity?.relayrPaymentStatus === "expired"
                ) {
                  round.state = "quoted";
                  saveMultichainBatch(batch);
                }
              }
              requireAccount();
              progress(
                `Round ${roundIndex + 1} of ${batch.rounds.length}: ${round.indices.length} destination(s).`,
              );
              if (round.state === "ready" || round.state === "quoted") {
                const requests = [];
                for (const index of round.indices) {
                  const call = batch.calls[index];
                  const client = getPublicClient(config, { chainId: call.chainId });
                  if (!client) throw new Error("Destination RPC unavailable.");
                  await verifyCallPreconditions(client, call.preconditions);
                  const gas =
                    call.gas ??
                    gasWithHeadroom(
                      await client.estimateContractGas({
                        account,
                        address: call.address,
                        abi: call.abi,
                        functionName: call.functionName,
                        args: call.args,
                        value: call.value,
                      }),
                    );
                  requests.push({
                    chainId: call.chainId as JBChainId,
                    version: 6 as const,
                    relayrMode: call.relayrMode,
                    // The batch review in this run showed this exact call.
                    reviewedInParent: reviewedHere,
                    recoveryScope: batchCallScope(batch, call, index),
                    preconditions: call.preconditions,
                    expectedDeployment: call.expectedDeployment,
                    rejectEvents: call.rejectEvents,
                    reservedReceipt: call.reservedReceipt,
                    expectedPayout: call.expectedPayout,
                    expectedRouterPending: call.expectedRouterPending,
                    data: {
                      from: account,
                      to: call.address,
                      value: call.value ?? 0n,
                      gas,
                      data: call.data,
                    },
                    review: {
                      abi: call.abi,
                      functionName: call.functionName,
                      args: call.args,
                      contractName: call.contractName,
                      label: batch.label,
                    },
                  });
                }
                const quote = await getRelayrTxQuote(requests);
                if (!quote) throw new Error("Relayr did not return a payable quote.");
                const quotedCalls = refreshTransactionActivities().find(
                  (row) => row.bundleUuid === quote.bundle_uuid,
                )?.relayrExpectedTransactions;
                if (
                  (!quotedCalls || quotedCalls.length !== round.indices.length) &&
                  new Set(round.indices.map((index) => batch!.calls[index].chainId)).size !==
                    round.indices.length
                )
                  throw new Error("The quote has no complete destination identity binding.");
                round.transactionUuids = quotedCalls?.map((call) => call.transactionUuid);
                round.bundleUuid = quote.bundle_uuid;
                round.state = "quoted";
                saveMultichainBatch(batch);
                const payment = await chooseRelayrPayment(quote.payment_info, startChainId);
                requireAccount();
                round.state = "funding";
                saveMultichainBatch(batch);
                try {
                  await sendRelayrTx(payment);
                } catch (cause) {
                  const activity = refreshTransactionActivities().find(
                    (row) => row.bundleUuid === round.bundleUuid,
                  );
                  if (
                    activity?.relayrPaymentStatus === "unfunded" ||
                    activity?.relayrPaymentStatus === "reverted" ||
                    activity?.relayrPaymentStatus === "expired"
                  ) {
                    round.state = "quoted";
                    saveMultichainBatch(batch);
                  }
                  throw cause;
                }
                round.state = "pending";
                saveMultichainBatch(batch);
              }
              if (!round.bundleUuid)
                throw new Error(
                  "The saved publication response is unresolved. Reconcile the original intent before continuing.",
                );
              if (
                !round.transactionUuids &&
                new Set(round.indices.map((index) => batch!.calls[index].chainId)).size !==
                  round.indices.length
              )
                throw new Error(
                  "The saved bundle has no unique transaction identity for every routing attempt. Reconcile the original bundle before continuing.",
                );
              const bundle = await waitForRelayrBundle(round.bundleUuid);
              for (const [position, index] of round.indices.entries()) {
                const call = batch.calls[index];
                const transaction = bundle.transactions.find((item) =>
                  round.transactionUuids
                    ? item.tx_uuid === round.transactionUuids[position]
                    : item.request.chain === call.chainId,
                );
                const hash = transaction && relayrDestinationHash(transaction);
                if (!hash) throw new Error("The destination result has no verified hash.");
                call.hash = hash;
                const identity = refreshTransactionActivities()
                  .find((row) => row.bundleUuid === round.bundleUuid)
                  ?.relayrExpectedTransactions?.find(
                    (item) => item.transactionUuid === transaction.tx_uuid,
                  );
                call.state = identity?.receiptStatus === "reverted" ? "reverted" : "success";
              }
              round.state = "success";
              saveMultichainBatch(batch);
            }
          } else {
            for (const [index, call] of batch.calls.entries()) {
              if (isBatchCallHandled(call)) continue;
              requireAccount();
              progress(`Call ${index + 1} of ${batch.calls.length} on chain ${call.chainId}.`);
              const client = getPublicClient(config, { chainId: call.chainId }) as
                PublicClient | undefined;
              if (!client) throw new Error("Destination RPC unavailable.");
              if (call.hash) {
                Object.assign(call, await verifyDirectResult(client, batch, call));
                saveMultichainBatch(batch);
                continue;
              }
              if (call.state === "submitting")
                throw new Error(
                  "The previous wallet submission has an unknown result. Reconcile it before resubmitting this batch.",
                );
              await requireRelayrRecoveryScopeAvailable(
                account,
                batchCallScope(batch, call, index),
              );
              if (await reconcileReadyCall(call, index)) continue;
              await verifyCallPreconditions(client, call.preconditions);
              direct.current = { batch, index };
              const variables = {
                chainId: call.chainId,
                address: call.address,
                abi: call.abi,
                functionName: call.functionName,
                args: call.args,
                value: call.value,
                gas: call.gas,
              };
              try {
                call.hash = reviewedHere
                  ? await writeReviewedAsync(variables)
                  : await writeContractAsync(variables);
              } catch (cause) {
                if (explicitRejection(cause)) {
                  call.state = "ready";
                  saveMultichainBatch(batch);
                }
                throw cause;
              }
              call.state = submittedViaSafe(call.hash) ? "safe" : "submitted";
              saveMultichainBatch(batch);
              if (call.state === "safe") {
                progress(
                  "Safe proposal saved. Execute it, then resume this batch; no other call will be proposed yet.",
                );
                return result("pending");
              }
              await client.waitForTransactionReceipt({ hash: call.hash });
              Object.assign(call, await verifyDirectResult(client, batch, call));
              saveMultichainBatch(batch);
            }
          }
          batch.status = "success";
          saveMultichainBatch(batch);
          updateTransactionActivity(batch.id, {
            status: batch.calls.some((call) => call.state === "reverted") ? "failed" : "success",
            manualVerificationRequired: false,
            message: batch.calls.some((call) => call.state === "reverted")
              ? "Batch review complete. Some routing transactions reverted. Refresh pending payments and prepare a new review for any remaining attempts."
              : batch.calls.some((call) => call.expectedRouterPending)
                ? "Selected routing attempts were verified or had already advanced onchain. Refresh pending payments to see which remain in gateway custody."
                : "Every selected call has a verified successful destination result.",
          });
          return result("success");
        } catch (cause) {
          if (batch) {
            let discarded = false;
            if (
              batch.calls.every((call) => call.state === "ready") &&
              batch.rounds.every((round) => round.state === "ready")
            ) {
              try {
                for (const [index, call] of batch.calls.entries())
                  await requireRelayrRecoveryScopeAvailable(
                    account,
                    batchCallScope(batch, call, index),
                  );
                removeUnsubmittedBatch(batch.id);
                discarded = true;
              } catch {
                /* A published authorization or inaccessible journal must remain locked. */
              }
            }
            updateTransactionActivity(batch.id, {
              status: discarded ? "failed" : "pending",
              manualVerificationRequired: !discarded,
              message:
                cause instanceof Error ? cause.message : "The saved batch needs reconciliation.",
            });
          }
          throw cause;
        } finally {
          direct.current = null;
          setIsPending(false);
        }
      };
      running.add(lock);
      try {
        return await (typeof navigator !== "undefined" && navigator.locks
          ? navigator.locks.request(lock, { ifAvailable: true }, (acquired) => {
              if (!acquired)
                throw new Error("Another browser tab is already processing a multichain batch.");
              return execute();
            })
          : execute());
      } finally {
        running.delete(lock);
      }
    },
    [config, getRelayrTxQuote, sendRelayrTx, writeContractAsync, writeReviewedAsync],
  );
  return { runBatch, getPendingBatch, isPending };
}
