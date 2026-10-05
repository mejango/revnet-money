"use client";

import { useReviewedSafeSignature } from "@/hooks/useReviewedSafeSignature";
import {
  followSubmission,
  isSafeConnection,
  proposeSafeBatch,
  requireOnchainExecution,
  useWriteContract,
} from "@/hooks/useReviewedWriteContract";
import { composeBatch, type BatchCall, type BatchStep } from "@/lib/safe-batch";
import { confirmSafeExecution, SAFE_PROPOSAL_ORIGIN } from "@/lib/safe-transactions";
import { requireTransactionReview } from "@/lib/transaction-review";
import { waitForReceiptWithRetry } from "@/lib/waitForReceipt";
import type { JBChainId } from "@bananapus/nana-sdk-core";
import { simulateCallSequence } from "@bananapus/nana-sdk-core/review";
import {
  encodeMultiSend,
  MULTI_SEND_ABI,
  MULTI_SEND_CALL_ONLY,
  readAuthorityIdentity,
  readBoundedSafeApprovedHash,
  readBoundedSafeNonce,
} from "@bananapus/nana-sdk-core/safe";
import {
  hasSafeService,
  listPendingSafeTransactions,
  nextProposalNonce,
  onchainApprovalStep,
  proposeSafeTransaction,
  SAFE_EXEC_ABI,
  SAFE_NONCE_GUIDANCE,
  safeBatchProposalFor,
  safeExecutionArgs,
  safeTransactionHash,
  safeTransactionMatchesCall,
  submitSafeConfirmation,
  usableSafeConfirmations,
} from "@bananapus/nana-sdk-core/safe-service";
import { useQueryClient } from "@tanstack/react-query";
import {
  decodeFunctionData,
  encodeFunctionData,
  isAddressEqual,
  keccak256,
  stringToHex,
  type Address,
  type Hex,
} from "viem";
import { useConfig } from "wagmi";
import { getAccount } from "wagmi/actions";
import { chainName, operatorWriteRoute, publicClientFor, runSequentialWrites } from "./operatorLib";

/** How a chain's batch leaves the app, decided from (authority identity, connection). */
export type SafeBatchRoute =
  /** Connected through the Safe app as the authority itself: one MultiSend via wallet_sendCalls. */
  | { kind: "safe-app"; authority: Address }
  /** The authority is a Safe the connected wallet co-signs: one operation-1 SafeTx proposal. */
  | { kind: "safe-signer"; safe: Address; owners: Address[]; threshold: number }
  /** The connected wallet is the authority: sequential direct writes. */
  | { kind: "eoa"; authority: Address }
  | { kind: "refused"; message: string; authority?: Address };

export function routeSafeBatch({
  account,
  authority,
  identity,
  safeConnection,
  chainId,
  connectedChainId,
}: {
  account: Address | undefined;
  authority: Address | undefined;
  identity: Parameters<typeof operatorWriteRoute>[0]["identity"];
  safeConnection: boolean;
  /** The batch's chain and the wallet's; a Safe app cannot switch, so they must agree. */
  chainId?: number;
  connectedChainId?: number;
}): SafeBatchRoute {
  if (!account) return { kind: "refused", message: "Connect a wallet first.", authority };
  let route: ReturnType<typeof operatorWriteRoute>;
  try {
    route = operatorWriteRoute({ account, authority, identity });
  } catch (cause) {
    return { kind: "refused", message: (cause as Error).message, authority };
  }
  if (route.kind === "safe-signer") return route;
  const acting = authority ?? account;
  if (
    safeConnection &&
    chainId !== undefined &&
    connectedChainId !== undefined &&
    chainId !== connectedChainId
  ) {
    return {
      kind: "refused",
      message: `Open this Safe on ${chainName(chainId)} in Safe to propose this batch.`,
      authority: acting,
    };
  }
  return safeConnection
    ? { kind: "safe-app", authority: acting }
    : { kind: "eoa", authority: acting };
}

export type SafeBatchOutcome =
  | { kind: "proposed"; hash: Hex; calls: number }
  | { kind: "confirmed"; hash: Hex; calls: number }
  /** No Safe service: this owner's approval is onchain; the batch executes at the threshold. */
  | { kind: "approved"; hash: Hex; calls: number; approvals: number; threshold: number }
  | { kind: "executed"; hash: Hex; calls: number }
  | { kind: "sent"; transactions: number };

/**
 * The whole sequence simulated from the Safe by the SDK: as one sequence where
 * the RPC offers eth_simulateV1, otherwise each standalone call on its own,
 * leaving a call that depends on an earlier one to Safe's own batch simulation
 * before signing. Only a node that lacks the method takes the fallback; a
 * revert or a lagging node stops the batch.
 */
async function simulateFromSafe(
  chainId: number,
  safe: Address,
  steps: readonly BatchStep[],
  calls: readonly BatchCall[],
): Promise<void> {
  await simulateCallSequence(publicClientFor(chainId as JBChainId), {
    from: safe,
    chainName: chainName(chainId),
    calls: calls.map((call, index) => ({
      to: call.to,
      data: call.data,
      value: call.value,
      label: `${steps[index]!.label} (step ${index + 1})`,
      dependsOnPrior: call.dependsOnPrior,
    })),
  });
}

export function useSafeBatchSubmit() {
  const config = useConfig();
  const queryClient = useQueryClient();
  const { writeContractAsync } = useWriteContract();
  const { signSafeTransactionAsync } = useReviewedSafeSignature();
  // Onchain Safe writes carry their own review: the SafeTx they authorize and its decoded steps.
  // An owner's execution is journaled only once the Safe's event for its hash is read from the
  // receipt. Through a Safe connection the write is a proposal, tracked like any other.
  const { writeContractAsync: writeReviewedAsync } = useWriteContract({
    reviewedInParent: true,
    manualReceiptVerification: (variables) =>
      variables.functionName === "execTransaction" && !isSafeConnection(config),
  });

  const routeFor = async ({
    chainId,
    authority,
  }: {
    chainId: number;
    authority: Address | undefined;
  }): Promise<SafeBatchRoute> => {
    const account = getAccount(config).address;
    const identity =
      account && authority && !isAddressEqual(account, authority)
        ? await readAuthorityIdentity(publicClientFor(chainId as JBChainId), authority)
        : null;
    return routeSafeBatch({
      account,
      authority,
      identity,
      safeConnection: isSafeConnection(config),
      chainId,
      connectedChainId: getAccount(config).chainId,
    });
  };

  const submit = async ({
    chainId,
    steps,
    route,
    onProgress,
    onStep,
  }: {
    chainId: number;
    steps: readonly BatchStep[];
    route: SafeBatchRoute;
    onProgress: (message: string) => void;
    /** The index of the step the wallet is on (direct writes only). */
    onStep: (index: number) => void;
  }): Promise<SafeBatchOutcome> => {
    const account = getAccount(config).address;
    if (!account) throw new Error("Connect a wallet first.");
    if (!steps.length) throw new Error("The batch is empty.");
    const { calls, problems } = composeBatch(steps);
    if (problems.length) throw new Error(problems[0]!.message);
    const name = chainName(chainId);
    const title = `Batch on ${name} (${steps.length} call${steps.length === 1 ? "" : "s"})`;

    if (route.kind === "refused") throw new Error(route.message);

    if (route.kind === "safe-app") {
      onProgress(`Proposing the batch through the Safe app on ${name}…`);
      const hash = await proposeSafeBatch(
        config,
        chainId,
        title,
        steps.map((step, index) => ({
          address: step.to,
          abi: step.abi,
          functionName: step.functionName,
          args: step.args,
          label: step.label,
          dependsOnPrior: calls[index]!.dependsOnPrior,
        })),
      );
      return { kind: "proposed", hash, calls: steps.length };
    }

    if (route.kind === "eoa") {
      let transactions = 0;
      for (const [index, step] of steps.entries()) {
        onStep(index);
        transactions += await runSequentialWrites({
          writes: [
            {
              chainId: step.chainId as JBChainId,
              address: step.to,
              abi: step.abi,
              functionName: step.functionName,
              args: step.args,
              contractName: step.contractName,
            },
          ],
          account,
          writeContractAsync,
          onProgress,
        });
      }
      onStep(steps.length);
      return { kind: "sent", transactions };
    }

    const { safe } = route;
    const client = publicClientFor(chainId as JBChainId);
    onProgress(`Checking MultiSend on ${name}…`);
    const code = await client.getCode({ address: MULTI_SEND_CALL_ONLY });
    if (!code || code === "0x") {
      throw new Error(
        `Safe's MultiSendCallOnly is not deployed on ${name}, so a batch cannot be proposed there.`,
      );
    }
    // A proposal the Safe would revert on only wastes every signer's time.
    onProgress(`Simulating the batch on ${name} as the operator Safe…`);
    await simulateFromSafe(chainId, safe, steps, calls);

    onProgress(`Reading the Safe queue on ${name}…`);
    const nonce = await readBoundedSafeNonce(client, safe).catch(() => null);
    if (nonce === null || nonce > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new Error(`The operator Safe's nonce on ${name} could not be read.`);
    }
    const reverify = async (signer: Address) => {
      const live = await readAuthorityIdentity(client, safe);
      if (live?.kind !== "safe") {
        throw new Error(`The operator on ${name} is no longer a supported Safe.`);
      }
      if (!live.owners.some((owner) => isAddressEqual(owner, signer))) {
        throw new Error(
          `The connected wallet is no longer a signer of the operator Safe on ${name}.`,
        );
      }
    };

    const batchCall = {
      to: MULTI_SEND_CALL_ONLY,
      data: encodeMultiSend(calls),
      value: 0n,
      operation: 1 as const,
    };
    // The review decodes the MultiSend into the steps it packs.
    const review = {
      label: title,
      contractName: "MultiSendCallOnly",
      abi: MULTI_SEND_ABI,
      functionName: "multiSend",
      args: decodeFunctionData({ abi: MULTI_SEND_ABI, data: batchCall.data }).args,
      calls: steps.map((step) => ({
        chainId,
        to: step.to,
        data: step.data,
        value: step.value,
        label: step.label,
        abi: step.abi,
        functionName: step.functionName,
        args: step.args,
        contractName: step.contractName,
      })),
    };

    if (!hasSafeService(chainId)) {
      // No Safe service holds signatures here, so each owner approves the
      // exact SafeTx hash onchain. Co-signers build the same batch; the hash
      // matches only for the same steps, order, values and Safe nonce.
      // ponytail: approves at the Safe's current nonce; any other Safe tx executing first voids it.
      const tx = safeBatchProposalFor(calls, Number(nonce));
      const safeTxHash = safeTransactionHash(chainId, safe, tx);
      const live = await readAuthorityIdentity(client, safe);
      if (live?.kind !== "safe") {
        throw new Error(`The operator on ${name} is no longer a supported Safe.`);
      }
      const approvedFlags = await Promise.all(
        live.owners.map((owner) => readBoundedSafeApprovedHash(client, safe, owner, safeTxHash)),
      );
      if (approvedFlags.some((flag) => flag === null)) {
        throw new Error(`The operator Safe's approvals on ${name} could not be read.`);
      }
      const approved = live.owners.filter((_, index) => approvedFlags[index] !== 0n);
      const next = onchainApprovalStep({ account, approved, threshold: live.threshold });
      if (next.kind === "waiting") {
        return {
          kind: "approved",
          hash: safeTxHash,
          calls: steps.length,
          approvals: approved.length,
          threshold: live.threshold,
        };
      }
      const authorization = {
        safe,
        nonce: tx.nonce,
        safeTxHash,
        destinationCall: {
          to: tx.to,
          value: tx.value,
          data: tx.data ?? "0x",
          operation: tx.operation,
        },
      };
      const write =
        next.kind === "approve"
          ? {
              abi: SAFE_EXEC_ABI,
              functionName: "approveHash" as const,
              args: [safeTxHash] as const,
              label: `Approve batch on ${name}`,
              description: `${name} has no Safe transaction service, so this approval is recorded onchain. The batch executes once ${live.threshold} owners have approved the same batch.`,
              confirmLabel: "Agree & approve onchain",
            }
          : {
              abi: SAFE_EXEC_ABI,
              functionName: "execTransaction" as const,
              args: safeExecutionArgs(
                { ...tx, confirmations: next.signers.map((owner) => ({ owner })) },
                live.owners,
              ),
              label: `Execute batch on ${name}`,
              description: `${next.signers.length} of ${live.threshold} owners have approved this batch, counting you. Executing runs every step in order.`,
              confirmLabel: "Agree & execute",
            };
      // A Safe connection proposes this write with gas 0, reviewed as its Safe gas.
      const viaSafe = isSafeConnection(config);
      await requireTransactionReview({
        title: write.label,
        description: viaSafe ? `${write.description}\n\n${SAFE_NONCE_GUIDANCE}` : write.description,
        confirmLabel: viaSafe ? "Agree & propose to Safe" : write.confirmLabel,
        authorization,
        calls: [
          {
            chainId,
            to: safe,
            value: 0n,
            ...(viaSafe ? { safeTxGas: 0n } : {}),
            data: encodeFunctionData({
              abi: write.abi,
              functionName: write.functionName,
              args: write.args,
            } as Parameters<typeof encodeFunctionData>[0]),
            abi: write.abi,
            functionName: write.functionName,
            args: write.args,
            label: write.label,
            contractName: "Safe",
            calls: review.calls,
          },
        ],
      });
      await reverify(account);
      if (
        getAccount(config).address?.toLowerCase() !== account.toLowerCase() ||
        isSafeConnection(config) !== viaSafe
      ) {
        throw new Error("Wallet connection changed. Review the batch again.");
      }
      onProgress(`Confirm the ${write.functionName} transaction on ${name} in your wallet…`);
      const hash = await writeReviewedAsync({
        chainId,
        address: safe,
        abi: write.abi,
        functionName: write.functionName,
        args: write.args,
      } as Parameters<typeof writeReviewedAsync>[0]);
      requireOnchainExecution(hash, `${write.functionName} on ${name}`);
      onProgress(`Waiting for confirmation on ${name}…`);
      if (next.kind === "execute") {
        await confirmSafeExecution({ client, hash, safe, safeTxHash });
        return { kind: "executed", hash, calls: steps.length };
      }
      const receipt = await waitForReceiptWithRetry(client, hash);
      if (receipt.status !== "success") {
        throw new Error(`${write.functionName} reverted on ${name} (${hash}).`);
      }
      return {
        kind: "approved",
        hash: safeTxHash,
        calls: steps.length,
        approvals: approved.length + 1,
        threshold: live.threshold,
      };
    }

    const pending = await listPendingSafeTransactions(chainId, safe, Number(nonce));
    const existing = pending.find((tx) => safeTransactionMatchesCall(tx, batchCall));
    if (existing) {
      const confirmed = usableSafeConfirmations(existing, route.owners).some((confirmation) =>
        isAddressEqual(confirmation.owner, account),
      );
      if (!confirmed) {
        onProgress(`Sign the already-queued batch on ${name} in your wallet…`);
        const signature = await signSafeTransactionAsync({
          chainId,
          safe,
          tx: existing,
          reverify,
          review,
        });
        await submitSafeConfirmation(chainId, safe, existing, signature);
      }
      void queryClient.invalidateQueries({ queryKey: ["revnet-safe-queues"] });
      // Listed rows carry the hash of their own fields.
      return { kind: "confirmed", hash: existing.safeTxHash!, calls: steps.length };
    }

    const tx = safeBatchProposalFor(calls, nextProposalNonce(Number(nonce), pending));
    onProgress(`Sign the batch proposal for ${name} in your wallet…`);
    const signature = await signSafeTransactionAsync({ chainId, safe, tx, reverify, review });
    onProgress(`Queuing the proposal with the Safe service on ${name}…`);
    const hash = await proposeSafeTransaction(chainId, safe, tx, {
      sender: account,
      signature,
      origin: SAFE_PROPOSAL_ORIGIN,
    });
    void queryClient.invalidateQueries({ queryKey: ["revnet-safe-queues"] });
    const callKey = `batch:${account.toLowerCase()}:${chainId}:${keccak256(
      stringToHex(calls.map((call) => `${call.to}:${call.value}:${call.data}`).join("|")),
    )}`;
    followSubmission(
      config,
      hash,
      chainId,
      title,
      account,
      callKey,
      {
        safe,
        calls: calls.map((call) => ({ to: call.to, value: String(call.value), data: call.data })),
        batch: true,
      },
      false,
    );
    return { kind: "proposed", hash, calls: steps.length };
  };

  return { routeFor, submit };
}
