"use client";

import { useReviewedSafeSignature } from "@/hooks/useReviewedSafeSignature";
import {
  followSubmission,
  isSafeConnection,
  proposeSafeBatch,
  useWriteContract,
} from "@/hooks/useReviewedWriteContract";
import { readAuthorityIdentity, readBoundedSafeNonce } from "@/lib/cross-chain-authority";
import {
  composeBatch,
  encodeMultiSend,
  MULTI_SEND_CALL_ONLY,
  type BatchCall,
  type BatchStep,
} from "@/lib/safe-batch";
import {
  listPendingSafeTransactions,
  nextProposalNonce,
  proposeSafeTransaction,
  queuedTransactionMatchesCall,
  safeBatchProposalFor,
  safeQueueLink,
  submitSafeConfirmation,
} from "@/lib/safe-queue";
import type { JBChainId } from "@bananapus/nana-sdk-core";
import { useQueryClient } from "@tanstack/react-query";
import { isAddressEqual, keccak256, stringToHex, type Address, type Hex } from "viem";
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
}: {
  account: Address | undefined;
  authority: Address | undefined;
  identity: Parameters<typeof operatorWriteRoute>[0]["identity"];
  safeConnection: boolean;
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
  return safeConnection
    ? { kind: "safe-app", authority: acting }
    : { kind: "eoa", authority: acting };
}

export type SafeBatchOutcome =
  | { kind: "proposed"; hash: Hex; calls: number }
  | { kind: "confirmed"; hash: Hex; calls: number }
  | { kind: "sent"; transactions: number };

function isMissingMethod(cause: { code?: number; message?: string }): boolean {
  return (
    cause.code === -32601 ||
    cause.code === -32004 ||
    /not (?:allowed|supported|found|implemented)/i.test(cause.message ?? "")
  );
}

/**
 * The whole sequence simulated from the Safe where the RPC offers
 * eth_simulateV1; otherwise each standalone call on its own, leaving a call
 * that depends on an earlier one to Safe's own batch simulation before signing.
 */
async function simulateFromSafe(
  chainId: number,
  safe: Address,
  steps: readonly BatchStep[],
  calls: readonly BatchCall[],
): Promise<void> {
  const client = publicClientFor(chainId as JBChainId);
  const sequence = await client
    .simulateCalls({
      account: safe,
      calls: calls.map(({ to, data, value }) => ({ to, data, value })),
    })
    .then((simulated) => simulated.results)
    .catch((cause: { code?: number; message?: string }) => {
      if (isMissingMethod(cause)) return null;
      throw cause;
    });
  for (const [index, step] of steps.entries()) {
    if (sequence) {
      const result = sequence[index];
      if (result?.status === "success") continue;
      throw new Error(
        `${step.label} (step ${index + 1}) reverts in simulation from the Safe${
          result && "error" in result && result.error ? `: ${(result.error as Error).message}` : "."
        }`,
      );
    }
    if (calls[index]!.dependsOnPrior) continue;
    try {
      await client.simulateContract({
        account: safe,
        address: step.to,
        abi: step.abi,
        functionName: step.functionName,
        args: step.args as unknown[],
      });
    } catch (cause) {
      throw new Error(
        `${step.label} (step ${index + 1}) reverts in simulation from the Safe: ${
          (cause as { shortMessage?: string; message?: string }).shortMessage ??
          (cause as Error).message
        }`,
      );
    }
  }
}

export function useSafeBatchSubmit() {
  const config = useConfig();
  const queryClient = useQueryClient();
  const { writeContractAsync } = useWriteContract();
  const { signSafeTransactionAsync } = useReviewedSafeSignature();

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
    if (!safeQueueLink(chainId, safe)) {
      throw new Error("This chain has no Safe transaction service.");
    }
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
    const nonce = await readBoundedSafeNonce(client, safe);
    if (nonce === null || nonce > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new Error(`The operator Safe's nonce on ${name} could not be read.`);
    }
    const pending = await listPendingSafeTransactions(chainId, safe, Number(nonce));
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
      operation: 1,
    };
    const existing = pending.find((tx) => queuedTransactionMatchesCall(tx, batchCall));
    if (existing) {
      const confirmed = (existing.confirmations ?? []).some((confirmation) =>
        isAddressEqual(confirmation.owner, account),
      );
      if (!confirmed) {
        onProgress(`Sign the already-queued batch on ${name} in your wallet…`);
        const signature = await signSafeTransactionAsync({ chainId, safe, tx: existing, reverify });
        await submitSafeConfirmation(chainId, existing, signature);
      }
      void queryClient.invalidateQueries({ queryKey: ["revnet-safe-queues"] });
      return {
        kind: "confirmed",
        hash: (existing.safeTxHash ?? existing.contractTransactionHash ?? "0x") as Hex,
        calls: steps.length,
      };
    }

    const tx = safeBatchProposalFor(calls, nextProposalNonce(Number(nonce), pending));
    onProgress(`Sign the batch proposal for ${name} in your wallet…`);
    const signature = await signSafeTransactionAsync({ chainId, safe, tx, reverify });
    onProgress(`Queuing the proposal with the Safe service on ${name}…`);
    const hash = await proposeSafeTransaction(chainId, safe, tx, account, signature);
    void queryClient.invalidateQueries({ queryKey: ["revnet-safe-queues"] });
    const callKey = `batch:${account.toLowerCase()}:${chainId}:${keccak256(
      stringToHex(calls.map((call) => `${call.to}:${call.value}:${call.data}`).join("|")),
    )}`;
    followSubmission(config, hash, chainId, title, account, callKey, true, false);
    return { kind: "proposed", hash, calls: steps.length };
  };

  return { routeFor, submit };
}
