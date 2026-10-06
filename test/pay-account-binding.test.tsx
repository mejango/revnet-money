import { V6PayCard } from "@/app/[slug]/components/v6/pay/V6PayCard";
import { SafeProposalPendingError } from "@/hooks/useReviewedWriteContract";
import { recordTransactionActivity, updateTransactionActivity } from "@/lib/transaction-activity";
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
  // The chain's own receipt read, which a Safe proposal never makes.
  useWaitForTransactionReceipt: () => ({
    data: undefined,
    error: null,
    isError: false,
    isLoading: false,
    isSuccess: false,
  }),
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
vi.mock("@/hooks/useReviewedWriteContract", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/hooks/useReviewedWriteContract")>();
  return {
    ACCOUNT_CHANGED: "The connected account changed. Review again.",
    // The write hook's own refusal, its tests and its Safe proposal tracking, as the card reads
    // them.
    isSafeProposalPendingError: actual.isSafeProposalPendingError,
    SafeProposalPendingError: actual.SafeProposalPendingError,
    requireOnchainExecution: () => undefined,
    submittedViaSafe: actual.submittedViaSafe,
    useWaitForTransactionReceipt: actual.useWaitForTransactionReceipt,
    useWriteContract: () => ({ writeContractAsync: mocks.write }),
  };
});
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
  window.localStorage.clear();
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

  it("says to check an identical payment's unconfirmed Safe proposal in Safe instead of reporting it proposed", async () => {
    // The identical payment's Safe proposal ended where the app can't confirm its result.
    mocks.write.mockRejectedValue(new SafeProposalPendingError(HASH, "pay", true));
    render(
      <QueryClientProvider client={queryClient()}>
        <V6PayCard />
      </QueryClientProvider>,
    );
    fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "1" } });
    const pay = screen.getByRole("button", { name: "Pay" });
    await waitFor(() => expect(pay).toBeEnabled(), { timeout: 3_000 });
    fireEvent.click(pay);
    const confirm = await screen.findByRole("dialog", { name: "Confirm payment" });
    await within(confirm).findByText("You get");

    fireEvent.click(within(confirm).getByRole("button", { name: "Pay" }));

    await within(confirm).findByText(
      `pay was proposed to Safe as ${HASH}, and its result can't be confirmed here. Check it in Safe, then dismiss it in your account activity.`,
    );
    expect(within(confirm).queryByText(/The payment is proposed in Safe/)).toBeNull();
    // Once its account dismisses the proposal, the payment can be sent again.
    expect(within(confirm).getByRole("button", { name: "Pay" })).toBeEnabled();
  });

  it("returns from the payment's own Safe proposal to the payment, with its line, once that proposal's result can't be confirmed", async () => {
    const proposal = `0x${"cd".repeat(32)}` as Hex;
    const line =
      "This Safe transaction's result can't be confirmed here. Check it in Safe before retrying.";
    recordTransactionActivity({
      id: `tx:1:${proposal}`,
      kind: "safe",
      title: "pay",
      status: "safe-proposed",
      message: line,
      chainId: 1,
      hash: proposal,
      safeProposalHash: proposal,
      safeResultUnconfirmed: true,
    });
    mocks.write.mockResolvedValue(proposal);
    render(
      <QueryClientProvider client={queryClient()}>
        <V6PayCard />
      </QueryClientProvider>,
    );
    fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "1" } });
    const pay = screen.getByRole("button", { name: "Pay" });
    await waitFor(() => expect(pay).toBeEnabled(), { timeout: 3_000 });
    fireEvent.click(pay);
    const confirm = await screen.findByRole("dialog", { name: "Confirm payment" });
    await within(confirm).findByText("You get");

    fireEvent.click(within(confirm).getByRole("button", { name: "Pay" }));

    await within(confirm).findByText(line);
    expect(within(confirm).queryByText(/The payment is proposed in Safe/)).toBeNull();
    expect(within(confirm).getByRole("button", { name: "Pay" })).toBeEnabled();
  });

  it("holds the payment on its own pending Safe proposal, and returns only once that proposal is flagged", async () => {
    const proposal = `0x${"ef".repeat(32)}` as Hex;
    recordTransactionActivity({
      id: `tx:1:${proposal}`,
      kind: "safe",
      title: "pay",
      status: "safe-proposed",
      message:
        "Safe proposal is not executed | 1/2 approvals. It remains asynchronous; do not submit it again.",
      chainId: 1,
      hash: proposal,
      safeProposalHash: proposal,
    });
    mocks.write.mockResolvedValue(proposal);
    render(
      <QueryClientProvider client={queryClient()}>
        <V6PayCard />
      </QueryClientProvider>,
    );
    fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "1" } });
    const pay = screen.getByRole("button", { name: "Pay" });
    await waitFor(() => expect(pay).toBeEnabled(), { timeout: 3_000 });
    fireEvent.click(pay);
    const confirm = await screen.findByRole("dialog", { name: "Confirm payment" });
    await within(confirm).findByText("You get");
    fireEvent.click(within(confirm).getByRole("button", { name: "Pay" }));

    await within(confirm).findByText(/The payment is proposed in Safe/);
    // A later update that is not a flag (a new approvals line) leaves the payment held.
    updateTransactionActivity(`tx:1:${proposal}`, {
      message:
        "Safe proposal is not executed | 2/3 approvals. It remains asynchronous; do not submit it again.",
    });
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(within(confirm).getByText(/The payment is proposed in Safe/)).toBeTruthy();
    expect(within(confirm).queryByRole("button", { name: "Pay" })).toBeNull();

    // The watch ends it unconfirmed while the dialog is open.
    updateTransactionActivity(`tx:1:${proposal}`, {
      message:
        "This Safe transaction's result can't be confirmed here. Check it in Safe before retrying.",
      safeResultUnconfirmed: true,
    });
    await within(confirm).findByText(
      "This Safe transaction's result can't be confirmed here. Check it in Safe before retrying.",
    );
    expect(within(confirm).queryByText(/The payment is proposed in Safe/)).toBeNull();
  });
});
