import { SafeProposalPendingError } from "@/hooks/useReviewedWriteContract";
import { recordTransactionActivity } from "@/lib/transaction-activity";
import { TransactionReviewCancelledError } from "@/lib/transaction-review";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { Hex } from "viem";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  write: vi.fn(),
  toast: vi.fn(),
  hasPermissions: vi.fn(),
  // The hash the loan writes last sent.
  sent: undefined as `0x${string}` | undefined,
}));

vi.mock("wagmi", () => ({
  useAccount: () => ({ address: "0x000000000000000000000000000000000000dEaD" }),
  usePublicClient: () => ({}),
  useWalletClient: () => ({ data: {} }),
  useReadContract: ({ functionName }: { functionName?: string }) => ({
    data: functionName === "PERMISSIONS" ? "0x0000000000000000000000000000000000000004" : undefined,
  }),
  // The chain's own receipt read, which a Safe proposal never makes.
  useWaitForTransactionReceipt: () => ({
    data: undefined,
    error: null,
    isError: false,
    isLoading: false,
    isSuccess: false,
  }),
}));

vi.mock("@/hooks/useReviewedWriteContract", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/hooks/useReviewedWriteContract")>();
  return {
    // The write hook's own refusals, their tests and their lines, as the dialog reads them.
    ...actual,
    requireOnchainExecution: () => undefined,
    useWriteContract: () => ({
      writeContractAsync: mocks.write,
      isPending: false,
      data: mocks.sent,
    }),
  };
});

vi.mock("@bananapus/nana-sdk-core/v6", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@bananapus/nana-sdk-core/v6")>()),
  hasPermissions: mocks.hasPermissions,
}));

vi.mock("@/lib/bendystraw", () => ({
  ProjectOperation: { id: "Project" },
  SuckerGroupOperation: { id: "SuckerGroup" },
  useBendystrawQuery: () => ({ data: undefined }),
}));

vi.mock("@/lib/nana/project", () => ({
  useJBChainId: () => 1,
  useJBContractContext: () => ({ contractAddress: () => undefined }),
  useJBTokenContext: () => ({ token: { data: { decimals: 18, symbol: "REV" } } }),
}));

vi.mock("@/lib/nana/suckers", () => ({
  useSuckersUserTokenBalance: () => ({
    data: [{ chainId: 1, projectId: 7, balance: { value: 5n * 10n ** 18n } }],
  }),
}));

vi.mock("@/hooks/useProjectBaseToken", () => ({ useProjectBaseToken: () => ({}) }));

vi.mock("@/components/ui/use-toast", () => ({
  useToast: () => ({ toast: mocks.toast }),
  toast: mocks.toast,
}));

vi.mock("@/lib/tokenUtils", () => ({
  getTokenConfigForChain: () => ({
    token: "0x000000000000000000000000000000000000EEEe",
    decimals: 18,
    currency: 61166,
    symbol: "ETH",
  }),
  getTokenSymbolFromAddress: () => "ETH",
  isNativeToken: () => true,
}));

import { useBorrowDialog } from "@/app/[slug]/components/Value/hooks/useBorrowDialog";

beforeEach(() => {
  window.localStorage.clear();
  mocks.sent = undefined;
  mocks.hasPermissions.mockResolvedValue(false);
});

describe("wallet-action:loans — a closed permission review", () => {
  it("returns the borrow flow to its start without reporting a denied permission", async () => {
    mocks.write.mockRejectedValue(new TransactionReviewCancelledError());
    const { result } = renderHook(() => useBorrowDialog({ projectId: 7n }));

    act(() => result.current.handleChainSelection(1));
    await act(() => result.current.handleBorrow());

    expect(mocks.write).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ functionName: "setPermissionsFor" }),
    );
    expect(result.current.borrowStatus).toBe("idle");
    expect(mocks.toast).not.toHaveBeenCalled();
  });
});

describe("wallet-action:loans — a permission step refused by a Safe proposal the app can't confirm", () => {
  it("says to check the proposal in Safe, and neither that permission was denied nor that it failed", async () => {
    const proposal = `0x${"ab".repeat(32)}` as Hex;
    mocks.write.mockRejectedValue(
      new SafeProposalPendingError(proposal, "setPermissionsFor", true),
    );
    const { result } = renderHook(() => useBorrowDialog({ projectId: 7n }));

    act(() => result.current.handleChainSelection(1));
    await act(() => result.current.handleBorrow());

    expect(result.current.borrowStatus).toBe("safe-unconfirmed");
    expect(mocks.toast).toHaveBeenCalledExactlyOnceWith({
      title: "Safe proposal unconfirmed",
      description: `setPermissionsFor was proposed to Safe as ${proposal}, and its result can't be confirmed here. Check it in Safe, then dismiss it in your account activity.`,
    });
  });
});

describe("wallet-action:loans — a loan left open over its own Safe proposal the app can't confirm", () => {
  it("stops reading as loading and says to check the proposal in Safe", async () => {
    const proposal = `0x${"cd".repeat(32)}` as Hex;
    recordTransactionActivity({
      id: `tx:1:${proposal}`,
      kind: "safe",
      title: "borrowFrom",
      status: "safe-proposed",
      message:
        "This Safe transaction's result can't be confirmed here. Check it in Safe before retrying.",
      chainId: 1,
      hash: proposal,
      safeProposalHash: proposal,
      safeResultUnconfirmed: true,
    });
    mocks.sent = proposal;

    const { result } = renderHook(() => useBorrowDialog({ projectId: 7n }));

    await waitFor(() => expect(result.current.borrowStatus).toBe("safe-unconfirmed"));
    expect(result.current.loading).toBe(false);
  });
});

describe("wallet-action:loans — a refinance whose permission check can't be read", () => {
  // One loan for every render, as the page passes it.
  const LOAN = {
    id: "3",
    chainId: 1,
    borrowAmount: (10n ** 18n).toString(),
    collateral: (2n * 10n ** 18n).toString(),
    projectId: 7,
  };

  it("ends in an error the dialog can be closed from, instead of holding the check", async () => {
    mocks.hasPermissions.mockRejectedValue(new Error("The node can't be reached."));
    // The loan names its own chain.
    const { result } = renderHook(() => useBorrowDialog({ projectId: 7n, selectedLoan: LOAN }));
    // Adding collateral needs the permission check.
    act(() => result.current.setCollateralAmount("1"));

    await act(() => result.current.handleBorrow());

    expect(mocks.hasPermissions).toHaveBeenCalledTimes(1);
    expect(result.current.internalSelectedLoan).toBe(LOAN);
    expect(result.current.borrowStatus).toBe("error");
    expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({ variant: "destructive" }));
  });
});
