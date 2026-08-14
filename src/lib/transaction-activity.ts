"use client";

import { useSyncExternalStore } from "react";
import type { Address, Hex } from "viem";

export type TransactionActivityStatus =
  "submitted" | "pending" | "safe-proposed" | "success" | "failed";

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
  /** A caller-specific receipt/postcondition check must pass before success is trusted. */
  manualVerificationRequired?: boolean;
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
const MAX_TERMINAL_ACTIVITIES = 20;
const EMPTY: TransactionActivity[] = [];
let snapshot: TransactionActivity[] = EMPTY;
let hydrated = false;
let persistedValue: string | null | undefined;
let storageWriteFailed = false;
const listeners = new Set<() => void>();

function isInFlight(activity: TransactionActivity): boolean {
  return (
    activity.manualVerificationRequired === true ||
    activity.status === "submitted" ||
    activity.status === "pending" ||
    activity.status === "safe-proposed"
  );
}

/**
 * Keep every unresolved activity so its persisted call key continues to block
 * an identical submission after a reload. Only completed history is cosmetic
 * and may be capped.
 */
function retainActivities(activities: TransactionActivity[]): TransactionActivity[] {
  let terminalCount = 0;
  return activities.filter((activity) => {
    if (isInFlight(activity)) return true;
    terminalCount += 1;
    return terminalCount <= MAX_TERMINAL_ACTIVITIES;
  });
}

function hydrate(): void {
  if (hydrated || typeof window === "undefined") return;
  hydrated = true;
  try {
    persistedValue = window.localStorage.getItem(STORAGE_KEY);
    const parsed = JSON.parse(persistedValue ?? "[]") as TransactionActivity[];
    if (Array.isArray(parsed)) snapshot = retainActivities(parsed);
  } catch {
    snapshot = EMPTY;
  }
}

function emit(next: TransactionActivity[]): void {
  snapshot = retainActivities(next);
  if (typeof window !== "undefined") {
    try {
      const serialized = JSON.stringify(snapshot);
      window.localStorage.setItem(STORAGE_KEY, serialized);
      persistedValue = serialized;
      storageWriteFailed = false;
    } catch {
      // Status remains available for this session when storage is unavailable.
      storageWriteFailed = true;
    }
  }
  listeners.forEach((listener) => listener());
}

/**
 * Re-read the persisted lock set before a write. Storage events are not sent
 * to the tab which made a change, and an already-open sibling tab may have
 * hydrated before another tab proposed a Safe transaction.
 */
export function refreshTransactionActivities(): TransactionActivity[] {
  hydrate();
  if (typeof window === "undefined" || storageWriteFailed) return snapshot;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === persistedValue) return snapshot;
    persistedValue = raw;
    const parsed = JSON.parse(raw ?? "[]") as TransactionActivity[];
    snapshot = Array.isArray(parsed) ? retainActivities(parsed) : EMPTY;
    listeners.forEach((listener) => listener());
  } catch {
    // A malformed or inaccessible sibling-tab value is not trusted.
    snapshot = EMPTY;
  }
  return snapshot;
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
  refreshTransactionActivities();
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
  refreshTransactionActivities();
  const current = snapshot.find((row) => row.id === id);
  if (!current) return;
  const guardedPatch =
    current.manualVerificationRequired &&
    patch.status === "success" &&
    patch.manualVerificationRequired !== false
      ? { ...patch, status: current.status, message: current.message }
      : patch;
  emit([
    { ...current, ...guardedPatch, updatedAt: Date.now() },
    ...snapshot.filter((row) => row.id !== id),
  ]);
}

/**
 * Quarantine a mined write whose action-specific verification did not finish.
 * The hash remains an in-flight dedupe lock, and the generic receipt watcher
 * cannot overwrite it with a false-success message later.
 */
export function holdTransactionActivityForVerification(hash: Hex, message: string): void {
  const current = transactionActivityForHash(hash);
  if (!current) return;
  updateTransactionActivity(current.id, {
    status: "pending",
    message,
    manualVerificationRequired: true,
  });
}

export function failTransactionActivityVerification(hash: Hex, message: string): void {
  const current = transactionActivityForHash(hash);
  if (!current) return;
  updateTransactionActivity(current.id, {
    status: "failed",
    message,
    manualVerificationRequired: true,
  });
}

export function releaseTransactionActivityVerification(hash: Hex, message: string): void {
  const current = transactionActivityForHash(hash);
  if (!current) return;
  updateTransactionActivity(current.id, {
    status: "success",
    message,
    manualVerificationRequired: false,
  });
}

export function dismissTransactionActivity(id: string): void {
  refreshTransactionActivities();
  emit(snapshot.filter((row) => row.id !== id));
}

export function transactionActivityForHash(hash?: Hex): TransactionActivity | undefined {
  if (!hash) return undefined;
  return transactionActivitySnapshot().find(
    (row) => row.hash?.toLowerCase() === hash.toLowerCase(),
  );
}
