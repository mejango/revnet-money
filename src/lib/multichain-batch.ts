import type { ExpectedPayoutReceipt, ExpectedReservedReceipt } from "@bananapus/nana-sdk-core/v6";
import {
  encodeFunctionData,
  keccak256,
  stringToHex,
  type Abi,
  type Address,
  type Hash,
  type Hex,
} from "viem";
import type {
  CallPrecondition,
  ExpectedPayerDeployment,
  RejectedReceiptEvent,
} from "./multichain-guards";
import type { RouterPendingReceiptGuard } from "./pending-router-calls";
import { createRecordStorage } from "./record-storage";

export type MultichainCall = {
  chainId: number;
  address: Address;
  abi: Abi;
  functionName: string;
  args: readonly unknown[];
  value?: bigint;
  /** Exact gas bound for calls whose retry behavior depends on available gas. */
  gas?: bigint;
  contractName?: string;
  recoveryScope?: string;
  relayrMode?: "raw" | "forwarded";
  preconditions?: CallPrecondition[];
  expectedDeployment?: ExpectedPayerDeployment;
  rejectEvents?: RejectedReceiptEvent[];
  reservedReceipt?: ExpectedReservedReceipt;
  expectedPayout?: ExpectedPayoutReceipt;
  expectedRouterPending?: RouterPendingReceiptGuard;
  validate?: () => Promise<void>;
};
export type FrozenBatchCall = Omit<MultichainCall, "validate"> & {
  data: Hex;
  state: "ready" | "submitting" | "submitted" | "safe" | "success" | "skipped" | "reverted";
  skipReason?: "resolved-externally" | "retried-externally" | "obsolete-safe";
  safeNonce?: number;
  /** Unique pre-wallet attempt; legacy unknown submissions remain held without one. */
  writeAttempt?: string;
  hash?: Hash;
};
/** A handled attempt must never be sent again, including canonical failed attempts. */
export function isBatchCallHandled(call: Pick<FrozenBatchCall, "state">): boolean {
  return call.state === "success" || call.state === "skipped" || call.state === "reverted";
}

export type BatchRound = {
  indices: number[];
  bundleUuid?: string;
  /** Quote-bound IDs in the same order as indices (needed for repeated chains). */
  transactionUuids?: string[];
  state: "ready" | "quoted" | "funding" | "pending" | "success";
};
export type MultichainBatch = {
  id: string;
  scope: string;
  label: string;
  account: Address;
  key: string;
  route: "relayr" | "direct";
  calls: FrozenBatchCall[];
  rounds: BatchRound[];
  status: "pending" | "success" | "superseded";
  supersession?: {
    reason: "fresh-routing-review";
    at: number;
    replacementId: string;
  };
  createdAt: number;
};
/** Submission evidence always retains routing recovery, even before any receipt is handled. */
export function hasUntouchedRoutingCalls(batch: MultichainBatch): boolean {
  return (
    batch.status === "pending" &&
    batch.calls.length > 0 &&
    batch.calls.every(
      (call) =>
        call.expectedRouterPending &&
        call.state === "ready" &&
        call.hash === undefined &&
        call.safeNonce === undefined,
    )
  );
}

/** Only untouched pending-routing selections can be replaced by a fresh selection. */
export function isReplaceableRoutingDraft(batch: MultichainBatch): boolean {
  return (
    hasUntouchedRoutingCalls(batch) &&
    batch.rounds.every(
      (round) =>
        round.state === "ready" &&
        round.bundleUuid === undefined &&
        round.transactionUuids === undefined,
    )
  );
}

/** A hashless routing selection can be superseded after fresh review; its past outcome stays unknown. */
export function isUnconfirmedRoutingBatch(batch: MultichainBatch): boolean {
  return (
    batch.route === "direct" &&
    batch.calls.some((call) => call.state === "submitting") &&
    isReplaceableRoutingDraft({
      ...batch,
      calls: batch.calls.map((call) =>
        call.state === "submitting" ? { ...call, state: "ready" } : call,
      ),
    })
  );
}

export function routingBatchRecoveryReason(batch: MultichainBatch): string {
  if (batch.calls.some((call) => call.state === "submitting"))
    return "A wallet submission has an unknown result. Check it before starting another batch.";
  if (batch.calls.some((call) => call.state === "safe" || call.safeNonce !== undefined))
    return "This selection has a saved Safe proposal. Resume it to check execution.";
  if (batch.calls.some((call) => call.hash || call.state === "submitted"))
    return "This selection has submitted transactions. Resume it to verify their results.";
  if (batch.calls.some(isBatchCallHandled))
    return "Some saved attempts have already been handled. Resume the remaining attempts.";
  if (batch.rounds.some((round) => round.state === "funding" || round.state === "pending"))
    return "A payment may be in progress. Resume to check its existing payment and results.";
  if (batch.rounds.some((round) => round.bundleUuid || round.state === "quoted"))
    return "A quote is saved. Re-check whether it is still payable before changing this selection.";
  return "An earlier authorization may still reserve this selection. Re-check its status before changing it.";
}

/** Reset only unsubmitted rounds whose named quotes were proved unpaid and released by Relayr recovery. */
export function resetUnpaidRoutingDraft(
  expected: MultichainBatch,
  releasedBundleUuids: readonly string[],
): void {
  if (!hasUntouchedRoutingCalls(expected)) return;
  const released = new Set(releasedBundleUuids.map((uuid) => uuid.toLowerCase()));
  if (
    !expected.rounds.every(
      (round) =>
        (round.state === "ready" && !round.bundleUuid && !round.transactionUuids) ||
        (round.state === "quoted" &&
          !!round.bundleUuid &&
          released.has(round.bundleUuid.toLowerCase())),
    )
  )
    return;
  const batches = readMultichainBatches();
  const current = batches.find((batch) => batch.id === expected.id);
  if (!current || serialize(current) !== serialize(expected))
    throw new Error("The saved batch changed. Re-check its latest progress.");
  writeMultichainBatches(
    batches.map((batch) =>
      batch.id === expected.id
        ? {
            ...batch,
            rounds: batch.rounds.map((round) => ({
              indices: round.indices,
              state: "ready" as const,
            })),
          }
        : batch,
    ),
    batches,
  );
}

/** Save the replacement before retiring its reviewed predecessor; refuse stale evidence. */
export function replaceRoutingDraft(
  expected: MultichainBatch,
  replacement: MultichainBatch,
  refreshUnconfirmed = false,
) {
  const batches = readMultichainBatches();
  const current = batches.find((batch) => batch.id === expected.id);
  if (
    !current ||
    serialize(current) !== serialize(expected) ||
    !(refreshUnconfirmed ? isUnconfirmedRoutingBatch(current) : isReplaceableRoutingDraft(current))
  )
    throw new Error("The saved batch changed. Refresh and resume its existing progress.");
  writeMultichainBatches(
    [
      replacement,
      ...(refreshUnconfirmed
        ? [
            {
              ...current,
              status: "superseded" as const,
              supersession: {
                reason: "fresh-routing-review" as const,
                at: Date.now(),
                replacementId: replacement.id,
              },
            },
          ]
        : []),
      ...batches.filter((batch) => batch.id !== expected.id && batch.id !== replacement.id),
    ],
    batches,
  );
}

const STORAGE_KEY = "revnet:multichain-batches:v1";

function serialize(value: unknown) {
  return JSON.stringify(value, (_key, item: unknown) =>
    typeof item === "bigint" ? { $batchBigInt: item.toString() } : item,
  );
}
function parseBatches(raw: string | null): MultichainBatch[] {
  const parsed: unknown = JSON.parse(raw ?? "[]", (_key, item: unknown) =>
    item && typeof item === "object" && Object.keys(item).length === 1 && "$batchBigInt" in item
      ? BigInt(String(item.$batchBigInt))
      : item,
  );
  if (
    !Array.isArray(parsed) ||
    parsed.some(
      (batch) =>
        !batch ||
        typeof batch.id !== "string" ||
        typeof batch.scope !== "string" ||
        typeof batch.account !== "string" ||
        !Array.isArray(batch.calls) ||
        !Array.isArray(batch.rounds),
    )
  )
    throw new Error("Invalid batch journal");
  return parsed;
}
const batchStorage = createRecordStorage<MultichainBatch>({
  key: STORAGE_KEY,
  parse: parseBatches,
  serialize,
  id: (batch) => batch.id,
});
const unsentReservations = new Map<
  string,
  { previous: MultichainBatch; attempted: MultichainBatch }
>();
function restoreUnsentReservations() {
  for (const [id, saved] of unsentReservations) {
    const latest = batchStorage.read();
    const current = latest.records.find((batch) => batch.id === id);
    if (serialize(current) === serialize(saved.attempted)) {
      batchStorage.write(id, saved.previous, latest.versions.get(id)!);
    }
    // Absent/unchanged or newer evidence belongs to no failed wallet invocation.
    unsentReservations.delete(id);
  }
}
export function readMultichainBatches(): MultichainBatch[] {
  if (typeof window === "undefined") return [];
  try {
    restoreUnsentReservations();
    return batchStorage.read().records.sort((a, b) => b.createdAt - a.createdAt);
  } catch {
    throw new Error(
      "Saved multichain recovery data is unavailable. Restore it before creating another batch.",
    );
  }
}
/** Write only changed identities; independent accounts never rewrite each other's batches. */
function writeMultichainBatches(batches: MultichainBatch[], previous: MultichainBatch[]) {
  if (typeof window === "undefined") throw new Error("Browser recovery storage is required.");
  const prior = new Map(previous.map((batch) => [batch.id, batch]));
  const changes: [string, MultichainBatch | null][] = batches
    .filter((batch) => serialize(prior.get(batch.id)) !== serialize(batch))
    .map((batch) => [batch.id, batch]);
  for (const batch of previous)
    if (!batches.some((next) => next.id === batch.id)) changes.push([batch.id, null]);
  for (const [id, next] of changes) {
    const latest = batchStorage.read();
    if (serialize(latest.records.find((batch) => batch.id === id)) !== serialize(prior.get(id)))
      throw new Error("The saved submission changed. Preserve its recovery record.");
    try {
      batchStorage.write(id, next, latest.versions.get(id) ?? { raw: null, legacy: null });
    } catch (cause) {
      throw new Error(
        "The batch could not be saved for recovery. Nothing further will be submitted.",
        { cause },
      );
    }
  }
}
export function saveMultichainBatch(batch: MultichainBatch, expected?: MultichainBatch) {
  if (typeof window === "undefined") throw new Error("Browser recovery storage is required.");
  const previous = readMultichainBatches();
  if (
    expected &&
    (batch.id !== expected.id ||
      serialize(previous.find((item) => item.id === expected.id)) !== serialize(expected))
  ) {
    throw new Error("The saved submission changed. Preserve its recovery record.");
  }
  writeMultichainBatches([batch, ...previous.filter((item) => item.id !== batch.id)], previous);
}
/** Reserve only this ready call, retaining exact cleanup ownership if readback fails. */
export function reserveMultichainBatchCall(
  previous: MultichainBatch,
  index: number,
): FrozenBatchCall {
  const attempted = structuredClone(previous);
  const call = attempted.calls[index];
  if (!call || call.state !== "ready" || call.hash)
    throw new Error("The saved submission changed. Preserve its recovery record.");
  call.state = "submitting";
  call.writeAttempt = crypto.randomUUID();
  try {
    saveMultichainBatch(attempted, previous);
    return call;
  } catch (cause) {
    unsentReservations.set(previous.id, { previous: structuredClone(previous), attempted });
    try {
      restoreUnsentReservations();
    } catch {
      /* Retry exact pre-wallet cleanup after storage recovers. */
    }
    throw cause;
  }
}
/** Only the reviewed boundary may release an intent it refused before invoking the wallet. */
export function resetUnsubmittedBatchCall(expected: MultichainBatch, index: number) {
  const batches = readMultichainBatches();
  const current = batches.find((batch) => batch.id === expected.id);
  const call = current?.calls[index];
  if (
    !current ||
    serialize(current) !== serialize(expected) ||
    call?.state !== "submitting" ||
    call.hash
  ) {
    throw new Error("The saved submission changed. Preserve its recovery record.");
  }
  const previous = structuredClone(batches);
  call.state = "ready";
  delete call.writeAttempt;
  writeMultichainBatches(batches, previous);
}
/** Only callers that prove no signature/publication/submission occurred may remove a draft. */
export function removeUnsubmittedBatch(id: string, expected?: MultichainBatch) {
  if (typeof window === "undefined") throw new Error("Browser recovery storage is required.");
  const batches = readMultichainBatches();
  if (
    expected &&
    (id !== expected.id ||
      serialize(batches.find((batch) => batch.id === id)) !== serialize(expected))
  ) {
    throw new Error("The saved submission changed. Preserve its recovery record.");
  }
  writeMultichainBatches(
    batches.filter((batch) => batch.id !== id),
    batches,
  );
}
/** The recovery scope a batch call is quoted and checked under: its own, or its place in the batch. */
export function batchCallScope(
  batch: Pick<MultichainBatch, "scope">,
  call: Pick<FrozenBatchCall, "recoveryScope" | "chainId">,
  index: number,
): string {
  return call.recoveryScope ?? `${batch.scope}:${call.chainId}:${index}`;
}
/**
 * A Relayr session that `holds` names was discarded. After one that may have
 * run, every pending batch with such a round is abandoned, so its calls go out
 * again only after a fresh review (ruling R114 (f)), and its id is returned.
 * Otherwise a round that was paying or running quotes its calls again.
 */
export function releaseBatchRound(
  holds: (batch: MultichainBatch, round: BatchRound) => boolean,
  abandon: boolean,
): string[] {
  const batches = readMultichainBatches();
  const held = batches.filter(
    (batch) =>
      batch.status === "pending" &&
      batch.rounds.some((round) => round.state !== "success" && holds(batch, round)),
  );
  if (!held.length) return [];
  writeMultichainBatches(
    abandon
      ? batches.filter((batch) => !held.includes(batch))
      : batches.map((batch) =>
          held.includes(batch)
            ? {
                ...batch,
                rounds: batch.rounds.map((round) =>
                  (round.state === "funding" || round.state === "pending") && holds(batch, round)
                    ? { ...round, state: "quoted" as const }
                    : round,
                ),
              }
            : batch,
        ),
    batches,
  );
  return abandon ? held.map((batch) => batch.id) : [];
}
function batchCallData(call: MultichainCall) {
  return encodeFunctionData({ abi: call.abi, functionName: call.functionName, args: call.args });
}
export function batchCallKey(calls: readonly MultichainCall[]) {
  return keccak256(
    stringToHex(
      calls
        .map(
          (call) =>
            `${call.chainId}:${call.address.toLowerCase()}:${call.value ?? 0n}:${batchCallData(call).toLowerCase()}`,
        )
        .join("|"),
    ),
  );
}

/** Preserve every selected allocation while using one independent call per chain in each explicit round. */
export function makeBatchRounds(calls: readonly MultichainCall[]): BatchRound[] {
  if (
    calls.length &&
    calls.every((call) => call.relayrMode === "raw" && call.expectedRouterPending)
  )
    return [{ indices: calls.map((_call, index) => index), state: "ready" }];
  const rounds: BatchRound[] = [];
  const occurrences = new Map<number, number>();
  calls.forEach((call, index) => {
    const round = occurrences.get(call.chainId) ?? 0;
    occurrences.set(call.chainId, round + 1);
    rounds[round] ??= { indices: [], state: "ready" };
    rounds[round].indices.push(index);
  });
  return rounds;
}
export function findPendingBatch(account: Address, scope: string) {
  return readMultichainBatches().find(
    (batch) =>
      batch.account.toLowerCase() === account.toLowerCase() &&
      batch.scope === scope &&
      batch.status === "pending",
  );
}
export function createMultichainBatch(
  account: Address,
  scope: string,
  label: string,
  calls: MultichainCall[],
  route: MultichainBatch["route"],
  replacingDraftId?: string,
): MultichainBatch {
  if (!scope || !calls.length) throw new Error("Choose at least one destination.");
  const scopes = new Set(calls.map((call) => call.recoveryScope).filter(Boolean));
  const overlap = readMultichainBatches().find(
    (batch) =>
      batch.status === "pending" &&
      batch.id !== replacingDraftId &&
      batch.account.toLowerCase() === account.toLowerCase() &&
      (batch.scope === scope ||
        batch.calls.some((call) => call.recoveryScope && scopes.has(call.recoveryScope))),
  );
  if (overlap)
    throw new Error(
      `Resume the saved ${overlap.label} batch before changing this operation or its destination selection.`,
    );
  const key = batchCallKey(calls);
  return {
    id: `multichain:${account.toLowerCase()}:${keccak256(stringToHex(scope))}:${Date.now()}`,
    scope,
    label,
    account,
    key,
    route,
    calls: calls.map(({ validate: _validate, ...call }) => ({
      ...call,
      data: batchCallData(call),
      state: "ready",
    })),
    rounds: makeBatchRounds(calls),
    status: "pending",
    createdAt: Date.now(),
  };
}
