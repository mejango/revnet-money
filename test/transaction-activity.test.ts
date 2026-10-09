import type { Address, Hex } from "viem";
import { beforeEach, describe, expect, it, vi } from "vitest";

const STORAGE_KEY = "revnet:transaction-activities:v1";
const recordKey = (id: string) => `${STORAGE_KEY}:record:${encodeURIComponent(id)}`;
const HASH = `0x${"ab".repeat(32)}` as Hex;
const ACCOUNT = "0x000000000000000000000000000000000000dEaD" as Address;
const TARGET = "0x0000000000000000000000000000000000001000" as Address;

function pendingWrite() {
  return {
    id: "write:attempt",
    kind: "direct" as const,
    title: "transfer",
    status: "pending" as const,
    message: "Wallet result unknown",
    account: ACCOUNT,
    chainId: 1,
    writeScopes: [`${ACCOUNT.toLowerCase()}:1:${TARGET}:0x12345678`],
    reviewedWrite: {
      version: 1 as const,
      id: "write:attempt",
      chainId: 1,
      account: ACCOUNT,
      safe: false,
      call: { to: TARGET, data: "0x12345678" as Hex, value: "0" },
    },
  };
}

async function freshActivityModule() {
  vi.resetModules();
  return import("@/lib/transaction-activity");
}

beforeEach(() => {
  window.localStorage.clear();
});

describe("transaction activity persistence", () => {
  it("does not miss a held record when an unrelated storage key is removed during enumeration", async () => {
    window.localStorage.setItem("unrelated-cache", "cache");
    const activity = await freshActivityModule();
    activity.reserveTransactionActivity(pendingWrite());
    const key = Storage.prototype.key;
    vi.spyOn(Storage.prototype, "key").mockImplementation(function (this: Storage, index) {
      const current = key.call(this, index);
      if (index === 0) this.removeItem("unrelated-cache");
      return current;
    });
    const restored = await freshActivityModule();
    expect(restored.transactionActivitySnapshot().map((row) => row.id)).toContain("write:attempt");
  });
  it("uses one physical key when a saved reservation receives its wallet hash", async () => {
    const activity = await freshActivityModule();
    const saved = activity.reserveTransactionActivity(pendingWrite());
    const keys = Object.keys(window.localStorage);
    activity.submitTransactionActivity(saved, HASH);
    expect(Object.keys(window.localStorage)).toEqual(keys);
    const restored = await freshActivityModule();
    expect(restored.transactionActivitySnapshot()).toHaveLength(1);
    expect(restored.transactionActivityForHash(HASH)?.reviewedWrite?.id).toBe(
      saved.reviewedWrite!.id,
    );
  });

  it("overrides legacy rows and keeps deleted legacy rows tombstoned after reload", async () => {
    const legacy = {
      id: "legacy",
      kind: "direct",
      status: "submitted",
      title: "Legacy",
      message: "Saved",
      createdAt: 1,
      updatedAt: 1,
    };
    const raw = JSON.stringify([legacy]);
    window.localStorage.setItem(STORAGE_KEY, raw);
    const activity = await freshActivityModule();
    activity.updateTransactionActivity(legacy.id, { message: "Updated" });
    let reloaded = await freshActivityModule();
    expect(reloaded.transactionActivitySnapshot()[0].message).toBe("Updated");
    reloaded.dismissTransactionActivity(legacy.id);
    reloaded = await freshActivityModule();
    expect(reloaded.transactionActivitySnapshot()).toEqual([]);
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe(raw);
    expect(window.localStorage.getItem(recordKey(legacy.id))).toBe("[]");
  });

  it("cleans only its exact unsent reservation after save succeeds but readback fails", async () => {
    const activity = await freshActivityModule();
    const originalGet = Storage.prototype.getItem;
    const originalSet = Storage.prototype.setItem;
    let saved = false;
    const read = vi.spyOn(Storage.prototype, "getItem").mockImplementation(function (
      this: Storage,
      key,
    ) {
      if (saved && key === recordKey("write:attempt")) throw new Error("Readback unavailable");
      return originalGet.call(this, key);
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, key, value) {
      originalSet.call(this, key, value);
      if (key === recordKey("write:attempt")) saved = true;
    });
    expect(() => activity.reserveTransactionActivity(pendingWrite())).toThrow(/storage/);
    read.mockRestore();
    expect(() => activity.requireTransactionActivityPersistence()).not.toThrow();
    expect(activity.transactionActivitySnapshot()).toEqual([]);
    const retry = activity.reserveTransactionActivity(pendingWrite());
    expect(retry.id).toBe("write:attempt");
  });
  it("retains independent reservations when separate tabs interleave healthy writes", async () => {
    const first = await freshActivityModule();
    const second = await freshActivityModule();
    first.transactionActivitySnapshot();
    second.transactionActivitySnapshot();
    const other = pendingWrite();
    other.id = "write:other";
    other.reviewedWrite.id = other.id;
    other.reviewedWrite.call.to = "0x0000000000000000000000000000000000003000";
    other.writeScopes = [`${ACCOUNT.toLowerCase()}:1:${other.reviewedWrite.call.to}:0x12345678`];
    const set = Storage.prototype.setItem;
    let interleaved = false;
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, key, value) {
      if (key.startsWith(`${STORAGE_KEY}:record:`) && !interleaved) {
        interleaved = true;
        second.reserveTransactionActivity(other);
      }
      set.call(this, key, value);
    });
    first.reserveTransactionActivity(pendingWrite());
    const restored = await freshActivityModule();
    expect(
      restored
        .transactionActivitySnapshot()
        .map((row) => row.id)
        .sort(),
    ).toEqual(["write:attempt", "write:other"]);
  });
  it.each(["missing scope", "empty scope", "invalid hash"])(
    "refuses malformed saved ordinary evidence: %s",
    async (failure) => {
      const row = { ...pendingWrite(), createdAt: 1, updatedAt: 1 };
      const malformed =
        failure === "missing scope"
          ? { ...row, writeScopes: undefined }
          : failure === "empty scope"
            ? { ...row, writeScopes: [] }
            : { ...row, hash: "0x12", reviewedWrite: { ...row.reviewedWrite, hash: "0x12" } };
      const raw = JSON.stringify([malformed]);
      window.localStorage.setItem(STORAGE_KEY, raw);
      const activity = await freshActivityModule();
      expect(() => activity.requireTransactionActivityPersistence()).toThrow(
        /storage is unavailable/,
      );
      expect(window.localStorage.getItem(STORAGE_KEY)).toBe(raw);
    },
  );
  it("retains nondismissible unknown writes across reload and refuses overlapping reservations", async () => {
    const activity = await freshActivityModule();
    const saved = activity.reserveTransactionActivity(pendingWrite());
    activity.dismissTransactionActivity(saved.id);
    expect(activity.transactionActivitySnapshot()).toHaveLength(1);
    const restored = await freshActivityModule();
    expect(restored.transactionActivitySnapshot()[0].reviewedWrite).toEqual(saved.reviewedWrite);
    expect(() => restored.reserveTransactionActivity({ ...pendingWrite(), id: "another" })).toThrow(
      /unresolved/,
    );
  });

  it.each(["read", "write"])(
    "keeps a returned hash in memory when storage %s fails",
    async (failure) => {
      const activity = await freshActivityModule();
      const saved = activity.reserveTransactionActivity(pendingWrite());
      vi.spyOn(Storage.prototype, failure === "read" ? "getItem" : "setItem").mockImplementation(
        () => {
          throw new Error("Storage unavailable");
        },
      );
      expect(() => activity.submitTransactionActivity(saved, HASH)).toThrow(HASH);
      expect(activity.transactionActivityForHash(HASH)?.reviewedWrite?.hash).toBe(HASH);
      expect(activity.transactionActivitySnapshot()).toHaveLength(1);
    },
  );

  it("cannot clear or overwrite a newer reservation with a stale abort or returned hash", async () => {
    const activity = await freshActivityModule();
    const saved = activity.reserveTransactionActivity(pendingWrite());
    activity.updateTransactionActivity(saved.id, { message: "New recovery evidence" });
    expect(() => activity.removeUnsentTransactionActivity(saved)).toThrow(/submission changed/);
    expect(() => activity.submitTransactionActivity(saved, HASH)).toThrow(/submission changed/);
    expect(activity.transactionActivitySnapshot()[0].message).toBe("New recovery evidence");
  });

  it("retains the returned identity when a transient storage read recovers with the old hashless record", async () => {
    const activity = await freshActivityModule();
    const saved = activity.reserveTransactionActivity(pendingWrite());
    vi.spyOn(Storage.prototype, "getItem").mockImplementationOnce(() => {
      throw new Error("Temporarily unreadable");
    });
    expect(activity.submitTransactionActivity(saved, HASH).hash).toBe(HASH);
    activity.refreshTransactionActivities();
    expect(activity.transactionActivityForHash(HASH)?.reviewedWrite?.hash).toBe(HASH);
    expect(() => activity.requireTransactionActivityPersistence()).not.toThrow();
    expect(
      JSON.parse(window.localStorage.getItem(recordKey(saved.reviewedWrite!.id))!)[0].hash,
    ).toBe(HASH);
  });

  it("acknowledges its retained write before persisting a later update after a readback outage", async () => {
    const activity = await freshActivityModule();
    const saved = activity.reserveTransactionActivity(pendingWrite());
    const originalGet = Storage.prototype.getItem;
    const originalSet = Storage.prototype.setItem;
    let submitted = false;
    const read = vi.spyOn(Storage.prototype, "getItem").mockImplementation(function (
      this: Storage,
      key,
    ) {
      if (submitted) throw new Error("Readback unavailable");
      return originalGet.call(this, key);
    });
    const write = vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (
      this: Storage,
      key,
      value,
    ) {
      originalSet.call(this, key, value);
      submitted = true;
    });
    expect(() => activity.submitTransactionActivity(saved, HASH)).toThrow(HASH);
    activity.updateTransactionActivity(`tx:1:${HASH}`, { message: "Still waiting for proof" });
    read.mockRestore();
    write.mockRestore();
    expect(() => activity.requireTransactionActivityPersistence()).not.toThrow();
    const restored = await freshActivityModule();
    expect(restored.transactionActivityForHash(HASH)).toMatchObject({
      hash: HASH,
      message: "Still waiting for proof",
    });
  });

  it("does not replace newer storage while retaining a hash after persistence failure", async () => {
    const activity = await freshActivityModule();
    const saved = activity.reserveTransactionActivity(pendingWrite());
    const writes = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("Write failed");
    });
    expect(() => activity.submitTransactionActivity(saved, HASH)).toThrow(HASH);
    writes.mockRestore();
    const newer = JSON.stringify([{ ...saved, message: "Newer sibling evidence" }]);
    window.localStorage.setItem(recordKey(saved.reviewedWrite!.id), newer);
    activity.refreshTransactionActivities();
    expect(activity.transactionActivityForHash(HASH)?.hash).toBe(HASH);
    activity.updateTransactionActivity(`tx:1:${HASH}`, { message: "Still waiting for proof" });
    expect(window.localStorage.getItem(recordKey(saved.reviewedWrite!.id))).toBe(newer);
    expect(() => activity.requireTransactionActivityPersistence()).toThrow(/unavailable/);
  });

  it("records, persists, updates, resolves hashes case-insensitively, and dismisses", async () => {
    const activity = await freshActivityModule();
    const listener = vi.fn();
    const unsubscribe = activity.subscribeTransactionActivities(listener);

    const recorded = activity.recordTransactionActivity({
      id: "tx:1:test",
      kind: "direct",
      title: "Pay",
      status: "submitted",
      message: "Wallet accepted",
      chainId: 1,
      account: ACCOUNT,
      hash: HASH,
    });

    expect(recorded.createdAt).toBeGreaterThan(0);
    expect(JSON.parse(window.localStorage.getItem(recordKey(recorded.id)) ?? "[]")).toHaveLength(1);
    expect(activity.transactionActivityForHash(HASH.toUpperCase() as Hex)?.id).toBe(recorded.id);

    activity.updateTransactionActivity(recorded.id, {
      status: "success",
      message: "Confirmed onchain.",
    });
    expect(activity.transactionActivitySnapshot()[0]).toMatchObject({
      status: "success",
      message: "Confirmed onchain.",
      createdAt: recorded.createdAt,
    });

    activity.dismissTransactionActivity(recorded.id);
    expect(activity.transactionActivitySnapshot()).toEqual([]);
    expect(listener).toHaveBeenCalledTimes(3);
    unsubscribe();
  });

  it("deduplicates by id, keeps the newest activity first, and never evicts in-flight locks", async () => {
    const activity = await freshActivityModule();
    for (let index = 0; index < 25; index += 1) {
      activity.recordTransactionActivity({
        id: `tx:${index}`,
        kind: "direct",
        title: `Transaction ${index}`,
        status: "pending",
        message: "Pending",
      });
    }

    expect(activity.transactionActivitySnapshot()).toHaveLength(25);
    expect(activity.transactionActivitySnapshot()[0].id).toBe("tx:24");
    expect(activity.transactionActivitySnapshot().at(-1)?.id).toBe("tx:0");

    activity.recordTransactionActivity({
      id: "tx:10",
      kind: "direct",
      title: "Updated transaction",
      status: "failed",
      message: "Reverted",
    });
    expect(activity.transactionActivitySnapshot()).toHaveLength(25);
    expect(activity.transactionActivitySnapshot()[0]).toMatchObject({
      id: "tx:10",
      title: "Updated transaction",
      status: "failed",
    });
  });

  it("caps terminal history without evicting an older pending Safe proposal", async () => {
    const activity = await freshActivityModule();
    activity.recordTransactionActivity({
      id: "handle:safe",
      kind: "safe",
      title: "Publish project handle",
      status: "safe-proposed",
      message: "Awaiting Safe execution",
      callKey: "operator:1:handles:calldata",
    });
    for (let index = 0; index < 25; index += 1) {
      activity.recordTransactionActivity({
        id: `terminal:${index}`,
        kind: "direct",
        title: `Completed transaction ${index}`,
        status: "success",
        message: "Confirmed",
      });
    }

    const rows = activity.transactionActivitySnapshot();
    expect(rows).toHaveLength(21);
    expect(rows.filter((row) => row.status === "success")).toHaveLength(20);
    expect(rows.find((row) => row.id === "handle:safe")).toMatchObject({
      status: "safe-proposed",
      callKey: "operator:1:handles:calldata",
    });

    const hydrated = await freshActivityModule();
    expect(
      hydrated.transactionActivitySnapshot().find((row) => row.id === "handle:safe"),
    ).toMatchObject({ status: "safe-proposed" });
  });

  it("merges a sibling tab's pending lock before recording local activity", async () => {
    const activity = await freshActivityModule();
    activity.transactionActivitySnapshot();
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify([
        {
          id: "sibling:handle",
          kind: "safe",
          title: "Publish project handle",
          status: "safe-proposed",
          message: "Awaiting Safe execution",
          callKey: "operator:1:handles:calldata",
          createdAt: 1,
          updatedAt: 1,
        },
      ]),
    );

    activity.recordTransactionActivity({
      id: "local:complete",
      kind: "direct",
      title: "Other transaction",
      status: "success",
      message: "Confirmed",
    });

    expect(activity.transactionActivitySnapshot().map((row) => row.id)).toEqual([
      "local:complete",
      "sibling:handle",
    ]);
    expect(JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "[]")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "sibling:handle", status: "safe-proposed" }),
      ]),
    );
  });

  it("hydrates persisted state and fails safely on malformed storage", async () => {
    const rows = Array.from({ length: 25 }, (_, index) => ({
      id: `stored:${index}`,
      kind: "direct",
      title: "Stored",
      status: "pending",
      message: "Pending",
      createdAt: index,
      updatedAt: index,
    }));
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(rows));

    const hydrated = await freshActivityModule();
    expect(hydrated.transactionActivitySnapshot()).toHaveLength(25);

    window.localStorage.setItem(STORAGE_KEY, "not json");
    const malformed = await freshActivityModule();
    expect(malformed.transactionActivitySnapshot()).toEqual([]);
    expect(() => malformed.requireTransactionActivityPersistence()).toThrow(
      /storage is unavailable/,
    );
    malformed.recordTransactionActivity({
      id: "new",
      kind: "direct",
      title: "New",
      status: "pending",
      message: "Pending",
    });
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe("not json");
    expect(() => malformed.requireTransactionActivityPersistence()).toThrow(
      /storage is unavailable/,
    );
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(rows));
    expect(() => malformed.requireTransactionActivityPersistence()).not.toThrow();
    expect(malformed.transactionActivitySnapshot()).toHaveLength(26);
  });

  it("dismisses a held entry only when its Safe result can't be confirmed here", async () => {
    const activity = await freshActivityModule();
    const held = {
      kind: "safe",
      title: "Make the market",
      status: "safe-proposed",
      message: "Submitted to Safe.",
      manualVerificationRequired: true,
    } as const;
    activity.recordTransactionActivity({ ...held, id: "held" });
    activity.recordTransactionActivity({ ...held, id: "unconfirmed", safeResultUnconfirmed: true });

    activity.dismissTransactionActivity("held");
    activity.dismissTransactionActivity("unconfirmed");

    expect(activity.transactionActivitySnapshot().map((row) => row.id)).toEqual(["held"]);
  });

  it("ignores updates for unknown ids", async () => {
    const activity = await freshActivityModule();
    activity.updateTransactionActivity("missing", { status: "failed" });
    expect(activity.transactionActivitySnapshot()).toEqual([]);
  });

  it("keeps an action-specific verification hold from being overwritten by generic success", async () => {
    const activity = await freshActivityModule();
    activity.recordTransactionActivity({
      id: `tx:1:${HASH}`,
      kind: "direct",
      title: "execTransaction",
      status: "pending",
      message: "Pending onchain confirmation.",
      hash: HASH,
    });

    activity.holdTransactionActivityForVerification(
      HASH,
      "Mined, but the exact Safe event or handle result could not be verified.",
    );
    activity.updateTransactionActivity(`tx:1:${HASH}`, {
      status: "success",
      message: "Confirmed onchain.",
    });

    expect(activity.transactionActivityForHash(HASH)).toMatchObject({
      status: "pending",
      manualVerificationRequired: true,
      message: "Mined, but the exact Safe event or handle result could not be verified.",
    });

    activity.releaseTransactionActivityVerification(HASH, "Exact handle result confirmed.");
    expect(activity.transactionActivityForHash(HASH)).toMatchObject({
      status: "success",
      manualVerificationRequired: false,
      message: "Exact handle result confirmed.",
    });

    activity.failTransactionActivityVerification(HASH, "Exact handle verification failed.");
    activity.updateTransactionActivity(`tx:1:${HASH}`, {
      status: "success",
      message: "Confirmed onchain.",
    });
    expect(activity.transactionActivityForHash(HASH)).toMatchObject({
      status: "failed",
      manualVerificationRequired: true,
      message: "Exact handle verification failed.",
    });
  });
});
