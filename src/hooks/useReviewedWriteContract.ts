"use client";

import {
  recordTransactionActivity,
  transactionActivityForHash,
  transactionActivitySnapshot,
  updateTransactionActivity,
  useTransactionActivities,
} from "@/lib/transaction-activity";
import { requireContractTransactionReview } from "@/lib/transaction-review";
import { getAccount, simulateContract, waitForTransactionReceipt } from "@wagmi/core";
import { useCallback, useMemo } from "react";
import {
  encodeFunctionData,
  type Abi,
  type Address,
  type Hex,
  type TransactionReceipt,
} from "viem";
import {
  useConfig,
  useWaitForTransactionReceipt as useWagmiWaitForTransactionReceipt,
  useWriteContract as useWagmiWriteContract,
} from "wagmi";

const SAFE_PREFIX: Partial<Record<number, string>> = {
  1: "eth",
  10: "oeth",
  8453: "base",
  42161: "arb1",
  11155111: "sep",
};
const safeInflight = new Map<string, Promise<void>>();

async function watchSafeProposal(id: string, hash: Hex, chainId: number): Promise<void> {
  const prefix = SAFE_PREFIX[chainId];
  if (!prefix) return;
  const existing = safeInflight.get(id);
  if (existing) return existing;
  const request = (async () => {
    for (let attempt = 0; attempt < 720; attempt += 1) {
      try {
        const response = await fetch(
          `https://api.safe.global/tx-service/${prefix}/api/v1/multisig-transactions/${hash}/`,
        );
        if (response.ok) {
          const transaction = (await response.json()) as {
            isExecuted?: boolean;
            isSuccessful?: boolean | null;
            transactionHash?: Hex | null;
            confirmations?: unknown[];
            confirmationsRequired?: number;
          };
          if (transaction.isExecuted) {
            if (transaction.isSuccessful == null) {
              updateTransactionActivity(id, {
                status: "safe-proposed",
                executionHash: transaction.transactionHash ?? undefined,
                message:
                  "Safe reports this proposal as executed, but its success result is not available yet. Do not submit it again while confirmation is unresolved.",
              });
              await new Promise((resolve) => window.setTimeout(resolve, 5_000));
              continue;
            }
            updateTransactionActivity(id, {
              status: transaction.isSuccessful ? "success" : "failed",
              executionHash: transaction.transactionHash ?? undefined,
              message: !transaction.isSuccessful
                ? "Safe executed this proposal, but the onchain transaction failed."
                : `Safe approvals completed and the proposal executed onchain${transaction.transactionHash ? ` as ${transaction.transactionHash}` : ""}.`,
            });
            return;
          }
          const approvals = transaction.confirmations?.length ?? 0;
          const required = transaction.confirmationsRequired;
          updateTransactionActivity(id, {
            status: "safe-proposed",
            message: `Safe proposal is not executed${required ? ` · ${approvals}/${required} approvals` : ""}. It remains asynchronous; do not submit it again.`,
          });
        }
      } catch {
        updateTransactionActivity(id, {
          status: "safe-proposed",
          message:
            "Safe proposal submitted, but its service is temporarily unavailable. It is not confirmed executed; check Safe before retrying.",
        });
      }
      await new Promise((resolve) => window.setTimeout(resolve, 5_000));
    }
  })();
  safeInflight.set(id, request);
  void request.finally(() => safeInflight.delete(id)).catch(() => undefined);
  return request;
}

export function resumeSafeProposalTracking(): void {
  transactionActivitySnapshot()
    .filter((activity) => activity.status === "safe-proposed" && activity.hash && activity.chainId)
    .forEach((activity) => void watchSafeProposal(activity.id, activity.hash!, activity.chainId!));
}

function isSafeConnection(config: ReturnType<typeof useConfig>): boolean {
  const connector = getAccount(config).connector;
  return `${connector?.id ?? ""} ${connector?.name ?? ""}`.toLowerCase().includes("safe");
}

function followSubmission(
  config: ReturnType<typeof useConfig>,
  hash: Hex,
  chainId: number,
  title: string,
  account: Address,
  callKey: string,
): void {
  const id = `tx:${chainId}:${hash.toLowerCase()}`;
  const safe = isSafeConnection(config);
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
    callKey,
  });
  if (safe) {
    void watchSafeProposal(id, hash, chainId);
    return;
  }
  updateTransactionActivity(id, { status: "pending", message: "Pending onchain confirmation." });
  void waitForTransactionReceipt(config, { chainId, hash })
    .then((receipt) => {
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
        message:
          "Submitted, but this RPC could not confirm the receipt. Check the transaction before retrying.",
      });
    });
}

export function useWriteContract(
  options?: Parameters<typeof useWagmiWriteContract>[0],
): ReturnType<typeof useWagmiWriteContract> {
  const config = useConfig();
  const mutation = useWagmiWriteContract(options);

  const writeContractAsync = useCallback(
    async (variables: Parameters<typeof mutation.writeContractAsync>[0]) => {
      const before = getAccount(config);
      if (!before.address) throw new Error("Connect a wallet first.");
      const chainId = Number(variables.chainId ?? before.chainId);
      if (!chainId) throw new Error("Select a network before continuing.");
      const functionName = String(variables.functionName);
      const callKey = `${before.address.toLowerCase()}:${chainId}:${variables.address.toLowerCase()}:${variables.value ?? 0n}:${encodeFunctionData(
        {
          abi: variables.abi as Abi,
          functionName,
          args: variables.args,
        },
      )}`;
      const duplicate = transactionActivitySnapshot().find(
        (activity) =>
          activity.callKey === callKey &&
          (activity.status === "submitted" ||
            activity.status === "pending" ||
            activity.status === "safe-proposed"),
      );
      if (duplicate?.hash) {
        if (duplicate.status === "safe-proposed") {
          throw new SafeProposalPendingError(duplicate.hash, functionName);
        }
        throw new Error(
          `An identical ${functionName} transaction is already pending as ${duplicate.hash}. Check it before submitting again.`,
        );
      }

      await requireContractTransactionReview(
        {
          chainId,
          address: variables.address,
          abi: variables.abi as Abi,
          functionName,
          args: variables.args,
          value: variables.value,
          account: before.address,
        },
        {
          title: `Review ${functionName}`,
          label: functionName,
          confirmLabel: isSafeConnection(config) ? "Agree & propose to Safe" : "Agree & continue",
        },
      );

      const reviewedAccount = getAccount(config).address;
      if (!reviewedAccount || reviewedAccount.toLowerCase() !== before.address.toLowerCase()) {
        throw new Error("Connected account changed. Review the transaction again.");
      }

      const simulation = await simulateContract(config, {
        ...variables,
        chainId,
        account: reviewedAccount,
      } as Parameters<typeof simulateContract>[1]);
      const liveAccount = getAccount(config).address;
      if (!liveAccount || liveAccount.toLowerCase() !== reviewedAccount.toLowerCase()) {
        throw new Error("Connected account changed. Review the transaction again.");
      }
      const hash = await mutation.writeContractAsync(
        simulation.request as Parameters<typeof mutation.writeContractAsync>[0],
      );
      followSubmission(config, hash, chainId, functionName, reviewedAccount, callKey);
      return hash;
    },
    [config, mutation],
  );

  const writeContract = useCallback(
    (
      variables: Parameters<typeof mutation.writeContract>[0],
      callbacks?: Parameters<typeof mutation.writeContract>[1],
    ) => {
      void writeContractAsync(variables as Parameters<typeof mutation.writeContractAsync>[0]).then(
        (hash) => callbacks?.onSuccess?.(hash, variables, undefined),
        (error) => callbacks?.onError?.(error, variables, undefined),
      );
    },
    [mutation, writeContractAsync],
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
  const tracked = useMemo(
    () => activities.find((row) => row.hash?.toLowerCase() === hash?.toLowerCase()),
    [activities, hash],
  );
  const isSafeSubmission = tracked?.kind === "safe";
  const isSafeProposal = tracked?.status === "safe-proposed";
  const query = useWagmiWaitForTransactionReceipt({
    ...parameters,
    query: {
      ...parameters.query,
      enabled: (parameters.query?.enabled ?? true) && !!hash && !isSafeSubmission,
    },
  });
  const receipt = query.data as TransactionReceipt | undefined;
  const reverted = receipt?.status === "reverted";
  return {
    ...query,
    isLoading: isSafeSubmission ? isSafeProposal : query.isLoading,
    isSuccess: isSafeSubmission
      ? tracked?.status === "success"
      : query.isSuccess && receipt?.status === "success",
    isError: isSafeSubmission ? tracked?.status === "failed" : query.isError || reverted,
    error:
      isSafeSubmission && tracked?.status === "failed"
        ? new Error(tracked.message)
        : reverted
          ? new Error(`Transaction ${hash} reverted onchain.`)
          : query.error,
    isSafeProposal,
    statusMessage: tracked?.message,
  };
}

export function submittedViaSafe(hash?: Hex): boolean {
  return transactionActivityForHash(hash)?.status === "safe-proposed";
}

export class SafeProposalPendingError extends Error {
  readonly name = "SafeProposalPendingError";

  constructor(
    readonly hash: Hex,
    action: string,
  ) {
    super(
      `${action} was proposed to Safe as ${hash}, but it has not executed. Complete its approvals and execution in Safe, then resume; do not submit it again.`,
    );
  }
}

export function isSafeProposalPendingError(error: unknown): error is SafeProposalPendingError {
  return error instanceof SafeProposalPendingError;
}

/** Stop dependent steps after a Safe connector returns an asynchronous proposal hash. */
export function requireOnchainExecution(hash: Hex, action: string): void {
  if (!submittedViaSafe(hash)) return;
  throw new SafeProposalPendingError(hash, action);
}
