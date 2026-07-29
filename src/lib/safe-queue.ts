"use client";

import { getAddress, hashTypedData, zeroAddress, type Address, type Hex } from "viem";

export type SafeConfirmation = { owner: Address; signature?: Hex | null };

export type SafeQueuedTransaction = {
  to: Address;
  value: string | number;
  data: Hex | null;
  operation: number;
  safeTxGas: string | number;
  baseGas: string | number;
  gasPrice: string | number;
  gasToken: Address;
  refundReceiver: Address;
  nonce: number;
  safeTxHash?: Hex;
  contractTransactionHash?: Hex;
  confirmationsRequired?: number;
  confirmations?: SafeConfirmation[];
};

export type SafePolicy = {
  owners: Address[];
  threshold: number;
  nonce: number;
};

export const SAFE_VIEW_ABI = [
  {
    type: "function",
    name: "getThreshold",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "getOwners",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "address[]" }],
  },
  {
    type: "function",
    name: "nonce",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
] as const;

export const SAFE_EXEC_ABI = [
  {
    type: "function",
    name: "execTransaction",
    stateMutability: "payable",
    inputs: [
      { name: "to", type: "address" },
      { name: "value", type: "uint256" },
      { name: "data", type: "bytes" },
      { name: "operation", type: "uint8" },
      { name: "safeTxGas", type: "uint256" },
      { name: "baseGas", type: "uint256" },
      { name: "gasPrice", type: "uint256" },
      { name: "gasToken", type: "address" },
      { name: "refundReceiver", type: "address" },
      { name: "signatures", type: "bytes" },
    ],
    outputs: [{ type: "bool" }],
  },
] as const;

export const SAFE_TX_TYPES = {
  SafeTx: [
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "data", type: "bytes" },
    { name: "operation", type: "uint8" },
    { name: "safeTxGas", type: "uint256" },
    { name: "baseGas", type: "uint256" },
    { name: "gasPrice", type: "uint256" },
    { name: "gasToken", type: "address" },
    { name: "refundReceiver", type: "address" },
    { name: "nonce", type: "uint256" },
  ],
} as const;

export const SAFE_SERVICE_PREFIX: Partial<Record<number, string>> = {
  1: "eth",
  10: "oeth",
  8453: "base",
  42161: "arb1",
  11155111: "sep",
};

function serviceBase(chainId: number): string | null {
  const prefix = SAFE_SERVICE_PREFIX[chainId];
  return prefix ? `https://api.safe.global/tx-service/${prefix}` : null;
}

export function safeQueueLink(chainId: number, safe: Address): string | null {
  const prefix = SAFE_SERVICE_PREFIX[chainId];
  return prefix ? `https://app.safe.global/transactions/queue?safe=${prefix}:${safe}` : null;
}

export function safeMessage(tx: SafeQueuedTransaction) {
  return {
    to: tx.to,
    value: BigInt(tx.value ?? 0),
    data: tx.data ?? "0x",
    operation: Number(tx.operation ?? 0),
    safeTxGas: BigInt(tx.safeTxGas ?? 0),
    baseGas: BigInt(tx.baseGas ?? 0),
    gasPrice: BigInt(tx.gasPrice ?? 0),
    gasToken: tx.gasToken ?? zeroAddress,
    refundReceiver: tx.refundReceiver ?? zeroAddress,
    nonce: BigInt(tx.nonce),
  };
}

export function safeTransactionHash(
  chainId: number,
  safe: Address,
  tx: SafeQueuedTransaction,
): Hex {
  return hashTypedData({
    domain: { chainId, verifyingContract: safe },
    types: SAFE_TX_TYPES,
    primaryType: "SafeTx",
    message: safeMessage(tx),
  });
}

export async function listPendingSafeTransactions(
  chainId: number,
  safe: Address,
  currentNonce: number,
): Promise<SafeQueuedTransaction[]> {
  const base = serviceBase(chainId);
  if (!base) throw new Error("Safe queue service is unavailable on this chain.");
  let next: string | null =
    `${base}/api/v1/safes/${getAddress(safe)}/multisig-transactions/?executed=false&trusted=true&ordering=nonce&limit=100&nonce__gte=${currentNonce}`;
  const transactions: SafeQueuedTransaction[] = [];
  for (let page = 0; next && page < 10; page += 1) {
    const response = await fetch(next);
    if (!response.ok) throw new Error(`Safe queue service returned ${response.status}.`);
    const body = (await response.json()) as {
      next?: string | null;
      results?: SafeQueuedTransaction[];
    };
    transactions.push(...(body.results ?? []));
    if (!body.next) {
      next = null;
    } else {
      const candidate = new URL(body.next, base).toString();
      if (!candidate.startsWith(`${base}/api/v1/`)) {
        throw new Error("Safe queue service returned an unexpected pagination URL.");
      }
      next = candidate;
    }
  }
  if (next) throw new Error("Safe queue has more than 1,000 pending transactions.");
  return transactions.filter((tx) => Number(tx.nonce) >= currentNonce);
}

export async function submitSafeConfirmation(
  chainId: number,
  tx: SafeQueuedTransaction,
  signature: Hex,
): Promise<void> {
  const base = serviceBase(chainId);
  const hash = tx.safeTxHash ?? tx.contractTransactionHash;
  if (!base || !hash) throw new Error("The queued Safe transaction has no service hash.");
  const response = await fetch(`${base}/api/v1/multisig-transactions/${hash}/confirmations/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ signature }),
  });
  if (!response.ok && response.status !== 201) {
    throw new Error(`Safe confirmation service returned ${response.status}.`);
  }
}

function signatureBytes(confirmation: SafeConfirmation): string | null {
  const signature = confirmation.signature?.replace(/^0x/, "");
  if (signature) return /^[0-9a-fA-F]{130}$/.test(signature) ? signature : null;
  if (!confirmation.owner) return null;
  return (
    confirmation.owner.replace(/^0x/, "").toLowerCase().padStart(64, "0") + "0".repeat(64) + "01"
  );
}

export function usableSafeConfirmations(
  tx: SafeQueuedTransaction,
  allowedOwners?: readonly Address[],
): SafeConfirmation[] {
  const allowed = allowedOwners ? new Set(allowedOwners.map((owner) => owner.toLowerCase())) : null;
  const byOwner = new Map<string, SafeConfirmation>();
  for (const confirmation of tx.confirmations ?? []) {
    if (!signatureBytes(confirmation)) continue;
    const key = confirmation.owner.toLowerCase();
    if (allowed && !allowed.has(key)) continue;
    const existing = byOwner.get(key);
    if (!existing || (!existing.signature && confirmation.signature)) {
      byOwner.set(key, confirmation);
    }
  }
  return [...byOwner.values()].sort((a, b) =>
    a.owner.toLowerCase().localeCompare(b.owner.toLowerCase()),
  );
}

export function safeExecutionArgs(tx: SafeQueuedTransaction, allowedOwners?: readonly Address[]) {
  const signatures = `0x${usableSafeConfirmations(tx, allowedOwners)
    .map(signatureBytes)
    .join("")}` as Hex;
  return [
    getAddress(tx.to),
    BigInt(tx.value ?? 0),
    tx.data ?? "0x",
    Number(tx.operation ?? 0),
    BigInt(tx.safeTxGas ?? 0),
    BigInt(tx.baseGas ?? 0),
    BigInt(tx.gasPrice ?? 0),
    tx.gasToken ?? zeroAddress,
    tx.refundReceiver ?? zeroAddress,
    signatures,
  ] as const;
}
