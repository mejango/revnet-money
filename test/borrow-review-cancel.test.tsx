import { TransactionReviewCancelledError } from "@/lib/transaction-review";
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  write: vi.fn(),
  toast: vi.fn(),
  hasPermissions: vi.fn(),
}));

vi.mock("wagmi", () => ({
  useAccount: () => ({ address: "0x000000000000000000000000000000000000dEaD" }),
  usePublicClient: () => ({}),
  useWalletClient: () => ({ data: {} }),
  useReadContract: ({ functionName }: { functionName?: string }) => ({
    data: functionName === "PERMISSIONS" ? "0x0000000000000000000000000000000000000004" : undefined,
  }),
}));

vi.mock("@/hooks/useReviewedWriteContract", () => ({
  isSafeProposalPendingError: () => false,
  requireOnchainExecution: () => undefined,
  useWaitForTransactionReceipt: () => ({ isLoading: false, isSuccess: false }),
  useWriteContract: () => ({ writeContractAsync: mocks.write, isPending: false, data: undefined }),
}));

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
