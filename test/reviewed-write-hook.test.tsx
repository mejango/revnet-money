import { act, renderHook, waitFor } from "@testing-library/react";
import { parseAbi, type Address, type Hex } from "viem";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  config: { id: "test-config" },
  account: {
    address: "0x000000000000000000000000000000000000dEaD" as Address | undefined,
    chainId: 11155111 as number | undefined,
    connector: { id: "injected", name: "Injected" } as { id: string; name: string } | undefined,
  },
  getAccount: vi.fn(),
  simulateContract: vi.fn(),
  waitForTransactionReceipt: vi.fn(),
  submit: vi.fn(),
  wagmiReceipt: vi.fn(),
}));

vi.mock("@wagmi/core", () => ({
  getAccount: mocks.getAccount,
  simulateContract: mocks.simulateContract,
  waitForTransactionReceipt: mocks.waitForTransactionReceipt,
}));

vi.mock("wagmi", () => ({
  useConfig: () => mocks.config,
  useWaitForTransactionReceipt: mocks.wagmiReceipt,
  useWriteContract: () => ({
    data: undefined,
    error: null,
    isError: false,
    isIdle: true,
    isPending: false,
    isSuccess: false,
    reset: vi.fn(),
    status: "idle",
    variables: undefined,
    writeContract: vi.fn(),
    writeContractAsync: mocks.submit,
  }),
}));

const ACCOUNT = "0x000000000000000000000000000000000000dEaD" as Address;
const OTHER_ACCOUNT = "0x000000000000000000000000000000000000bEEF" as Address;
const TARGET = "0x0000000000000000000000000000000000001000" as Address;
const RECIPIENT = "0x0000000000000000000000000000000000002000" as Address;
const HASH = `0x${"12".repeat(32)}` as Hex;
const ABI = parseAbi(["function transfer(address recipient, uint256 amount)"]);
const CALL = {
  chainId: 11155111,
  address: TARGET,
  abi: ABI,
  functionName: "transfer",
  args: [RECIPIENT, 7n] as const,
};

async function freshHarness() {
  vi.resetModules();
  const [review, activity, hooks] = await Promise.all([
    import("@/lib/transaction-review"),
    import("@/lib/transaction-activity"),
    import("@/hooks/useReviewedWriteContract"),
  ]);
  return { review, activity, hooks };
}

beforeEach(() => {
  window.localStorage.clear();
  mocks.account = {
    address: ACCOUNT,
    chainId: 11155111,
    connector: { id: "injected", name: "Injected" },
  };
  mocks.getAccount.mockImplementation(() => mocks.account);
  mocks.simulateContract.mockImplementation(async (_config, request) => ({ request }));
  mocks.submit.mockResolvedValue(HASH);
  mocks.waitForTransactionReceipt.mockImplementation(() => new Promise(() => undefined));
  mocks.wagmiReceipt.mockReturnValue({
    data: undefined,
    error: null,
    isError: false,
    isLoading: false,
    isSuccess: false,
  });
});

describe("reviewed write hook", () => {
  it("reviews, rechecks the account, simulates, submits the simulated request, and tracks success", async () => {
    const order: string[] = [];
    const { review, activity, hooks } = await freshHarness();
    review.registerTransactionReviewHandler(async (request) => {
      order.push("review");
      expect(request.calls[0]).toMatchObject({
        chainId: 11155111,
        from: ACCOUNT,
        to: TARGET,
        functionName: "transfer",
        args: [RECIPIENT, 7n],
      });
      return true;
    });
    mocks.simulateContract.mockImplementation(async (_config, request) => {
      order.push("simulate");
      return { request: { ...request, gas: 45_000n } };
    });
    mocks.submit.mockImplementation(async (request) => {
      order.push("submit");
      expect(request).toMatchObject({
        address: TARGET,
        account: ACCOUNT,
        gas: 45_000n,
      });
      return HASH;
    });
    mocks.waitForTransactionReceipt.mockResolvedValue({ status: "success" });

    const { result } = renderHook(() => hooks.useWriteContract());
    let hash: Hex | undefined;
    await act(async () => {
      hash = await result.current.writeContractAsync(CALL as never);
    });

    expect(hash).toBe(HASH);
    expect(order).toEqual(["review", "simulate", "submit"]);
    await waitFor(() =>
      expect(activity.transactionActivityForHash(HASH)).toMatchObject({
        kind: "direct",
        status: "success",
        account: ACCOUNT,
      }),
    );
  });

  it("stops before simulation when the connected account changes during review", async () => {
    const { review, hooks } = await freshHarness();
    review.registerTransactionReviewHandler(async () => {
      mocks.account = { ...mocks.account, address: OTHER_ACCOUNT };
      return true;
    });
    const { result } = renderHook(() => hooks.useWriteContract());

    await expect(result.current.writeContractAsync(CALL as never)).rejects.toThrow(
      "Connected account changed",
    );
    expect(mocks.simulateContract).not.toHaveBeenCalled();
    expect(mocks.submit).not.toHaveBeenCalled();
  });

  it("stops before submission when the account changes while simulating", async () => {
    const { review, hooks } = await freshHarness();
    review.registerTransactionReviewHandler(async () => true);
    mocks.simulateContract.mockImplementation(async (_config, request) => {
      mocks.account = { ...mocks.account, address: OTHER_ACCOUNT };
      return { request };
    });
    const { result } = renderHook(() => hooks.useWriteContract());

    await expect(result.current.writeContractAsync(CALL as never)).rejects.toThrow(
      "Connected account changed",
    );
    expect(mocks.submit).not.toHaveBeenCalled();
  });

  it("deduplicates identical pending direct writes before opening another review", async () => {
    const { review, hooks } = await freshHarness();
    const reviewer = vi.fn().mockResolvedValue(true);
    review.registerTransactionReviewHandler(reviewer);
    const { result } = renderHook(() => hooks.useWriteContract());

    await act(async () => {
      await result.current.writeContractAsync(CALL as never);
    });
    await expect(result.current.writeContractAsync(CALL as never)).rejects.toThrow(
      /already pending/i,
    );
    expect(reviewer).toHaveBeenCalledOnce();
    expect(mocks.simulateContract).toHaveBeenCalledOnce();
    expect(mocks.submit).toHaveBeenCalledOnce();
  });

  it("records Safe proposal hashes as asynchronous and blocks duplicate execution", async () => {
    mocks.account = {
      address: ACCOUNT,
      chainId: 11155111,
      connector: { id: "safe", name: "Safe" },
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise(() => undefined)),
    );
    const { review, activity, hooks } = await freshHarness();
    review.registerTransactionReviewHandler(async (request) => {
      expect(request.confirmLabel).toMatch(/propose to Safe/i);
      return true;
    });
    const { result } = renderHook(() => hooks.useWriteContract());

    await act(async () => {
      await result.current.writeContractAsync(CALL as never);
    });
    expect(activity.transactionActivityForHash(HASH)).toMatchObject({
      kind: "safe",
      status: "safe-proposed",
      safeProposalHash: HASH,
    });
    await expect(result.current.writeContractAsync(CALL as never)).rejects.toBeInstanceOf(
      hooks.SafeProposalPendingError,
    );
    expect(mocks.waitForTransactionReceipt).not.toHaveBeenCalled();
  });

  it("fails closed before review when no wallet account or chain is available", async () => {
    const { hooks } = await freshHarness();
    const { result } = renderHook(() => hooks.useWriteContract());
    mocks.account = { address: undefined, chainId: undefined, connector: undefined };

    await expect(result.current.writeContractAsync(CALL as never)).rejects.toThrow(
      "Connect a wallet first",
    );
    expect(mocks.simulateContract).not.toHaveBeenCalled();
    expect(mocks.submit).not.toHaveBeenCalled();
  });
});
