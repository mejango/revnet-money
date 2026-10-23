import { erc20ApproveAbi } from "@/lib/erc20-approve";
import { act, renderHook } from "@testing-library/react";
import { encodeFunctionData, type Address, type Hex } from "viem";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  address: "0x000000000000000000000000000000000000dEaD" as Address | undefined,
  publicClientAvailable: true,
  readContract: vi.fn(),
  run: vi.fn(),
}));

vi.mock("wagmi", () => ({
  useAccount: () => ({ address: mocks.address }),
  usePublicClient: () =>
    mocks.publicClientAvailable ? { readContract: mocks.readContract } : undefined,
}));

vi.mock("@/hooks/useReviewedAction", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/hooks/useReviewedAction")>()),
  useReviewedAction: () => ({ run: mocks.run }),
}));

const TOKEN = "0x0000000000000000000000000000000000001000" as Address;
const SPENDER = "0x0000000000000000000000000000000000002000" as Address;
const HASH = `0x${"34".repeat(32)}` as Hex;
/** The approval's intent, which its caller names. */
const APPROVAL = "approval-intent";

async function freshHook() {
  vi.resetModules();
  return import("@/hooks/useAllowance");
}

beforeEach(() => {
  mocks.address = "0x000000000000000000000000000000000000dEaD";
  mocks.publicClientAvailable = true;
  mocks.readContract.mockResolvedValue(0n);
  mocks.run.mockReset();
  mocks.run.mockResolvedValue({
    status: "done",
    hashes: [HASH],
    receipts: [{ status: "success" }],
  });
});

describe("allowance hook", () => {
  it("does nothing when the exact spender allowance is already sufficient", async () => {
    mocks.readContract.mockResolvedValue(50n);
    const hooks = await freshHook();
    const { result } = renderHook(() => hooks.useAllowance(11155111));
    let hash: Hex | null | undefined;

    await act(async () => {
      hash = await result.current.ensureAllowance(TOKEN, SPENDER, 50n, APPROVAL);
    });

    expect(hash).toBeNull();
    expect(mocks.readContract).toHaveBeenCalledWith(
      expect.objectContaining({
        address: TOKEN,
        functionName: "allowance",
        args: [mocks.address, SPENDER],
      }),
    );
    expect(mocks.run).not.toHaveBeenCalled();
  });

  it("wallet-action:allowance approves the exact reviewed call, held by its intent, and keeps the receipt", async () => {
    const receipt = { status: "success", blockNumber: 12_345n } as const;
    mocks.run.mockResolvedValue({ status: "done", hashes: [HASH], receipts: [receipt] });
    const hooks = await freshHook();
    const { result } = renderHook(() => hooks.useAllowance(11155111));
    let hash: Hex | null | undefined;

    await act(async () => {
      hash = await result.current.ensureAllowance(TOKEN, SPENDER, 75n, APPROVAL);
    });

    expect(hash).toBe(HASH);
    expect(mocks.run).toHaveBeenCalledWith(
      expect.objectContaining({
        account: mocks.address,
        calls: [
          expect.objectContaining({
            chainId: 11155111,
            to: TOKEN,
            // No declared return: a token whose approve returns nothing (USDT) still simulates.
            abi: erc20ApproveAbi,
            functionName: "approve",
            args: [SPENDER, 75n],
            data: encodeFunctionData({
              abi: erc20ApproveAbi,
              functionName: "approve",
              args: [SPENDER, 75n],
            }),
            // Held by the approval's intent, whatever amount the plan calculated.
            intent: APPROVAL,
          }),
        ],
      }),
    );
    expect(result.current.getApprovalReceipt(hash)).toEqual(receipt);
    expect(result.current.getApprovalReceipt(null)).toBeUndefined();
    expect(result.current.getApprovalReceipt(undefined)).toBeUndefined();
    expect(result.current.getApprovalReceipt(`0x${"56".repeat(32)}`)).toBeUndefined();
    expect(result.current.isApproving).toBe(false);
  });

  it("stops at a Safe proposal: the spend waits for the Safe", async () => {
    mocks.run.mockResolvedValue({ status: "proposed", step: 0, safeTxHash: HASH });
    const hooks = await freshHook();
    const { result } = renderHook(() => hooks.useAllowance(11155111));

    await act(async () => {
      await expect(result.current.ensureAllowance(TOKEN, SPENDER, 1n, APPROVAL)).rejects.toThrow(
        /waiting in your Safe/i,
      );
    });
    expect(result.current.isApproving).toBe(false);
  });

  it("rejects with the run's line when the approval failed", async () => {
    mocks.run.mockResolvedValue({
      status: "failed",
      error: "The transaction reverted. Nothing changed; try again.",
      failure: new Error("reverted"),
    });
    const hooks = await freshHook();
    const { result } = renderHook(() => hooks.useAllowance(11155111));

    await act(async () => {
      await expect(result.current.ensureAllowance(TOKEN, SPENDER, 1n, APPROVAL)).rejects.toThrow(
        "The transaction reverted. Nothing changed; try again.",
      );
    });
    expect(result.current.isApproving).toBe(false);
  });

  it("fails closed without a connected wallet", async () => {
    mocks.address = undefined;
    const hooks = await freshHook();
    const { result } = renderHook(() => hooks.useAllowance(11155111));

    await expect(result.current.ensureAllowance(TOKEN, SPENDER, 1n, APPROVAL)).rejects.toThrow(
      "Wallet not connected",
    );
    expect(mocks.readContract).not.toHaveBeenCalled();
  });

  it("fails closed without a public client", async () => {
    mocks.publicClientAvailable = false;
    const hooks = await freshHook();
    const { result } = renderHook(() => hooks.useAllowance(11155111));

    await expect(result.current.ensureAllowance(TOKEN, SPENDER, 1n, APPROVAL)).rejects.toThrow(
      "Please try again",
    );
    expect(mocks.readContract).not.toHaveBeenCalled();
  });
});
