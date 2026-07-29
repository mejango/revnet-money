import {
  listPendingSafeTransactions,
  safeExecutionArgs,
  safeTransactionHash,
  usableSafeConfirmations,
  type SafeQueuedTransaction,
} from "@/lib/safe-queue";
import { zeroAddress, type Address, type Hex } from "viem";
import { afterEach, describe, expect, it, vi } from "vitest";

const SAFE = "0x2222222222222222222222222222222222222222" as Address;
const LOW_OWNER = "0x1111111111111111111111111111111111111111" as Address;
const HIGH_OWNER = "0x9999999999999999999999999999999999999999" as Address;
const STALE_OWNER = "0x7777777777777777777777777777777777777777" as Address;
const lowSignature = `0x${"11".repeat(65)}` as Hex;
const highSignature = `0x${"99".repeat(65)}` as Hex;

const transaction = {
  to: "0x3333333333333333333333333333333333333333",
  value: "17",
  data: "0x1234",
  operation: 0,
  safeTxGas: "100",
  baseGas: "20",
  gasPrice: "2",
  gasToken: zeroAddress,
  refundReceiver: zeroAddress,
  nonce: 8,
  confirmations: [
    { owner: HIGH_OWNER, signature: highSignature },
    { owner: LOW_OWNER, signature: lowSignature },
    { owner: HIGH_OWNER, signature: highSignature },
    { owner: STALE_OWNER, signature: `0x${"77".repeat(65)}` as Hex },
    { owner: LOW_OWNER, signature: "0x1234" as Hex },
  ],
} satisfies SafeQueuedTransaction;

describe("Safe queue execution", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });
  // wallet-action:safe-queue
  it("sorts signatures by owner and binds all queued fields into execution args", () => {
    expect(
      usableSafeConfirmations(transaction, [LOW_OWNER, HIGH_OWNER]).map(({ owner }) => owner),
    ).toEqual([LOW_OWNER, HIGH_OWNER]);
    expect(safeExecutionArgs(transaction, [LOW_OWNER, HIGH_OWNER])).toEqual([
      transaction.to,
      17n,
      "0x1234",
      0,
      100n,
      20n,
      2n,
      zeroAddress,
      zeroAddress,
      `0x${lowSignature.slice(2)}${highSignature.slice(2)}`,
    ]);
  });

  it("produces a deterministic EIP-712 hash that changes with the nonce", () => {
    const hash = safeTransactionHash(1, SAFE, transaction);
    expect(hash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(safeTransactionHash(1, SAFE, transaction)).toBe(hash);
    expect(safeTransactionHash(1, SAFE, { ...transaction, nonce: 9 })).not.toBe(hash);
  });

  it("loads every pending page and keeps only current-or-later nonces", async () => {
    const second = { ...transaction, nonce: 9 };
    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          next: "/tx-service/eth/api/v1/page-2",
          results: [{ ...transaction, nonce: 7 }, transaction],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ next: null, results: [second] }),
      });
    vi.stubGlobal("fetch", fetchSpy);

    expect(await listPendingSafeTransactions(1, SAFE, 8)).toEqual([transaction, second]);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("never presents an unsupported queue service as an empty queue", async () => {
    await expect(listPendingSafeTransactions(999, SAFE, 0)).rejects.toThrow(
      "unavailable on this chain",
    );
  });
});
