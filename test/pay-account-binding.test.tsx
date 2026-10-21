import { V6PayCard } from "@/app/[slug]/components/v6/pay/V6PayCard";
import { SafeProposalPendingError } from "@/hooks/useReviewedWriteContract";
import { recordTransactionActivity, updateTransactionActivity } from "@/lib/transaction-activity";
import { PAY_QUOTE_FAILED_MESSAGE } from "@bananapus/nana-sdk-core/v6";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import type { Address, Hex } from "viem";
import { beforeEach, describe, expect, it, vi } from "vitest";

// A payment's tokens go to the account it was prepared for. When the wallet
// switches accounts with the confirm open, pressing Pay must not send the
// prepared payment from the new account: the new account would pay and the
// old one would receive. It rebuilds the payment for the account now
// connected and says so, and only the next press pays.

const A = "0x1111111111111111111111111111111111111111" as Address;
const B = "0x2222222222222222222222222222222222222222" as Address;
const HASH = `0x${"ab".repeat(32)}` as Hex;

const mocks = vi.hoisted(() => ({
  address: "0x1111111111111111111111111111111111111111" as string | undefined,
  write: vi.fn(),
  simulate: vi.fn(),
  routeError: null as Error | null,
  terminal: "0x3333333333333333333333333333333333333333",
  minReturned: 99n * 10n ** 19n,
  quoteFailed: false,
  routeCalls: 0,
  routeGate: null as Promise<void> | null,
  shop: undefined as unknown,
  cart: [] as unknown[],
  erc20: false,
  ensureAllowance: vi.fn(),
}));

const TKN = "0x7777777777777777777777777777777777777777" as Address;

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

const SHOP_HOOK = "0x4444444444444444444444444444444444444444" as Address;
const SHOP = {
  hook: SHOP_HOOK,
  idTarget: "0x5555555555555555555555555555555555555555",
  pricingCurrency: 61166,
  pricingDecimals: 18,
  tiers: [
    {
      id: 1,
      price: 10n ** 17n,
      discountPercent: 0,
      remaining: 10,
      unlimited: true,
      cantBuyWithCredits: false,
      resolvedUri: "",
      encodedIpfsUri: "0x",
    },
  ],
};
const cartOf = (quantity: number) => [
  {
    tierId: 1n,
    quantity,
    price: 10n ** 17n,
    currency: 61166,
    hook: SHOP_HOOK,
    chainId: 1,
    name: "Hat",
  },
];

vi.mock("@bananapus/nana-sdk-core/v6", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@bananapus/nana-sdk-core/v6")>()),
  resolvePaymentTerminal: async () => ({ address: mocks.terminal, isRouter: false }),
  // The metadata names how many items the payment mints, so a stale cart is visible.
  prepareUserPay: async (_client: unknown, args: { tiers?: { tierIdsToMint: bigint[] } }) => ({
    preview: { beneficiaryTokenCount: 10n ** 21n, reservedTokenCount: 0n },
    metadata: `0x${(args.tiers?.tierIdsToMint.length ?? 0).toString(16).padStart(2, "0")}`,
    minReturnedTokens: mocks.minReturned,
  }),
}));

vi.mock("wagmi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("wagmi")>()),
  useAccount: () => ({ address: mocks.address, isConnected: true }),
  // ERC-20 allowance reads answer zero, so every ERC-20 payment needs an approval.
  usePublicClient: () => ({ simulateContract: mocks.simulate, readContract: async () => 0n }),
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
  useAllowance: () => ({
    ensureAllowance: mocks.ensureAllowance,
    getApprovalReceipt: () => undefined,
  }),
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
    balances: new Map([
      ["0x000000000000000000000000000000000000EEEe", 10n ** 20n],
      [TKN, 10n ** 20n],
    ]),
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
  resolveBestV6PayRoute: async () => {
    mocks.routeCalls += 1;
    if (mocks.routeGate) await mocks.routeGate;
    if (mocks.routeError) throw mocks.routeError;
    return {
      quoteFailed: mocks.quoteFailed,
      address: mocks.terminal,
      type: "multi",
      preview: { beneficiaryTokenCount: 10n ** 21n, reservedTokenCount: 0n },
      metadata: "0x5150",
      minReturnedTokens: mocks.minReturned,
    };
  },
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
  useShopCart: () => ({ items: mocks.cart, remove: vi.fn(), setQuantity: vi.fn() }),
}));
vi.mock("@/app/[slug]/components/v6/pay/usePayShop", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/app/[slug]/components/v6/pay/usePayShop")>()),
  usePayShop: () => ({ data: mocks.shop }),
  usePayShopCredits: () => ({ data: 0n, isLoading: false }),
  usePayShopRoutes: () => ({
    data: mocks.shop
      ? {
          [`${mocks.erc20 ? TKN.toLowerCase() : "0x000000000000000000000000000000000000eeee"}:false`]:
            {
              supported: true,
              pricePerUnit: 10n ** 18n,
            },
        }
      : undefined,
    isLoading: false,
  }),
}));
vi.mock("@/app/[slug]/components/v6/pay/usePaySurface", () => {
  const surfaceOf = (token: string, symbol: string) => ({
    tokens: [{ token, decimals: 18, currency: 61166, symbol, viaRouter: false }],
    rulesetStart: 0,
    pausePay: false,
    terminals: ["0x3333333333333333333333333333333333333333"],
  });
  const eth = surfaceOf("0x000000000000000000000000000000000000EEEe", "ETH");
  const tkn = surfaceOf("0x7777777777777777777777777777777777777777", "TKN");
  return { usePaySurface: () => ({ data: mocks.erc20 ? tkn : eth, isError: false }) };
});
vi.mock("@/app/[slug]/components/v6/pay/V6PayShopStrip", () => ({ V6PayShopStrip: () => null }));

const queryClient = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });

beforeEach(() => {
  window.localStorage.clear();
  mocks.address = A;
  mocks.routeError = null;
  mocks.terminal = "0x3333333333333333333333333333333333333333";
  mocks.minReturned = 99n * 10n ** 19n;
  mocks.quoteFailed = false;
  mocks.routeCalls = 0;
  mocks.routeGate = null;
  mocks.shop = undefined;
  mocks.cart = [];
  mocks.erc20 = false;
  mocks.ensureAllowance.mockReset().mockResolvedValue(HASH);
  mocks.write.mockReset().mockResolvedValue(HASH);
  mocks.simulate.mockReset().mockResolvedValue({ request: {} });
});

describe("a payment bound to the account it was prepared for", () => {
  it("wallet-action:pay rebuilds the payment for a newly connected account instead of paying the old one's tokens from it", async () => {
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
    await within(confirm).findByText("You get at least");

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
    await waitFor(() => expect(within(confirm).getByText("You get at least")).toBeInTheDocument());
    fireEvent.click(within(confirm).getByRole("button", { name: "Pay" }));
    await waitFor(() => expect(mocks.write).toHaveBeenCalledTimes(1));
    const payment = mocks.write.mock.calls[0]![0] as {
      chainId: number;
      account: Address;
      functionName: string;
      args: readonly unknown[];
    };
    expect(payment.functionName).toBe("pay");
    expect(payment.account).toBe(B);
    // The payment names its chain; the reviewed write switches the wallet to it.
    expect(payment).toMatchObject({ chainId: 1 });
    // pay(projectId, token, amount, beneficiary, minReturnedTokens, memo, metadata)
    expect(payment.args[3]).toBe(B);
    // The terminal is paid with exactly the prepared buyback metadata and minimum.
    expect(payment.args[4]).toBe(99n * 10n ** 19n);
    expect(payment.args[6]).toBe("0x5150");
    expect(mocks.simulate).toHaveBeenCalledWith(expect.objectContaining({ account: B }));
  });

  it("blocks the payment when the pay preparation fails, and lets it through once a retry succeeds", async () => {
    mocks.routeError = new Error("buyback hookOf read failed");
    render(
      <QueryClientProvider client={queryClient()}>
        <V6PayCard />
      </QueryClientProvider>,
    );
    fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "1" } });
    await screen.findByText(/Couldn.t check what you will receive/, undefined, { timeout: 3_000 });
    expect(screen.getByRole("button", { name: "Pay" })).toBeDisabled();
    expect(mocks.write).not.toHaveBeenCalled();

    mocks.routeError = null;
    fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "2" } });
    await waitFor(() => expect(screen.getByRole("button", { name: "Pay" })).toBeEnabled(), {
      timeout: 3_000,
    });
  });

  it("does not prepare from the old quote when the confirm's refetch fails", async () => {
    render(
      <QueryClientProvider client={queryClient()}>
        <V6PayCard />
      </QueryClientProvider>,
    );
    fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "1" } });
    const pay = screen.getByRole("button", { name: "Pay" });
    await waitFor(() => expect(pay).toBeEnabled(), { timeout: 3_000 });
    // The card holds a good quote; the confirm's refetch of it fails.
    mocks.routeError = new Error("buyback hookOf read failed");
    fireEvent.click(pay);
    const confirm = await screen.findByRole("dialog", { name: "Confirm payment" });
    await within(confirm).findByText(/Couldn.t verify what this payment returns/);
    expect(within(confirm).queryByText("You get at least")).toBeNull();
    fireEvent.click(within(confirm).getByRole("button", { name: "Pay" }));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(mocks.simulate).not.toHaveBeenCalled();
    expect(mocks.write).not.toHaveBeenCalled();
  });

  it("rebuilds a ready payment whose route moved to another terminal, and never sends the old one", async () => {
    const client = queryClient();
    render(
      <QueryClientProvider client={client}>
        <V6PayCard />
      </QueryClientProvider>,
    );
    fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "1" } });
    const pay = screen.getByRole("button", { name: "Pay" });
    await waitFor(() => expect(pay).toBeEnabled(), { timeout: 3_000 });
    fireEvent.click(pay);
    const confirm = await screen.findByRole("dialog", { name: "Confirm payment" });
    await within(confirm).findByText("You get at least");

    const moved = "0x6666666666666666666666666666666666666666";
    mocks.terminal = moved;
    await client.invalidateQueries({ queryKey: ["v6PayPreview"] });
    await within(confirm).findByText("The payment changed. Review it again.");
    await within(confirm).findByText("You get at least");
    fireEvent.click(within(confirm).getByRole("button", { name: "Pay" }));
    await waitFor(() => expect(mocks.write).toHaveBeenCalledTimes(1));
    expect(mocks.write.mock.calls[0]![0]).toMatchObject({ address: moved });
    expect(mocks.simulate).not.toHaveBeenCalledWith(
      expect.objectContaining({ address: "0x3333333333333333333333333333333333333333" }),
    );
  });

  it("rebuilds a ready item checkout when the cart changes, and never sends the old items", async () => {
    mocks.shop = SHOP;
    mocks.cart = cartOf(1);
    const client = queryClient();
    const view = render(
      <QueryClientProvider client={client}>
        <V6PayCard />
      </QueryClientProvider>,
    );
    const pay = screen.getByRole("button", { name: "Pay" });
    await waitFor(() => expect(pay).toBeEnabled(), { timeout: 3_000 });
    fireEvent.click(pay);
    const confirm = await screen.findByRole("dialog", { name: "Confirm payment" });
    await within(confirm).findByText("You get at least");

    mocks.cart = cartOf(2);
    view.rerender(
      <QueryClientProvider client={client}>
        <V6PayCard />
      </QueryClientProvider>,
    );
    await within(confirm).findByText("The payment changed. Review it again.");
    await within(confirm).findByText("2× Hat");
    fireEvent.click(within(confirm).getByRole("button", { name: "Pay" }));
    await waitFor(() => expect(mocks.write).toHaveBeenCalledTimes(1));
    const payment = mocks.write.mock.calls[0]![0] as { args: readonly unknown[] };
    // pay(projectId, token, amount, beneficiary, minReturnedTokens, memo, metadata)
    expect(payment.args[2]).toBe(2n * 10n ** 17n);
    expect(payment.args[6]).toBe("0x02");
  });

  it("labels the card's preview an estimate and shows the enforced minimum when they differ", async () => {
    mocks.minReturned = 5n * 10n ** 20n;
    render(
      <QueryClientProvider client={queryClient()}>
        <V6PayCard />
      </QueryClientProvider>,
    );
    fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "1" } });
    await screen.findByText("You get about", undefined, { timeout: 3_000 });
    expect(screen.getByText("1,000 REV")).toBeInTheDocument();
    expect(screen.getByText("At least 500 REV")).toBeInTheDocument();
  });

  it("says when the minimum is only the mint rate, and shows progress instead while the quote is read again", async () => {
    mocks.quoteFailed = true;
    render(
      <QueryClientProvider client={queryClient()}>
        <V6PayCard />
      </QueryClientProvider>,
    );
    expect(screen.queryByText(PAY_QUOTE_FAILED_MESSAGE, { exact: false })).toBeNull();
    fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "1" } });
    await screen.findByText(PAY_QUOTE_FAILED_MESSAGE, { exact: false }, { timeout: 3_000 });

    const gate = deferred<void>();
    mocks.routeGate = gate.promise;
    mocks.quoteFailed = false;
    const calls = mocks.routeCalls;
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await screen.findByText("Refreshing…");
    expect(mocks.routeCalls).toBeGreaterThan(calls);
    expect(screen.queryByText(PAY_QUOTE_FAILED_MESSAGE, { exact: false })).toBeNull();
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();

    gate.resolve();
    await waitFor(() => expect(screen.queryByText("Refreshing…")).toBeNull());
    expect(screen.queryByText(PAY_QUOTE_FAILED_MESSAGE, { exact: false })).toBeNull();
  });

  it("hides the failed-quote line as soon as the amount changes, until that amount's quote arrives", async () => {
    mocks.quoteFailed = true;
    render(
      <QueryClientProvider client={queryClient()}>
        <V6PayCard />
      </QueryClientProvider>,
    );
    fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "1" } });
    await screen.findByText(PAY_QUOTE_FAILED_MESSAGE, { exact: false }, { timeout: 3_000 });

    const gate = deferred<void>();
    mocks.routeGate = gate.promise;
    const calls = mocks.routeCalls;
    fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "2" } });
    // Gone while the new amount is debounced...
    expect(screen.queryByText(PAY_QUOTE_FAILED_MESSAGE, { exact: false })).toBeNull();
    // ...and while its quote loads behind the last amount's.
    await waitFor(() => expect(mocks.routeCalls).toBeGreaterThan(calls), { timeout: 3_000 });
    expect(screen.queryByText(PAY_QUOTE_FAILED_MESSAGE, { exact: false })).toBeNull();

    gate.resolve();
    await screen.findByText(PAY_QUOTE_FAILED_MESSAGE, { exact: false }, { timeout: 3_000 });
  });

  it("keeps the failed-quote line through a background refetch the payer did not ask for", async () => {
    mocks.quoteFailed = true;
    const client = queryClient();
    render(
      <QueryClientProvider client={client}>
        <V6PayCard />
      </QueryClientProvider>,
    );
    fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "1" } });
    await screen.findByText(PAY_QUOTE_FAILED_MESSAGE, { exact: false }, { timeout: 3_000 });

    const gate = deferred<void>();
    mocks.routeGate = gate.promise;
    const calls = mocks.routeCalls;
    void client.refetchQueries({ queryKey: ["v6PayPreview"] });
    await waitFor(() => expect(mocks.routeCalls).toBeGreaterThan(calls));
    expect(screen.getByText(PAY_QUOTE_FAILED_MESSAGE, { exact: false })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
    expect(screen.queryByText("Refreshing…")).toBeNull();
    gate.resolve();
  });

  it("discloses a failed quote found at submit in the review, bound to the minimum it signs, and not on the card once sent", async () => {
    render(
      <QueryClientProvider client={queryClient()}>
        <V6PayCard />
      </QueryClientProvider>,
    );
    fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "1" } });
    const pay = screen.getByRole("button", { name: "Pay" });
    await waitFor(() => expect(pay).toBeEnabled(), { timeout: 3_000 });
    expect(screen.queryByText(PAY_QUOTE_FAILED_MESSAGE, { exact: false })).toBeNull();

    // The card looked healthy; the quote read again at submit could not read the pool.
    mocks.quoteFailed = true;
    mocks.minReturned = 7n * 10n ** 20n;
    fireEvent.click(pay);
    const confirm = await screen.findByRole("dialog", { name: "Confirm payment" });
    await within(confirm).findByText(PAY_QUOTE_FAILED_MESSAGE);
    expect(within(confirm).getByText("700 REV")).toBeInTheDocument();
    // Said once, in the review, not again on the card behind it.
    expect(screen.getAllByText(PAY_QUOTE_FAILED_MESSAGE, { exact: false })).toHaveLength(1);

    // A failed attempt's error stands alone; the quote line does not come back beside it.
    mocks.simulate.mockRejectedValueOnce(new Error("Simulation failed"));
    fireEvent.click(within(confirm).getByRole("button", { name: "Pay" }));
    await waitFor(() => expect(confirm.querySelector(".text-red-600")).not.toBeNull());
    expect(within(confirm).queryByText(PAY_QUOTE_FAILED_MESSAGE)).toBeNull();

    fireEvent.click(within(confirm).getByRole("button", { name: "Pay" }));
    await waitFor(() => expect(mocks.write).toHaveBeenCalledTimes(1));
    const payment = mocks.write.mock.calls[0]![0] as { args: readonly unknown[] };
    expect(payment.args[4]).toBe(7n * 10n ** 20n);
    await within(confirm).findByText("Your payment went through.");
    expect(screen.queryByText(PAY_QUOTE_FAILED_MESSAGE, { exact: false })).toBeNull();
  });

  it("does not send a ready payment after its quote refresh fails", async () => {
    const client = queryClient();
    render(
      <QueryClientProvider client={client}>
        <V6PayCard />
      </QueryClientProvider>,
    );
    fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "1" } });
    const pay = screen.getByRole("button", { name: "Pay" });
    await waitFor(() => expect(pay).toBeEnabled(), { timeout: 3_000 });
    fireEvent.click(pay);
    const confirm = await screen.findByRole("dialog", { name: "Confirm payment" });
    await within(confirm).findByText("You get at least");

    mocks.routeError = new Error("buyback hookOf read failed");
    await client.invalidateQueries({ queryKey: ["v6PayPreview"] });
    fireEvent.click(within(confirm).getByRole("button", { name: "Pay" }));
    await within(confirm).findByText(/Couldn.t verify what this payment returns/);
    expect(mocks.write).not.toHaveBeenCalled();
  });

  it("stops a payment whose route moves to another terminal while it is being simulated", async () => {
    const simulation = deferred<{ request: object }>();
    mocks.simulate.mockReturnValueOnce(simulation.promise);
    const client = queryClient();
    render(
      <QueryClientProvider client={client}>
        <V6PayCard />
      </QueryClientProvider>,
    );
    fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "1" } });
    const pay = screen.getByRole("button", { name: "Pay" });
    await waitFor(() => expect(pay).toBeEnabled(), { timeout: 3_000 });
    fireEvent.click(pay);
    const confirm = await screen.findByRole("dialog", { name: "Confirm payment" });
    await within(confirm).findByText("You get at least");
    fireEvent.click(within(confirm).getByRole("button", { name: "Pay" }));
    await waitFor(() => expect(mocks.simulate).toHaveBeenCalledTimes(1));

    const moved = "0x6666666666666666666666666666666666666666";
    mocks.terminal = moved;
    await client.invalidateQueries({ queryKey: ["v6PayPreview"] });
    simulation.resolve({ request: {} });

    await within(confirm).findByText("The payment changed. Review it again.");
    expect(mocks.write).not.toHaveBeenCalled();
    await within(confirm).findByText("You get at least");
    fireEvent.click(within(confirm).getByRole("button", { name: "Pay" }));
    await waitFor(() => expect(mocks.write).toHaveBeenCalledTimes(1));
    expect(mocks.write.mock.calls[0]![0]).toMatchObject({ address: moved });
  });

  it("stops an ERC-20 item checkout whose cart changes while its approval is pending", async () => {
    mocks.erc20 = true;
    mocks.shop = SHOP;
    mocks.cart = cartOf(1);
    const approval = deferred<Hex>();
    mocks.ensureAllowance.mockReturnValueOnce(approval.promise);
    const client = queryClient();
    const view = render(
      <QueryClientProvider client={client}>
        <V6PayCard />
      </QueryClientProvider>,
    );
    const pay = screen.getByRole("button", { name: "Pay" });
    await waitFor(() => expect(pay).toBeEnabled(), { timeout: 3_000 });
    fireEvent.click(pay);
    const confirm = await screen.findByRole("dialog", { name: "Confirm payment" });
    await within(confirm).findByText("Approve TKN access");
    fireEvent.click(within(confirm).getByRole("button", { name: "Pay" }));
    await waitFor(() => expect(mocks.ensureAllowance).toHaveBeenCalledTimes(1));
    // The terminal being paid is the spender, for exactly the payment amount.
    expect(mocks.ensureAllowance.mock.calls[0]!.slice(0, 3)).toEqual([
      TKN,
      mocks.terminal,
      10n ** 17n,
    ]);

    mocks.cart = cartOf(2);
    view.rerender(
      <QueryClientProvider client={client}>
        <V6PayCard />
      </QueryClientProvider>,
    );
    approval.resolve(HASH);

    await within(confirm).findByText("The payment changed. Review it again.");
    expect(mocks.simulate).not.toHaveBeenCalled();
    expect(mocks.write).not.toHaveBeenCalled();
    await within(confirm).findByText("2× Hat");
    await within(confirm).findByText("You get at least");
    fireEvent.click(within(confirm).getByRole("button", { name: "Pay" }));
    await waitFor(() => expect(mocks.write).toHaveBeenCalledTimes(1));
    expect(mocks.ensureAllowance.mock.calls[1]!.slice(0, 3)).toEqual([
      TKN,
      mocks.terminal,
      2n * 10n ** 17n,
    ]);
    const payment = mocks.write.mock.calls[0]![0] as { args: readonly unknown[]; value: bigint };
    expect(payment.args[1]).toBe(TKN);
    expect(payment.args[2]).toBe(2n * 10n ** 17n);
    expect(payment.args[6]).toBe("0x02");
    expect(payment.value).toBe(0n);
  });

  it("says to check an identical payment's unconfirmed Safe proposal in Safe instead of reporting it proposed", async () => {
    // The identical payment's Safe proposal ended where the app can't confirm its result.
    mocks.write.mockRejectedValue(new SafeProposalPendingError(HASH, true));
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
    await within(confirm).findByText("You get at least");

    fireEvent.click(within(confirm).getByRole("button", { name: "Pay" }));

    await within(confirm).findByText("Check this proposal in your Safe before sending it again.");
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
    await within(confirm).findByText("You get at least");

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
        "Safe proposal is not executed : 1 of 2. It remains asynchronous; do not submit it again.",
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
    await within(confirm).findByText("You get at least");
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

  it("holds Pay when the wallet disconnects with the confirm open", async () => {
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
    await within(confirm).findByText("You get at least");

    // The confirm cannot connect a wallet, so without one its action stays shut.
    mocks.address = undefined;
    view.rerender(
      <QueryClientProvider client={client}>
        <V6PayCard />
      </QueryClientProvider>,
    );
    const confirmPay = within(confirm).getByRole("button", { name: "Pay" });
    expect(confirmPay).toBeDisabled();
    fireEvent.click(confirmPay);
    expect(mocks.simulate).not.toHaveBeenCalled();
    expect(mocks.write).not.toHaveBeenCalled();
  });
});

describe("the payment's intent", () => {
  it("is the project and beneficiary alone, so a checkout an emptied cart turned into a pay is the same intent", async () => {
    const { writeIntentOf } = await import("@/lib/write-hold");
    const { payIntent } = await import("@bananapus/nana-sdk-core/review");
    render(
      <QueryClientProvider client={queryClient()}>
        <V6PayCard />
      </QueryClientProvider>,
    );
    // The cart is empty (inventory emptied it): this is a pay.
    fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "1" } });
    const pay = screen.getByRole("button", { name: "Pay" });
    await waitFor(() => expect(pay).toBeEnabled(), { timeout: 3_000 });
    fireEvent.click(pay);
    const confirm = await screen.findByRole("dialog", { name: "Confirm payment" });
    await within(confirm).findByText("You get at least");
    fireEvent.click(within(confirm).getByRole("button", { name: "Pay" }));
    await waitFor(() => expect(mocks.write).toHaveBeenCalledTimes(1));

    // The checkout it was, with a lost reply, had the same intent.
    expect(writeIntentOf(mocks.write.mock.calls[0]![0])).toBe(
      payIntent({ chainId: 1, project: 7n, beneficiary: A }),
    );
  });
});
