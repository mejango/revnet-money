"use client";

import type { RelayrPostBundleResponse } from "@/lib/nana/types";
import type { MetadataSourceGuard } from "@/lib/project-metadata-write";
import {
  parseReviewedWriteRecoveryRecord,
  type ReviewedWriteRecoveryRecord,
} from "@bananapus/nana-sdk-core/review";
import type { RelayrDiscardReason } from "@bananapus/nana-sdk-core/review/relayr";
import type { SafeRelayrSession } from "@bananapus/nana-sdk-core/review/safe-relayr";
import type { ExpectedPayoutReceipt, ExpectedReservedReceipt } from "@bananapus/nana-sdk-core/v6";
import { useSyncExternalStore } from "react";
import { isHash, type Address, type Hex } from "viem";
import type {
  CallPrecondition,
  ExpectedPayerDeployment,
  ExpectedSafeExecution,
  RejectedReceiptEvent,
} from "./multichain-guards";
import type { RouterPendingReceiptGuard } from "./pending-router-calls";
import { createRecordStorage, type RecordVersion } from "./record-storage";
import type { ReviewedSafeProposal } from "./safe-transactions";

export type TransactionActivityStatus =
  "submitted" | "pending" | "safe-proposed" | "success" | "failed";

/** Exact signed outer calls, retained so an API status cannot substitute another transaction. */
export type RelayrExpectedTransaction = {
  chainId: number;
  target: Address;
  data: Hex;
  value: string;
  transactionUuid: string;
  /** Canonical receipt outcome; a reverted permissionless attempt is consumed. */
  receiptStatus?: "success" | "reverted";
  gas?: string;
  metadataSource?: MetadataSourceGuard;
  preconditions?: CallPrecondition[];
  expectedDeployment?: ExpectedPayerDeployment;
  rejectEvents?: RejectedReceiptEvent[];
  reservedReceipt?: ExpectedReservedReceipt;
  expectedPayout?: ExpectedPayoutReceipt;
  expectedRouterPending?: RouterPendingReceiptGuard;
  expectedSafeExecution?: ExpectedSafeExecution;
};

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
  /** The Safe a proposal was made to and the calls it was reviewed to run, values as strings. */
  safeProposal?: ReviewedSafeProposal;
  /** Its authenticated call became permanently obsolete; keep nonce cancellation guidance. */
  obsoleteSafeNonce?: number;
  /**
   * The app can't confirm this Safe proposal's result: its watch has ended, and it blocks an
   * identical call until its account dismisses it.
   */
  safeResultUnconfirmed?: boolean;
  executionHash?: Hex;
  /** When the chain first answered that it holds no receipt for a Safe proposal's `executionHash`. */
  executionSeenAt?: number;
  bundleUuid?: string;
  /** Stable SDK session identity while a publication receives its bundle UUID. */
  relayrSafeSessionId?: string;
  /** Preserve the SDK's release decision, including cancellation before publication. */
  relayrSafeState?: SafeRelayrSession["state"];
  /** Why the SDK proved that this saved Safe execution no longer reserves its nonce. */
  relayrSafeReleaseReason?: SafeRelayrSession["releaseReason"];
  /** Retain opaque/incomplete legacy reservations when the SDK saves their recovery state. */
  relayrSafeReservationKeys?: string[];
  /** A Safe funding wallet invocation has not produced a known hash yet. */
  relayrSafeFundingUnknown?: boolean;
  /** Relayr has reported funding or execution, even if no local payment hash was captured. */
  relayrSafeFundingObserved?: boolean;
  relayrExpectedTransactions?: RelayrExpectedTransaction[];
  relayrPayment?: { target: Address; data: Hex; value: string };
  /** Every funding payment the wallet broadcast for this bundle, oldest first. */
  relayrPayments?: Array<{ hash: Hex; chainId: number; target: Address; data: Hex; value: string }>;
  relayrCallKeys?: string[];
  relayrQuote?: RelayrPostBundleResponse;
  /**
   * The forwarder nonce each request in `relayrExpectedTransactions` was signed with, in order, in
   * decimal. Saved only when every request is a forward request.
   */
  relayrNonces?: string[];
  /**
   * Every request this session published is dead at a canonical finalized block, and why (ruling
   * R114). Discard ends it; until then a session that may have run still reserves its calls.
   */
  relayrDiscardable?: RelayrDiscardReason;
  /**
   * "expired": a quote nothing can fund any more, proven onchain, or one a new quote for its calls
   * replaced at the same forwarder nonces. It no longer reserves its calls.
   */
  relayrPaymentStatus?: "unfunded" | "submitted" | "confirmed" | "reverted" | "expired";
  /** A caller-specific receipt/postcondition check must pass before success is trusted. */
  manualVerificationRequired?: boolean;
  chainStates?: Array<{
    chainId: number;
    status: string;
    hash?: Hex;
  }>;
  callKey?: string;
  /** Account/chain/target/selector locks survive changed amounts and refreshed quotes. */
  writeScopes?: string[];
  /** Exact ordinary wallet call and returned identity used for canonical receipt recovery. */
  reviewedWrite?: ReviewedWriteRecoveryRecord;
  /** A returned wallet identity belongs to this exact pre-journaled batch call. */
  writeOwner?: { batchId: string; callIndex: number };
  createdAt: number;
  updatedAt: number;
};

const STORAGE_KEY = "revnet:transaction-activities:v1";
const MAX_TERMINAL_ACTIVITIES = 20;
const EMPTY: TransactionActivity[] = [];
let snapshot: TransactionActivity[] = EMPTY;
let hydrated = false;
let versions = new Map<string, RecordVersion>();
const pendingWrites = new Map<
  string,
  { rows: Array<TransactionActivity | null>; expected: RecordVersion }
>();
const unsentReservations = new Map<string, TransactionActivity>();
let storageWriteFailed = false;
let storageReadFailed = false;
const listeners = new Set<() => void>();

/** Shared identity for one reviewed direct call and its durable submission evidence. */
export function contractTransactionKey(
  account: Address,
  chainId: number,
  call: { address: Address; value?: bigint; data: Hex },
): string {
  return `${account.toLowerCase()}:${chainId}:${call.address.toLowerCase()}:${call.value ?? 0n}:${call.data}`;
}

export function contractTransactionScope(
  account: Address,
  chainId: number,
  call: { address: Address; data: Hex },
): string {
  return `${account.toLowerCase()}:${chainId}:${call.address.toLowerCase()}:${call.data.slice(0, 10).toLowerCase()}`;
}

function parseActivities(raw: string | null): TransactionActivity[] {
  const parsed: unknown = JSON.parse(raw ?? "[]");
  if (
    !Array.isArray(parsed) ||
    parsed.some(
      (row) =>
        !row ||
        typeof row !== "object" ||
        typeof row.id !== "string" ||
        !["direct", "safe", "relayr-payment", "relayr-bundle"].includes(row.kind) ||
        !["submitted", "pending", "safe-proposed", "success", "failed"].includes(row.status),
    )
  ) {
    throw new Error("Transaction recovery storage is malformed.");
  }
  for (const row of parsed as TransactionActivity[]) {
    if (row.reviewedWrite !== undefined || row.writeScopes !== undefined) {
      const record = parseReviewedWriteRecoveryRecord(row.reviewedWrite);
      const calls = record.safe && row.safeProposal ? row.safeProposal.calls : [record.call];
      const scopes = calls.map((call) => {
        const validated = parseReviewedWriteRecoveryRecord({ ...record, call });
        return contractTransactionScope(record.account, record.chainId, {
          address: validated.call.to,
          data: validated.call.data,
        });
      });
      if (
        !scopes.length ||
        !Array.isArray(row.writeScopes) ||
        JSON.stringify([...new Set(row.writeScopes)].sort()) !==
          JSON.stringify([...new Set(scopes)].sort()) ||
        row.account?.toLowerCase() !== record.account ||
        row.chainId !== record.chainId ||
        row.hash?.toLowerCase() !== record.hash ||
        (row.kind === "safe") !== record.safe ||
        (row.safeProposal && row.safeProposal.safe.toLowerCase() !== record.account) ||
        (!row.hash && (row.status === "success" || row.status === "failed"))
      ) {
        throw new Error("Saved wallet write evidence is inconsistent. Keep it pending.");
      }
    }
    if (
      row.writeOwner &&
      (!row.writeOwner.batchId ||
        !Number.isSafeInteger(row.writeOwner.callIndex) ||
        row.writeOwner.callIndex < 0 ||
        !row.hash ||
        !isHash(row.hash) ||
        !row.callKey)
    ) {
      throw new Error("Saved batch wallet identity is incomplete. Keep it pending.");
    }
  }
  return retainActivities(parsed);
}

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

const physicalId = (row: TransactionActivity) => row.reviewedWrite?.id ?? row.id;
const activityStorage = createRecordStorage<TransactionActivity>({
  key: STORAGE_KEY,
  parse: parseActivities,
  serialize: JSON.stringify,
  id: physicalId,
});
const orderActivities = (rows: TransactionActivity[]) => {
  const order = new Map(snapshot.map((row, index) => [physicalId(row), index]));
  return retainActivities(
    rows.sort(
      (a, b) =>
        b.updatedAt - a.updatedAt ||
        b.createdAt - a.createdAt ||
        (order.get(physicalId(a)) ?? -1) - (order.get(physicalId(b)) ?? -1),
    ),
  );
};

function hydrate(): void {
  if (hydrated || typeof window === "undefined") return;
  hydrated = true;
  try {
    const read = activityStorage.read();
    snapshot = orderActivities(read.records);
    versions = read.versions;
    storageReadFailed = false;
  } catch {
    storageReadFailed = true;
  }
}

function flushPendingWrites(): void {
  if (typeof window === "undefined") return;
  // beforeWrite failed, so these exact attempts provably never reached a wallet.
  // Keep this ownership until storage can distinguish our marker from newer evidence.
  for (const [id, saved] of unsentReservations) {
    try {
      const latest = activityStorage.read();
      const current = latest.records.find((row) => physicalId(row) === id);
      if (current && JSON.stringify(current) === JSON.stringify(saved)) {
        versions.set(id, activityStorage.write(id, null, latest.versions.get(id)!));
      }
      pendingWrites.delete(id);
      unsentReservations.delete(id);
      snapshot = snapshot.filter((row) => physicalId(row) !== id);
    } catch {
      /* Retry only this proven-unsent attempt when storage recovers. */
    }
  }
  for (const [id, pending] of pendingWrites) {
    if (unsentReservations.has(id)) continue;
    try {
      while (pending.rows.length) {
        pending.expected = activityStorage.write(id, pending.rows[0], pending.expected);
        versions.set(id, pending.expected);
        pending.rows.shift();
      }
      pendingWrites.delete(id);
    } catch {
      /* Retain the exact write and returned hash in memory. */
    }
  }
  storageWriteFailed = pendingWrites.size > 0 || unsentReservations.size > 0;
}

function emit(next: TransactionActivity[]): void {
  const previous = new Map(snapshot.map((row) => [physicalId(row), row]));
  snapshot = retainActivities(next);
  const following = new Map(snapshot.map((row) => [physicalId(row), row]));
  const queue = (id: string, row: TransactionActivity | null) => {
    const pending = pendingWrites.get(id);
    if (pending) {
      // Preserve the attempted head until readback acknowledges it. Only the
      // never-attempted tail may coalesce while storage is unavailable.
      pending.rows.splice(1, pending.rows.length, row);
    } else {
      pendingWrites.set(id, {
        rows: [row],
        expected: versions.get(id) ?? { raw: null, legacy: null },
      });
    }
  };
  for (const [id, row] of following)
    if (JSON.stringify(previous.get(id)) !== JSON.stringify(row)) queue(id, row);
  for (const id of previous.keys()) if (!following.has(id)) queue(id, null);
  flushPendingWrites();
  listeners.forEach((listener) => listener());
}

/** Refresh every identity without discarding this tab's uncommitted wallet evidence. */
export function refreshTransactionActivities(): TransactionActivity[] {
  hydrate();
  if (typeof window === "undefined") return snapshot;
  flushPendingWrites();
  try {
    const latest = activityStorage.read();
    const merged = new Map(latest.records.map((row) => [physicalId(row), row]));
    for (const [id, pending] of pendingWrites) {
      const desired = pending.rows.at(-1);
      if (desired) merged.set(id, desired);
      else merged.delete(id);
    }
    versions = latest.versions;
    const next = orderActivities([...merged.values()]);
    storageReadFailed = false;
    if (JSON.stringify(snapshot) !== JSON.stringify(next)) {
      snapshot = next;
      listeners.forEach((listener) => listener());
    }
  } catch {
    storageReadFailed = true;
  }
  return snapshot;
}

/** Funding and signature publication must retain their recovery lock across reloads. */
export function requireTransactionActivityPersistence(): void {
  refreshTransactionActivities();
  if (typeof window === "undefined" || storageWriteFailed || storageReadFailed) {
    throw new Error(
      "Transaction recovery storage is unavailable. Restore browser storage before publishing signatures or sending a payment.",
    );
  }
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

/** A wallet may open only after this marker and its exact call are durably retained. */
export function reserveTransactionActivity(
  activity: Omit<TransactionActivity, "createdAt" | "updatedAt">,
): TransactionActivity {
  requireTransactionActivityPersistence();
  if (!activity.writeScopes?.length || !activity.reviewedWrite || activity.hash) {
    throw new Error("The reviewed write has no complete recovery evidence.");
  }
  if (
    snapshot.some(
      (row) =>
        isInFlight(row) && row.writeScopes?.some((scope) => activity.writeScopes!.includes(scope)),
    )
  ) {
    throw new Error("An earlier wallet write is unresolved. Keep this action pending.");
  }
  const saved = recordTransactionActivity(activity);
  try {
    requireTransactionActivityPersistence();
  } catch (cause) {
    unsentReservations.set(physicalId(saved), saved);
    flushPendingWrites();
    throw cause;
  }
  return structuredClone(saved);
}

/** Commit a returned wallet identity without discarding a newer attempt's evidence. */
export function submitTransactionActivity(
  expected: TransactionActivity,
  hash: Hex,
): TransactionActivity {
  if (!isHash(hash)) throw new Error("The wallet returned an invalid transaction identity.");
  // A wallet reply must survive even when storage stopped answering while its
  // prompt was open. Refresh keeps the last known snapshot on a read failure.
  refreshTransactionActivities();
  const current = snapshot.find((row) => row.id === expected.id);
  if (
    !current ||
    current.hash ||
    !current.reviewedWrite ||
    JSON.stringify(current) !== JSON.stringify(expected)
  ) {
    throw new Error(`The saved submission changed. Preserve transaction ${hash} for recovery.`);
  }
  const submitted: TransactionActivity = {
    ...current,
    id: `tx:${current.chainId}:${hash.toLowerCase()}`,
    hash,
    safeProposalHash: current.kind === "safe" ? hash : undefined,
    reviewedWrite: { ...current.reviewedWrite, hash },
    status: current.kind === "safe" ? "safe-proposed" : "submitted",
    message: "Wallet submission accepted. Waiting for its verified result.",
    updatedAt: Date.now(),
  };
  emit([submitted, ...snapshot.filter((row) => row.id !== expected.id && row.id !== submitted.id)]);
  // emit retains the hash in memory even if browser persistence fails.
  try {
    requireTransactionActivityPersistence();
  } catch (cause) {
    throw new Error(
      `Transaction ${hash} was submitted, but recovery storage failed. Do not send it again.`,
      { cause },
    );
  }
  return structuredClone(submitted);
}

/** Only a proven pre-wallet abort or definite wallet rejection may remove this exact marker. */
export function removeUnsentTransactionActivity(expected: TransactionActivity): void {
  requireTransactionActivityPersistence();
  const current = snapshot.find((row) => row.id === expected.id);
  if (
    !current ||
    current.hash ||
    !current.writeScopes?.length ||
    JSON.stringify(current) !== JSON.stringify(expected)
  ) {
    throw new Error("The saved submission changed. Preserve its recovery record.");
  }
  emit(snapshot.filter((row) => row.id !== expected.id));
  requireTransactionActivityPersistence();
}

export function updateTransactionActivity(
  id: string,
  patch: Partial<Omit<TransactionActivity, "id" | "createdAt">>,
  expected?: TransactionActivity,
): void {
  refreshTransactionActivities();
  const current = snapshot.find((row) => row.id === id);
  if (!current || (expected && JSON.stringify(current) !== JSON.stringify(expected))) return;
  const guardedPatch =
    current.manualVerificationRequired &&
    patch.status === "success" &&
    patch.manualVerificationRequired !== false
      ? { ...patch, status: current.status, message: current.message }
      : patch;
  emit([
    {
      ...current,
      ...guardedPatch,
      updatedAt: Date.now(),
    },
    ...snapshot.filter((row) => row.id !== id),
  ]);
}

/** Restore only the exact payment marker whose wallet invocation was refused. */
export function restoreUnsentPaymentActivity(
  expected: TransactionActivity,
  previous: TransactionActivity,
): void {
  requireTransactionActivityPersistence();
  const current = snapshot.find((row) => row.id === expected.id);
  if (
    expected.id !== previous.id ||
    expected.relayrPaymentStatus !== "submitted" ||
    JSON.stringify(current) !== JSON.stringify(expected)
  ) {
    throw new Error("The saved submission changed. Preserve its recovery record.");
  }
  emit(snapshot.map((row) => (row.id === expected.id ? structuredClone(previous) : row)));
  requireTransactionActivityPersistence();
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

/** Settle a mined write whose verification proved it failed: nothing changed, so it may be sent again. */
export function settleTransactionActivityFailure(hash: Hex, message: string): void {
  const current = transactionActivityForHash(hash);
  if (!current) return;
  updateTransactionActivity(current.id, {
    status: "failed",
    message,
    manualVerificationRequired: false,
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
  const row = snapshot.find((activity) => activity.id === id);
  if (row && (row.writeScopes?.length || row.writeOwner) && isInFlight(row)) return;
  // A held entry stays until it is verified, unless the app can never confirm it, or a Relayr
  // session none of whose requests can run again is discarded.
  if (row?.manualVerificationRequired && !row.safeResultUnconfirmed && !row.relayrDiscardable)
    return;
  emit(snapshot.filter((activity) => activity.id !== id));
}

export function transactionActivityForHash(hash?: Hex): TransactionActivity | undefined {
  if (!hash) return undefined;
  return transactionActivitySnapshot().find(
    (row) => row.hash?.toLowerCase() === hash.toLowerCase(),
  );
}
