import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import type { Address, Hex } from "viem";
import { beforeEach, describe, expect, it, vi } from "vitest";

// The reviewed receipt watcher, on wagmi's: which chain it watches, and what
// it reports when the watch ends without a receipt.

const mocks = vi.hoisted(() => ({ wagmiReceipt: vi.fn() }));

vi.mock("wagmi", () => ({
  useConfig: () => ({}),
  useWaitForTransactionReceipt: mocks.wagmiReceipt,
  useWriteContract: () => ({}),
}));
vi.mock("wagmi/actions", () => ({
  getAccount: () => ({}),
  getPublicClient: () => undefined,
  simulateContract: vi.fn(),
  switchChain: vi.fn(),
  watchAccount: () => () => undefined,
}));

const ACCOUNT = "0x000000000000000000000000000000000000dEaD" as Address;
const HASH = `0x${"12".repeat(32)}` as Hex;

async function freshModules() {
  vi.resetModules();
  const [activity, hooks, query] = await Promise.all([
    import("@/lib/transaction-activity"),
    import("@/hooks/useReviewedWriteContract"),
    import("@tanstack/react-query"),
  ]);
  return { activity, hooks, query };
}

/** A direct send on Ethereum that its own tracker is still waiting on. */
function trackOnEthereum(activity: Awaited<ReturnType<typeof freshModules>>["activity"]) {
  activity.recordTransactionActivity({
    id: `tx:1:${HASH}`,
    kind: "direct",
    title: "Remove liquidity",
    status: "pending",
    message: "Pending onchain confirmation.",
    chainId: 1,
    account: ACCOUNT,
    hash: HASH,
  });
}

const watching = {
  data: undefined,
  error: null,
  isError: false,
  isLoading: true,
  isSuccess: false,
};

beforeEach(() => {
  window.localStorage.clear();
  mocks.wagmiReceipt.mockReset().mockReturnValue(watching);
});

describe("the receipt watcher", () => {
  it("watches a send on the chain it went to, whichever chain the caller names after", async () => {
    const { activity, hooks } = await freshModules();
    trackOnEthereum(activity);

    // The form moved to Optimism while the send was confirming.
    const { rerender } = renderHook(
      ({ chainId }) => hooks.useWaitForTransactionReceipt({ hash: HASH, chainId }),
      { initialProps: { chainId: 1 } },
    );
    rerender({ chainId: 10 });

    expect(mocks.wagmiReceipt).toHaveBeenLastCalledWith(
      expect.objectContaining({ hash: HASH, chainId: 1 }),
    );
  });

  it("watches an untracked hash on the chain the caller names", async () => {
    const { hooks } = await freshModules();

    renderHook(() => hooks.useWaitForTransactionReceipt({ hash: HASH, chainId: 10 }));

    expect(mocks.wagmiReceipt).toHaveBeenLastCalledWith(
      expect.objectContaining({ hash: HASH, chainId: 10 }),
    );
  });

  it("reports a watch that ended with no receipt and no tracked outcome as unconfirmed", async () => {
    const { activity, hooks } = await freshModules();
    trackOnEthereum(activity);
    mocks.wagmiReceipt.mockReturnValue({
      data: undefined,
      error: Object.assign(new Error("Timed out while waiting for transaction."), {
        name: "WaitForTransactionReceiptTimeoutError",
      }),
      isError: true,
      isLoading: false,
      isSuccess: false,
    });

    const { result } = renderHook(() =>
      hooks.useWaitForTransactionReceipt({ hash: HASH, chainId: 1, timeout: 120_000 }),
    );

    expect(result.current).toMatchObject({
      isLoading: false,
      isSuccess: false,
      isError: false,
      isUnconfirmed: true,
    });
  });

  it("is not unconfirmed while it watches, or once the tracker has an outcome", async () => {
    const { activity, hooks } = await freshModules();
    trackOnEthereum(activity);
    const { result, rerender } = renderHook(() =>
      hooks.useWaitForTransactionReceipt({ hash: HASH, chainId: 1 }),
    );
    expect(result.current.isUnconfirmed).toBe(false);

    mocks.wagmiReceipt.mockReturnValue({ ...watching, isError: true, isLoading: false });
    activity.updateTransactionActivity(`tx:1:${HASH}`, {
      status: "failed",
      message: "The transaction was mined but reverted.",
    });
    rerender();

    expect(result.current).toMatchObject({ isError: true, isUnconfirmed: false });
  });

  describe("keeps a Safe proposal's unconfirmed result apart from a direct send's", () => {
    // Every watch here ends at its timeout with no receipt: only the row's kind decides.
    beforeEach(() => {
      mocks.wagmiReceipt.mockReturnValue({
        data: undefined,
        error: Object.assign(new Error("Timed out while waiting for transaction."), {
          name: "WaitForTransactionReceiptTimeoutError",
        }),
        isError: true,
        isLoading: false,
        isSuccess: false,
      });
    });

    it("a Safe proposal whose result can't be confirmed", async () => {
      const { activity, hooks } = await freshModules();
      activity.recordTransactionActivity({
        id: `tx:1:${HASH}`,
        kind: "safe",
        title: "Remove liquidity",
        status: "safe-proposed",
        message:
          "This Safe transaction's result can't be confirmed here. Check it in Safe before retrying.",
        chainId: 1,
        account: ACCOUNT,
        hash: HASH,
        safeProposalHash: HASH,
        safeResultUnconfirmed: true,
      });

      const { result } = renderHook(() =>
        hooks.useWaitForTransactionReceipt({ hash: HASH, chainId: 1, timeout: 120_000 }),
      );

      expect(result.current).toMatchObject({ isSafeResultUnconfirmed: true, isUnconfirmed: false });
    });

    it("a direct send whose watch ended with no receipt", async () => {
      const { activity, hooks } = await freshModules();
      activity.recordTransactionActivity({
        id: `tx:1:${HASH}`,
        kind: "direct",
        title: "Remove liquidity",
        status: "pending",
        message: "Pending onchain confirmation.",
        chainId: 1,
        account: ACCOUNT,
        hash: HASH,
        // A Safe proposal's flag on a direct row counts for nothing.
        safeResultUnconfirmed: true,
      });

      const { result } = renderHook(() =>
        hooks.useWaitForTransactionReceipt({ hash: HASH, chainId: 1, timeout: 120_000 }),
      );

      expect(result.current).toMatchObject({ isUnconfirmed: true, isSafeResultUnconfirmed: false });
    });
  });

  it("ends a bounded watch at its first timeout, without the app's retry", async () => {
    const { activity, hooks, query } = await freshModules();
    trackOnEthereum(activity);
    const wait = vi.fn(async () => {
      throw Object.assign(new Error("Timed out while waiting for transaction."), {
        name: "WaitForTransactionReceiptTimeoutError",
      });
    });
    // Wagmi's watch is a query of the receipt wait, with the options its caller gives.
    mocks.wagmiReceipt.mockImplementation((parameters: { hash?: Hex; query?: object }) =>
      query.useQuery({
        queryKey: ["receipt", parameters.hash],
        queryFn: wait,
        ...parameters.query,
      }),
    );
    // The app's query defaults retry a failed query once.
    const client = new query.QueryClient({
      defaultOptions: { queries: { retry: 1, retryDelay: 0 } },
    });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <query.QueryClientProvider client={client}>{children}</query.QueryClientProvider>
    );

    const { result } = renderHook(
      () => hooks.useWaitForTransactionReceipt({ hash: HASH, chainId: 1, timeout: 120_000 }),
      { wrapper },
    );

    await waitFor(() => expect(result.current.isUnconfirmed).toBe(true));
    expect(wait).toHaveBeenCalledOnce();
  });
});
