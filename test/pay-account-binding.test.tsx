import { V6PayCard } from "@/app/[slug]/components/v6/pay/V6PayCard";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import type { Address, Hex } from "viem";
import { beforeEach, describe, expect, it, vi } from "vitest";

// wallet-action:pay
//
// A payment's tokens go to the account it was prepared for. When the wallet
// switches accounts with the confirm open, pressing Pay must not send the
// prepared payment from the new account: the new account would pay and the
// old one would receive. It rebuilds the payment for the account now
// connected and says so, and only the next press pays.

const A = "0x1111111111111111111111111111111111111111" as Address;
const B = "0x2222222222222222222222222222222222222222" as Address;
const HASH = `0x${"ab".repeat(32)}` as Hex;

const mocks = vi.hoisted(() => ({
  address: "0x1111111111111111111111111111111111111111",
  write: vi.fn(),
  simulate: vi.fn(),
}));

vi.mock("wagmi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("wagmi")>()),
  useAccount: () => ({ address: mocks.address, isConnected: true }),
  usePublicClient: () => ({ simulateContract: mocks.simulate }),
}));
vi.mock("@/components/ButtonWithWallet", () => ({
  ButtonWithWallet: ({
    children,
    loading: _loading,
    targetChainId: _chain,
    connectWalletText: _connect,
    ...props
  }: {
    children: ReactNode;
    loading?: boolean;
    targetChainId?: unknown;
    connectWalletText?: string;
  }) => <button {...props}>{children}</button>,
}));
vi.mock("@/components/GetFunds", () => ({
  useOnRamp: () => ({ supported: false, buy: vi.fn() }),
}));
vi.mock("@/components/IpfsImage", () => ({ ImageWithFallback: () => null }));
vi.mock("@/hooks/useAllowance", () => ({
  useAllowance: () => ({ ensureAllowance: vi.fn(), getApprovalReceipt: () => undefined }),
}));
vi.mock("@/hooks/useReviewedPermit2Signature", () => ({
  useReviewedPermit2Signature: () => ({ signPermit2Async: vi.fn() }),
}));
vi.mock("@/hooks/useReviewedWriteContract", () => ({
  ACCOUNT_CHANGED: "The connected account changed. Review again.",
  isSafeProposalPendingError: () => false,
  requireOnchainExecution: () => undefined,
  submittedViaSafe: () => false,
  useWaitForTransactionReceipt: () => ({ isSuccess: false, isError: false }),
  useWriteContract: () => ({ writeContractAsync: mocks.write }),
}));
vi.mock("@/hooks/useTokenBalances", () => ({
  useTokenBalances: () => ({
    balances: new Map([["0x000000000000000000000000000000000000EEEe", 10n ** 20n]]),
    isLoading: false,
  }),
}));
vi.mock("@/lib/waitForReceipt", () => ({
  isTransactionReceiptUnavailableError: () => false,
  waitForReceiptWithRetry: async () => ({ status: "success" }),
}));
vi.mock("@/lib/nana/project", () => ({
  useJBTokenContext: () => ({ token: { data: { symbol: "REV", decimals: 18 } } }),
}));
vi.mock("@/lib/nana/suckers", () => ({ useSuckers: () => ({ data: [] }) }));
vi.mock("@/lib/paymentTerminal", () => ({
  resolveBestV6PayRoute: async () => ({
    address: "0x3333333333333333333333333333333333333333",
    type: "multi",
    preview: { beneficiaryTokenCount: 10n ** 21n, reservedTokenCount: 0n },
  }),
}));
vi.mock("@/providers/ParaAuthContext", () => ({
  useParaAuth: () => ({ requestSignIn: vi.fn() }),
}));
vi.mock("@/app/[slug]/components/PayCard/SelectedSuckerContext", () => ({
  useSelectedSucker: () => ({
    selectedSucker: { peerChainId: 1, projectId: 7n },
    setSelectedSucker: vi.fn(),
  }),
}));
vi.mock("@/app/[slug]/components/v6/ShopCartContext", () => ({
  useShopCart: () => ({ items: [], remove: vi.fn(), setQuantity: vi.fn() }),
}));
vi.mock("@/app/[slug]/components/v6/owners/market/lib", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/app/[slug]/components/v6/owners/market/lib")>()),
  readPoolSnapshot: async () => ({ pool: null }),
}));
vi.mock("@/app/[slug]/components/v6/pay/usePayShop", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/app/[slug]/components/v6/pay/usePayShop")>()),
  usePayShop: () => ({ data: undefined }),
  usePayShopCredits: () => ({ data: 0n, isLoading: false }),
  usePayShopRoutes: () => ({ data: undefined, isLoading: false }),
}));
vi.mock("@/app/[slug]/components/v6/pay/usePaySurface", () => {
  const surface = {
    tokens: [
      {
        token: "0x000000000000000000000000000000000000EEEe",
        decimals: 18,
        currency: 61166,
        symbol: "ETH",
        viaRouter: false,
      },
    ],
    rulesetStart: 0,
    pausePay: false,
    terminals: ["0x3333333333333333333333333333333333333333"],
  };
  return { usePaySurface: () => ({ data: surface, isError: false }) };
});
vi.mock("@/app/[slug]/components/v6/pay/V6PayShopStrip", () => ({ V6PayShopStrip: () => null }));

const queryClient = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });

beforeEach(() => {
  mocks.address = A;
  mocks.write.mockReset().mockResolvedValue(HASH);
  mocks.simulate.mockReset().mockResolvedValue({ request: {} });
});

describe("wallet-action:pay — a payment bound to the account it was prepared for", () => {
  it("rebuilds the payment for a newly connected account instead of paying the old one's tokens from it", async () => {
    const client = queryClient();
    const view = render(
      <QueryClientProvider client={client}>
        <V6PayCard />
      </QueryClientProvider>,
    );
    fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "1" } });
    const pay = screen.getByRole("button", { name: "Pay" });
    await waitFor(() => expect(pay).toBeEnabled(), { timeout: 3_000 });
    fireEvent.click(pay);
    const confirm = await screen.findByRole("dialog", { name: "Confirm payment" });
    await within(confirm).findByText("You get");

    // The wallet switches accounts while the prepared payment is on screen.
    mocks.address = B;
    view.rerender(
      <QueryClientProvider client={client}>
        <V6PayCard />
      </QueryClientProvider>,
    );
    fireEvent.click(within(confirm).getByRole("button", { name: "Pay" }));

    await within(confirm).findByText("The connected account changed. Review again.");
    expect(mocks.simulate).not.toHaveBeenCalled();
    expect(mocks.write).not.toHaveBeenCalled();

    // Rebuilt for B: the next press pays from B, to B.
    await waitFor(() => expect(within(confirm).getByText("You get")).toBeInTheDocument());
    fireEvent.click(within(confirm).getByRole("button", { name: "Pay" }));
    await waitFor(() => expect(mocks.write).toHaveBeenCalledTimes(1));
    const payment = mocks.write.mock.calls[0]![0] as {
      account: Address;
      functionName: string;
      args: readonly unknown[];
    };
    expect(payment.functionName).toBe("pay");
    expect(payment.account).toBe(B);
    // pay(projectId, token, amount, beneficiary, minReturnedTokens, memo, metadata)
    expect(payment.args[3]).toBe(B);
    expect(mocks.simulate).toHaveBeenCalledWith(expect.objectContaining({ account: B }));
  });
});
