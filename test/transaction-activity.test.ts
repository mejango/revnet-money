import type { Address, Hex } from "viem";
import { beforeEach, describe, expect, it, vi } from "vitest";

const STORAGE_KEY = "revnet:transaction-activities:v1";
const HASH = `0x${"ab".repeat(32)}` as Hex;
const ACCOUNT = "0x000000000000000000000000000000000000dEaD" as Address;

async function freshActivityModule() {
  vi.resetModules();
  return import("@/lib/transaction-activity");
}

beforeEach(() => {
  window.localStorage.clear();
});

describe("transaction activity persistence", () => {
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
    expect(JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "[]")).toHaveLength(1);
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

  it("deduplicates by id, keeps the newest activity first, and caps storage at 20", async () => {
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

    expect(activity.transactionActivitySnapshot()).toHaveLength(20);
    expect(activity.transactionActivitySnapshot()[0].id).toBe("tx:24");
    expect(activity.transactionActivitySnapshot().at(-1)?.id).toBe("tx:5");

    activity.recordTransactionActivity({
      id: "tx:10",
      kind: "direct",
      title: "Updated transaction",
      status: "failed",
      message: "Reverted",
    });
    expect(activity.transactionActivitySnapshot()).toHaveLength(20);
    expect(activity.transactionActivitySnapshot()[0]).toMatchObject({
      id: "tx:10",
      title: "Updated transaction",
      status: "failed",
    });
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
    expect(hydrated.transactionActivitySnapshot()).toHaveLength(20);

    window.localStorage.setItem(STORAGE_KEY, "not json");
    const malformed = await freshActivityModule();
    expect(malformed.transactionActivitySnapshot()).toEqual([]);
  });

  it("ignores updates for unknown ids", async () => {
    const activity = await freshActivityModule();
    activity.updateTransactionActivity("missing", { status: "failed" });
    expect(activity.transactionActivitySnapshot()).toEqual([]);
  });
});
