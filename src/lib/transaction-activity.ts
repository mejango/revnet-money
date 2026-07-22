"use client";

import { useSyncExternalStore } from "react";
import type { Address, Hex } from "viem";

export type TransactionActivityStatus =
  | "submitted"
  | "pending"
  | "safe-proposed"
  | "success"
  | "failed";

export type TransactionActivity = {
  id: string;
  kind: "direct" | "safe" | "relayr-payment" | "relayr-bundle";
  title: string;
  status: TransactionActivityStatus;
  message: string;
  chainId?: number;
  account?: Address;
  hash?: Hex;
  safeProposalHash?: Hex;
  executionHash?: Hex;
  bundleUuid?: string;
  chainStates?: Array<{
    chainId: number;
    status: string;
    hash?: Hex;
  }>;
  callKey?: string;
  createdAt: number;
  updatedAt: number;
};

const STORAGE_KEY = "revnet:transaction-activities:v1";
const EMPTY: TransactionActivity[] = [];
let snapshot: TransactionActivity[] = EMPTY;
let hydrated = false;
const listeners = new Set<() => void>();

function hydrate(): void {
  if (hydrated || typeof window === "undefined") return;
  hydrated = true;
  try {
    const parsed = JSON.parse(
      window.localStorage.getItem(STORAGE_KEY) ?? "[]",
    ) as TransactionActivity[];
    if (Array.isArray(parsed)) snapshot = parsed.slice(0, 20);
  } catch {
    snapshot = EMPTY;
  }
}

function emit(next: TransactionActivity[]): void {
  snapshot = next.slice(0, 20);
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
    } catch {
      // Status remains available for this session when storage is unavailable.
    }
  }
  listeners.forEach((listener) => listener());
}

export function transactionActivitySnapshot(): TransactionActivity[] {
  hydrate();
  return snapshot;
}

export function subscribeTransactionActivities(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useTransactionActivities(): TransactionActivity[] {
  return useSyncExternalStore(
    subscribeTransactionActivities,
    transactionActivitySnapshot,
    () => EMPTY,
  );
}

export function recordTransactionActivity(
  activity: Omit<TransactionActivity, "createdAt" | "updatedAt"> &
    Partial<Pick<TransactionActivity, "createdAt" | "updatedAt">>,
): TransactionActivity {
  hydrate();
  const now = Date.now();
  const current = snapshot.find((row) => row.id === activity.id);
  const next: TransactionActivity = {
    ...current,
    ...activity,
    createdAt: activity.createdAt ?? current?.createdAt ?? now,
    updatedAt: activity.updatedAt ?? now,
  };
  emit([next, ...snapshot.filter((row) => row.id !== next.id)]);
  return next;
}

export function updateTransactionActivity(
  id: string,
  patch: Partial<Omit<TransactionActivity, "id" | "createdAt">>,
): void {
  hydrate();
  const current = snapshot.find((row) => row.id === id);
  if (!current) return;
  emit([
    { ...current, ...patch, updatedAt: Date.now() },
    ...snapshot.filter((row) => row.id !== id),
  ]);
}

export function dismissTransactionActivity(id: string): void {
  hydrate();
  emit(snapshot.filter((row) => row.id !== id));
}

export function transactionActivityForHash(hash?: Hex): TransactionActivity | undefined {
  if (!hash) return undefined;
  return transactionActivitySnapshot().find(
    (row) => row.hash?.toLowerCase() === hash.toLowerCase(),
  );
}
