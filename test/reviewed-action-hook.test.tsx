import { reviewedCall } from "@/lib/reviewed-call";
import { refreshTransactionActivities } from "@/lib/transaction-activity";
import { clearViewAs, setViewAs } from "@/lib/view-as";
import type { ReviewedAction, ReviewedCall } from "@bananapus/nana-sdk-core/review";
import { act, renderHook } from "@testing-library/react";
import { erc20Abi, type Address, type Hex } from "viem";
import { beforeEach, describe, expect, it, vi } from "vitest";

// revnet's layer over core's useReviewedRun: what it adds around each run.

const REVIEWED = "0x1111111111111111111111111111111111111111" as Address;
const OTHER = "0x2222222222222222222222222222222222222222" as Address;
const HASH = `0x${"ab".repeat(32)}` as Hex;

const mocks = vi.hoisted(() => ({
  run: vi.fn(),
  find: vi.fn(),
  discard: vi.fn(),
  account: { address: "0x1111111111111111111111111111111111111111", connector: { id: "a" } },
}));

vi.mock("wagmi", () => ({
  useAccount: () => ({ address: mocks.account.address }),
  useConfig: () => ({}),
}));
vi.mock("wagmi/actions", () => ({
  getAccount: () => mocks.account,
  getPublicClient: () => undefined,
  getWalletClient: vi.fn(),
  switchChain: vi.fn(),
}));
vi.mock("@/lib/safe-connector", () => ({
  isSafeConnection: () => false,
  safeWalletPeerSettled: async () => undefined,
}));
vi.mock("@bananapus/nana-sdk-core/review/react", () => ({
  useReviewedRun: () => ({ run: mocks.run, phase: "idle", failure: null, error: null }),
}));
vi.mock("@bananapus/nana-sdk-core/review", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@bananapus/nana-sdk-core/review")>()),
  findReviewedSequence: mocks.find,
  discardReviewedSequence: mocks.discard,
}));

import { useReviewedAction } from "@/hooks/useReviewedAction";

const call = (amount: number): ReviewedCall =>
  reviewedCall({
    chainId: 1,
    address: "0x3333333333333333333333333333333333333333",
    abi: erc20Abi,
    functionName: "approve",
    args: [OTHER, BigInt(amount)],
  });

beforeEach(() => {
  window.localStorage.clear();
  clearViewAs();
  mocks.account = { address: REVIEWED, connector: { id: "a" } };
  mocks.run.mockReset().mockResolvedValue({ status: "done", hashes: [], receipts: [] });
  mocks.find.mockReset().mockReturnValue(null);
  mocks.discard.mockReset().mockResolvedValue(undefined);
});

describe("useReviewedAction", () => {
  it("refuses at the write gate once view-as turned on after the review", async () => {
    const { result } = renderHook(() => useReviewedAction());
    await act(() => result.current.run({ account: REVIEWED, calls: [call(1)] }));
    const sent = mocks.run.mock.calls[0][0] as ReviewedAction;
    expect(() => sent.assertWriteState?.()).not.toThrow();
    setViewAs(OTHER);
    expect(() => sent.assertWriteState?.()).toThrow(/Exit View as/);
  });

  it("journals a send under the reviewed account, not the one the wallet shows after", async () => {
    const { result } = renderHook(() => useReviewedAction());
    await act(() => result.current.run({ account: REVIEWED, title: "Pay", calls: [call(1)] }));
    const sent = mocks.run.mock.calls[0][0] as ReviewedAction;
    mocks.account = { address: OTHER, connector: mocks.account.connector };
    await sent.onSubmitted?.(call(1), 0, HASH, { safe: false, adopted: false });
    expect(refreshTransactionActivities()).toEqual([
      expect.objectContaining({ hash: HASH, account: REVIEWED }),
    ]);
  });

  it("replaces an unfinished earlier run whose calls were rebuilt, and resumes one with the same calls", async () => {
    const { result } = renderHook(() => useReviewedAction());
    mocks.find.mockReturnValue({ calls: [call(1), call(2)] });

    await act(() => result.current.run({ scope: "s", calls: [call(1), call(2)] }));
    expect(mocks.discard).not.toHaveBeenCalled();

    await act(() => result.current.run({ scope: "s", calls: [call(3)] }));
    expect(mocks.discard).toHaveBeenCalledOnce();
    expect(mocks.run).toHaveBeenCalledTimes(2);
  });

  it("sends nothing, and says why, when the earlier run still has a held step", async () => {
    const { result } = renderHook(() => useReviewedAction());
    mocks.find.mockReturnValue({ calls: [call(1)] });
    mocks.discard.mockRejectedValue(
      new Error("A step of this action is still pending. Nothing was discarded."),
    );

    const ended = await act(() => result.current.run({ scope: "s", calls: [call(3)] }));
    expect(ended).toMatchObject({
      status: "failed",
      error: "A step of this action is still pending. Nothing was discarded.",
    });
    expect(mocks.run).not.toHaveBeenCalled();
  });
});
