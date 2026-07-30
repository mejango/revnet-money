"use client";

import { useCompleteProjectPermissions } from "@/hooks/useCompleteBendystrawLists";
import { useReviewedSafeSignature } from "@/hooks/useReviewedSafeSignature";
import { useWriteContract } from "@/hooks/useReviewedWriteContract";
import { pickRevnetOperator } from "@/lib/revnetOperator";
import {
  SAFE_EXEC_ABI,
  SAFE_VIEW_ABI,
  listPendingSafeTransactions,
  safeExecutionArgs,
  safeQueueLink,
  safeTransactionHash,
  submitSafeConfirmation,
  usableSafeConfirmations,
  type SafePolicy,
  type SafeQueuedTransaction,
} from "@/lib/safe-queue";
import { requireTransactionReview } from "@/lib/transaction-review";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { encodeFunctionData, isAddress, type Address } from "viem";
import { useAccount } from "wagmi";
import {
  chainName,
  permissionHoldersWhere,
  publicClientFor,
  type ChainProjectRow,
} from "./operatorLib";

type QueueRow = {
  chainId: ChainProjectRow["chainId"];
  safe: Address;
  policy: SafePolicy;
  transactions: SafeQueuedTransaction[];
  queueError?: string;
};

export function SafeQueueCard({
  rows,
  fallbackOperator,
}: {
  rows: ChainProjectRow[];
  fallbackOperator?: string;
}) {
  const { address } = useAccount();
  const { signSafeTransactionAsync } = useReviewedSafeSignature();
  const { writeContractAsync } = useWriteContract();
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const holders = useCompleteProjectPermissions(
    permissionHoldersWhere(rows, { isRevnetOperator: true }),
    rows.length > 0,
  );
  const operatorByChain = useMemo(() => {
    const map = new Map<number, Address>();
    for (const row of rows) {
      const indexed = pickRevnetOperator(
        (holders.data ?? []).filter(
          (item) => item.chainId === row.chainId && item.projectId === row.projectId,
        ),
      );
      if (indexed) map.set(row.chainId, indexed);
      else if (fallbackOperator && isAddress(fallbackOperator)) {
        map.set(row.chainId, fallbackOperator as Address);
      }
    }
    return map;
  }, [fallbackOperator, holders.data, rows]);
  const operatorKey = rows
    .map((row) => `${row.chainId}:${operatorByChain.get(row.chainId) ?? ""}`)
    .join(",");

  const queue = useQuery({
    queryKey: ["revnet-safe-queues", operatorKey],
    enabled: !holders.isLoading && operatorByChain.size > 0,
    staleTime: 15_000,
    queryFn: async (): Promise<QueueRow[]> => {
      const results = await Promise.all(
        rows.map(async (row): Promise<QueueRow | null> => {
          const safe = operatorByChain.get(row.chainId);
          if (!safe) return null;
          const client = publicClientFor(row.chainId);
          try {
            const [owners, threshold, nonce] = await Promise.all([
              client.readContract({ address: safe, abi: SAFE_VIEW_ABI, functionName: "getOwners" }),
              client.readContract({
                address: safe,
                abi: SAFE_VIEW_ABI,
                functionName: "getThreshold",
              }),
              client.readContract({ address: safe, abi: SAFE_VIEW_ABI, functionName: "nonce" }),
            ]);
            if (!owners.length || threshold <= 0n) return null;
            const policy = {
              owners: owners as Address[],
              threshold: Number(threshold),
              nonce: Number(nonce),
            };
            let transactions: SafeQueuedTransaction[] = [];
            let queueError: string | undefined;
            try {
              transactions = await listPendingSafeTransactions(row.chainId, safe, policy.nonce);
            } catch (cause) {
              queueError =
                cause instanceof Error ? cause.message : "Safe queue service is unavailable.";
            }
            return {
              chainId: row.chainId,
              safe,
              policy,
              transactions,
              queueError,
            };
          } catch {
            return null;
          }
        }),
      );
      return results.filter((row): row is QueueRow => row !== null);
    },
  });

  if (queue.isLoading || !queue.data?.length) return null;

  const sign = async (row: QueueRow, tx: SafeQueuedTransaction) => {
    if (!address) return;
    const key = `sign:${row.chainId}:${tx.nonce}`;
    setBusy(key);
    setError(null);
    setNotice(null);
    try {
      if (!row.policy.owners.some((owner) => owner.toLowerCase() === address.toLowerCase())) {
        throw new Error("The connected account is not an owner of this Safe.");
      }
      const signature = await signSafeTransactionAsync({
        chainId: row.chainId,
        safe: row.safe,
        tx,
      });
      await submitSafeConfirmation(row.chainId, tx, signature);
      setNotice(`Signed Safe transaction #${tx.nonce} on ${chainName(row.chainId)}.`);
      await queue.refetch();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not sign the Safe transaction.");
    } finally {
      setBusy(null);
    }
  };

  const execute = async (row: QueueRow, tx: SafeQueuedTransaction) => {
    const key = `execute:${row.chainId}:${tx.nonce}`;
    setBusy(key);
    setError(null);
    setNotice(null);
    try {
      const args = safeExecutionArgs(tx, row.policy.owners);
      const data = encodeFunctionData({
        abi: SAFE_EXEC_ABI,
        functionName: "execTransaction",
        args,
      });
      await requireTransactionReview({
        title: "Review Safe execution",
        description:
          "The outer call executes the exact queued destination shown below. Same-nonce alternatives remain unexecuted.",
        confirmLabel: "Agree & execute Safe transaction",
        authorization: {
          safe: row.safe,
          nonce: tx.nonce,
          safeTxHash: safeTransactionHash(row.chainId, row.safe, tx),
          destinationCall: {
            to: tx.to,
            value: tx.value,
            data: tx.data ?? "0x",
            operation: tx.operation,
          },
        },
        calls: [
          {
            chainId: row.chainId,
            to: row.safe,
            value: 0n,
            data,
            abi: SAFE_EXEC_ABI,
            functionName: "execTransaction",
            args,
            label: `Execute Safe transaction #${tx.nonce}`,
            contractName: "Safe",
          },
        ],
      });
      await writeContractAsync({
        chainId: row.chainId,
        address: row.safe,
        abi: SAFE_EXEC_ABI,
        functionName: "execTransaction",
        args,
      });
      setNotice(`Submitted Safe transaction #${tx.nonce} on ${chainName(row.chainId)}.`);
      await queue.refetch();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not execute the Safe transaction.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="border border-melon-300 bg-melon-25 p-4">
      <h2 className="font-bold">Pending multisig transactions</h2>
      <p className="mt-1 text-sm text-melon-800">
        Safe signers can inspect, co-sign, and execute operator proposals without leaving Revnet.
      </p>
      <div className="mt-4 space-y-4">
        {queue.data.map((row) => (
          <div key={`${row.chainId}:${row.safe}`} className="border border-melon-200 bg-white p-3">
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm font-bold">
                {chainName(row.chainId)} · nonce {row.policy.nonce}
              </span>
              {safeQueueLink(row.chainId, row.safe) ? (
                <a
                  className="text-xs underline"
                  target="_blank"
                  rel="noreferrer"
                  href={safeQueueLink(row.chainId, row.safe)!}
                >
                  Safe fallback ↗
                </a>
              ) : null}
            </div>
            {row.queueError ? (
              <p className="mt-2 text-sm text-red-700" role="alert">
                {row.queueError}
                {safeQueueLink(row.chainId, row.safe)
                  ? " Use the Safe fallback above to inspect the queue."
                  : " Inspect this Safe in a client that supports this chain."}
              </p>
            ) : row.transactions.length === 0 ? (
              <p className="mt-2 text-sm text-zinc-500">No pending transactions.</p>
            ) : (
              <ul className="mt-2 divide-y divide-melon-100">
                {row.transactions.map((tx) => {
                  const confirmations = usableSafeConfirmations(tx, row.policy.owners);
                  const signed = confirmations.some(
                    (confirmation) =>
                      address && confirmation.owner.toLowerCase() === address.toLowerCase(),
                  );
                  const ready = confirmations.length >= row.policy.threshold;
                  const current = Number(tx.nonce) === row.policy.nonce;
                  return (
                    <li key={`${tx.nonce}:${tx.safeTxHash ?? tx.data}`} className="py-3 text-xs">
                      <details>
                        <summary className="cursor-pointer font-bold">
                          #{tx.nonce} · {tx.data?.slice(0, 10) ?? "0x"} · {confirmations.length}/
                          {row.policy.threshold} signatures
                        </summary>
                        <div className="mt-2 break-all bg-melon-50 p-2 font-mono">
                          <p>To: {tx.to}</p>
                          <p>Value: {String(tx.value ?? 0)} wei</p>
                          <p>Data: {tx.data ?? "0x"}</p>
                        </div>
                      </details>
                      <div className="mt-2 flex gap-2">
                        {!signed && !ready ? (
                          <button
                            type="button"
                            className="border border-melon-500 px-3 py-1 disabled:opacity-50"
                            disabled={busy !== null || !address}
                            onClick={() => void sign(row, tx)}
                          >
                            {busy === `sign:${row.chainId}:${tx.nonce}` ? "Signing…" : "Sign"}
                          </button>
                        ) : null}
                        {ready ? (
                          <button
                            type="button"
                            className="bg-melon-700 px-3 py-1 text-white disabled:opacity-50"
                            disabled={busy !== null || !current}
                            title={
                              current ? undefined : `Nonce ${row.policy.nonce} must execute first.`
                            }
                            onClick={() => void execute(row, tx)}
                          >
                            {busy === `execute:${row.chainId}:${tx.nonce}`
                              ? "Executing…"
                              : "Execute"}
                          </button>
                        ) : null}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        ))}
      </div>
      {notice ? <p className="mt-3 text-sm text-melon-800">{notice}</p> : null}
      {error ? (
        <p className="mt-3 text-sm text-peel-700" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}
