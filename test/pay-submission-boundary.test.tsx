import { V6PayCard } from "@/app/[slug]/components/v6/pay/V6PayCard";
import { registerReviewHandler, type ReviewPrompt } from "@bananapus/nana-sdk-core/review";
import {
  resetSafeRelayrForTests,
  resetWriteHoldsForTests,
  resetWriteRecoveryForTests,
} from "@bananapus/nana-sdk-core/testing";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import type { Address, Hex } from "viem";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The pay card through the REAL reviewed send (useReviewedAction over core): its transaction review
// and its final simulation both wait, and a payment whose route moves or whose quote stops verifying during
// either wait must never reach the wallet.

const ACCOUNT = "0x1111111111111111111111111111111111111111" as Address;
const FIRST = "0x3333333333333333333333333333333333333333" as Address;
const MOVED = "0x6666666666666666666666666666666666666666" as Address;
const HASH = `0x${"ab".repeat(32)}` as Hex;

const mocks = vi.hoisted(() => ({
  config: { id: "pay-boundary-config", chains: [{ id: 1, name: "Ethereum" }] },
  account: {
    address: "0x1111111111111111111111111111111111111111",
    chainId: 1,
    connector: { id: "injected", name: "Injected" },
  },
  terminal: "0x3333333333333333333333333333333333333333",
  routeError: null as Error | null,
  // Core's simulation before the wallet (an eth_call), and the wallet's send.
  hookSimulate: vi.fn(),
  submit: vi.fn(),
}));

function client() {
  return {
    chain: { id: 1 },
    getChainId: async () => 1,
    readContract: async () => 0n,
    request: async ({ method, params }: { method: string; params: unknown[] }) => {
      if (method === "eth_call") {
        await mocks.hookSimulate(params[0]);
        return "0x";
      }
      throw new Error(`Unexpected ${method}`);
    },
    estimateGas: async () => 50_000n,
    estimateContractGas: async () => 50_000n,
    getBlockNumber: async () => 100n,
    getBlock: async () => ({ number: 100n, hash: `0x${"bb".repeat(32)}` }),
    getTransactionCount: async () => 3,
    getCode: async () => undefined,
    getTransaction: async () => {
      throw new Error("Transaction not found");
    },
    getTransactionReceipt: async () => {
      throw new Error("Receipt not found");
    },
    waitForTransactionReceipt: () => new Promise(() => undefined),
  };
}
const CLIENT = client();

vi.mock("wagmi/actions", () => ({
  getAccount: () => mocks.account,
  getPublicClient: () => CLIENT,
  getWalletClient: async () => ({
    account: { address: mocks.account.address, type: "json-rpc" },
    chain: { id: 1 },
    sendTransaction: mocks.submit,
  }),
  switchChain: async () => undefined,
  watchAccount: () => () => undefined,
}));
vi.mock("wagmi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("wagmi")>()),
  useConfig: () => mocks.config,
  useAccount: () => ({ address: mocks.account.address, isConnected: true }),
  usePublicClient: () => CLIENT,
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
vi.mock("@/hooks/useTokenBalances", () => ({
  useTokenBalances: () => ({
    balances: new Map([["0x000000000000000000000000000000000000EEEe", 10n ** 20n]]),
    isLoading: false,
  }),
}));
vi.mock("@/lib/nana/project", () => ({
  useJBTokenContext: () => ({ token: { data: { symbol: "REV", decimals: 18 } } }),
}));
vi.mock("@/lib/nana/suckers", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/nana/suckers")>()),
  useSuckers: () => ({ data: [], verifiedPairs: [{ peerChainId: 1, projectId: 7n }] }),
}));
vi.mock("@/lib/paymentTerminal", () => ({
  resolveBestV6PayRoute: async () => {
    if (mocks.routeError) throw mocks.routeError;
    return {
      address: mocks.terminal,
      type: "multi",
      preview: { beneficiaryTokenCount: 10n ** 21n, reservedTokenCount: 0n },
      metadata: "0x5150",
      minReturnedTokens: 99n * 10n ** 19n,
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
  useShopCart: () => ({ items: [], remove: vi.fn(), setQuantity: vi.fn() }),
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

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

beforeEach(() => {
  window.localStorage.clear();
  Object.defineProperty(navigator, "locks", { configurable: true, value: undefined });
  mocks.terminal = FIRST;
  mocks.routeError = null;
  mocks.hookSimulate.mockReset().mockResolvedValue(undefined);
  mocks.submit.mockReset().mockResolvedValue(HASH);
  registerReviewHandler(async (prompt) => prompt.confirmation);
});

afterEach(() => {
  cleanup();
  resetWriteHoldsForTests();
  resetWriteRecoveryForTests();
  resetSafeRelayrForTests();
});

/** Open the card's confirm on a ready 1 ETH payment, then press its Pay. */
async function sendFromReadyConfirm(queryClient: QueryClient) {
  render(
    <QueryClientProvider client={queryClient}>
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
  return confirm;
}

/** The route moves to another terminal, or its quote stops verifying, and the card hears of it. */
async function drift(queryClient: QueryClient, kind: "terminal" | "failed refresh") {
  if (kind === "terminal") mocks.terminal = MOVED;
  else mocks.routeError = new Error("buyback hookOf read failed");
  await queryClient.invalidateQueries({ queryKey: ["v6PayPreview"] });
  // Let the card render what the refresh returned.
  await new Promise((resolve) => setTimeout(resolve, 50));
}

describe("the pay card at the real reviewed send's submission boundary", () => {
  for (const kind of ["terminal", "failed refresh"] as const) {
    it(`sends nothing when the route drifts (${kind}) while the payment is under review`, async () => {
      const review = deferred<void>();
      const reviewed = vi.fn(async (prompt: ReviewPrompt) => {
        await review.promise;
        return prompt.confirmation;
      });
      registerReviewHandler(reviewed);
      const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      const confirm = await sendFromReadyConfirm(queryClient);
      await waitFor(() => expect(reviewed).toHaveBeenCalledTimes(1));

      await drift(queryClient, kind);
      review.resolve();

      await within(confirm).findByText(
        kind === "terminal"
          ? "The payment changed. Review it again."
          : /Couldn.t verify what this payment returns/,
      );
      expect(mocks.submit).not.toHaveBeenCalled();
    });

    it(`sends nothing when the route drifts (${kind}) during the simulation before the wallet`, async () => {
      const simulation = deferred<void>();
      // The review's own simulation, then the one before the wallet.
      mocks.hookSimulate.mockResolvedValueOnce(undefined).mockImplementationOnce(async () => {
        await simulation.promise;
      });
      const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      const confirm = await sendFromReadyConfirm(queryClient);
      await waitFor(() => expect(mocks.hookSimulate).toHaveBeenCalledTimes(2));

      await drift(queryClient, kind);
      simulation.resolve();

      await within(confirm).findByText(
        kind === "terminal"
          ? "The payment changed. Review it again."
          : /Couldn.t verify what this payment returns/,
      );
      expect(mocks.submit).not.toHaveBeenCalled();
    });
  }

  it("sends a payment whose route held through review and simulation", async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    await sendFromReadyConfirm(queryClient);
    await waitFor(() => expect(mocks.submit).toHaveBeenCalledTimes(1));
    const sent = mocks.submit.mock.calls[0]![0] as {
      to: Address;
      account: Address | { address: Address };
    };
    expect(sent.to).toBe(FIRST);
    expect(typeof sent.account === "string" ? sent.account : sent.account.address).toBe(ACCOUNT);
  });
});
