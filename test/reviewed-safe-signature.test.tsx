import { useReviewedSafeSignature } from "@/hooks/useReviewedSafeSignature";
import { act, renderHook } from "@testing-library/react";
import { type Address, type Hex, zeroAddress } from "viem";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  config: { id: "safe-signature-config" },
  account: {
    address: "0x1111111111111111111111111111111111111111" as Address | undefined,
    chainId: 1 as number | undefined,
  },
  getAccount: vi.fn(),
  getWalletClient: vi.fn(),
  switchChain: vi.fn(),
  signTypedData: vi.fn(),
}));

vi.mock("wagmi", () => ({
  useConfig: () => mocks.config,
  useSwitchChain: () => ({ switchChainAsync: mocks.switchChain }),
}));

vi.mock("wagmi/actions", () => ({
  getAccount: mocks.getAccount,
  getWalletClient: mocks.getWalletClient,
}));

const ACCOUNT = "0x1111111111111111111111111111111111111111" as Address;
const SAFE = "0x2222222222222222222222222222222222222222" as Address;
const TARGET = "0x3333333333333333333333333333333333333333" as Address;
const SIGNATURE = `0x${"12".repeat(65)}` as Hex;
const tx = {
  to: TARGET,
  value: "7",
  data: "0x1234" as Hex,
  operation: 0,
  safeTxGas: "100",
  baseGas: "20",
  gasPrice: "1",
  gasToken: zeroAddress,
  refundReceiver: zeroAddress,
  nonce: 4,
};

beforeEach(() => {
  window.localStorage.clear();
  mocks.account = { address: ACCOUNT, chainId: 1 };
  mocks.getAccount.mockImplementation(() => mocks.account);
  mocks.switchChain.mockImplementation(async ({ chainId }: { chainId: number }) => {
    mocks.account = { ...mocks.account, chainId };
  });
  mocks.signTypedData.mockResolvedValue(SIGNATURE);
  mocks.getWalletClient.mockResolvedValue({
    account: { address: ACCOUNT },
    signTypedData: mocks.signTypedData,
  });
});

describe("reviewed Safe signature boundary", () => {
  // wallet-action:safe-signature-boundary
  it("reviews the exact Safe call before signing its EIP-712 payload", async () => {
    const events: string[] = [];
    const review = await import("@/lib/transaction-review");
    const dispose = review.registerTransactionReviewHandler(async (request) => {
      events.push("review");
      expect(request).toMatchObject({
        kind: "authorization",
        calls: [{ chainId: 8453, from: ACCOUNT, to: TARGET, value: 7n, data: "0x1234" }],
        authorization: {
          type: "EIP-712 SafeTx",
          safe: SAFE,
          nonce: 4,
        },
      });
      return true;
    });
    mocks.signTypedData.mockImplementation(async () => {
      events.push("sign");
      return SIGNATURE;
    });

    const { result } = renderHook(() => useReviewedSafeSignature());
    let signature: Hex | undefined;
    await act(async () => {
      signature = await result.current.signSafeTransactionAsync({
        chainId: 8453,
        safe: SAFE,
        tx,
      });
    });

    expect(signature).toBe(SIGNATURE);
    expect(events).toEqual(["review", "sign"]);
    expect(mocks.switchChain).toHaveBeenCalledWith({ chainId: 8453 });
    expect(mocks.signTypedData).toHaveBeenCalledWith(
      expect.objectContaining({
        account: { address: ACCOUNT },
        domain: { chainId: 8453, verifyingContract: SAFE },
        primaryType: "SafeTx",
      }),
    );
    dispose();
  });

  it("fails closed if the service hash does not match the reconstructed payload", async () => {
    const { result } = renderHook(() => useReviewedSafeSignature());

    await expect(
      result.current.signSafeTransactionAsync({
        chainId: 1,
        safe: SAFE,
        tx: { ...tx, safeTxHash: `0x${"ff".repeat(32)}` },
      }),
    ).rejects.toThrow("does not match");
    expect(mocks.switchChain).not.toHaveBeenCalled();
    expect(mocks.signTypedData).not.toHaveBeenCalled();
  });
});
