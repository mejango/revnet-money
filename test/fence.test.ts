import { activityJournal } from "@/lib/activity-journal";
import { fence, keptOutcomes } from "@/lib/fence";
import { refreshTransactionActivities } from "@/lib/transaction-activity";
import { LockLostError, type LockHandle } from "@bananapus/nana-sdk-core/review/locks";
import { beforeEach, expect, it, vi } from "vitest";

const lock = (held: boolean): LockHandle => ({
  name: "revnet:test",
  mode: "exclusive",
  signal: held ? new AbortController().signal : AbortSignal.abort(),
  held: async () => held,
  assertHeld: async () => {
    if (!held) throw new LockLostError("revnet:test");
  },
});

beforeEach(() => window.localStorage.clear());

it("writes only while every lock still reads as held", async () => {
  const write = vi.fn((value: number) => value * 2);
  await expect(fence([lock(true)], write)(2)).resolves.toBe(4);
  await expect(fence([lock(true), lock(false)], write)(3)).rejects.toBeInstanceOf(LockLostError);
  expect(write).toHaveBeenCalledOnce();
});

it("binds the activity journal to the lock its work runs under", async () => {
  const row = { id: "a", kind: "direct", title: "T", status: "pending", message: "m" } as const;
  await expect(activityJournal([lock(false)]).record(row)).rejects.toBeInstanceOf(LockLostError);
  expect(refreshTransactionActivities()).toEqual([]);
  await activityJournal([lock(true)]).record(row);
  expect(refreshTransactionActivities()).toEqual([expect.objectContaining({ id: "a" })]);
});

it("keeps a wallet answer a lapsed lock refused, and saves it later only for the same attempt", async () => {
  const kept = keptOutcomes("revnet:test-kept");
  const writes: string[] = [];
  const same = true;
  await kept.save(
    [lock(false)],
    () => same,
    () => writes.push("hash"),
  );
  await kept.save(
    [lock(false)],
    () => false,
    () => writes.push("replaced"),
  );
  expect(writes).toEqual([]);
  await kept.apply();
  expect(writes).toEqual(["hash"]);
  await kept.save(
    [lock(true)],
    () => same,
    () => writes.push("held"),
  );
  expect(writes).toEqual(["hash", "held"]);
});
