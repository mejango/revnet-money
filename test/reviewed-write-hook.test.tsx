import {
  SAFE_EXEC_ABI,
  safeProposalFor,
  safeTransactionHash,
  type SafeQueuedTransaction,
} from "@bananapus/nana-sdk-core/safe-service";
import { act, renderHook, waitFor } from "@testing-library/react";
import {
  encodeFunctionData,
  HttpRequestError,
  parseAbi,
  TransactionNotFoundError,
  zeroAddress,
  type Address,
  type Hex,
} from "viem";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { executionLog, SAFE_OWNER_A, safeChain } from "./fixtures/safe-chain";

const mocks = vi.hoisted(() => ({
  config: { id: "test-config", chains: [{ id: 8453, name: "Base" }] },
  queryClient: { id: "test-query-client" },
  account: {
    address: "0x000000000000000000000000000000000000dEaD" as Address | undefined,
    chainId: 11155111 as number | undefined,
    connector: { id: "injected", name: "Injected" } as
      { id: string; name: string; getProvider?: () => Promise<unknown> } | undefined,
  },
  getAccount: vi.fn(),
  switchChain: vi.fn(),
  estimateContractGas: vi.fn(),
  simulateContract: vi.fn(),
  waitForTransactionReceipt: vi.fn(),
  getTransactionReceipt: vi.fn(),
  getTransaction: vi.fn(),
  submit: vi.fn(),
  wagmiReceipt: vi.fn(),
  // The connected Safe's own reads: its owners and threshold.
  safeReads: undefined as unknown as ReturnType<typeof import("./fixtures/safe-chain").safeChain>,
}));

vi.mock("wagmi/actions", () => ({
  getAccount: mocks.getAccount,
  getPublicClient: () => ({
    chain: { id: 11155111 },
    estimateContractGas: mocks.estimateContractGas,
    waitForTransactionReceipt: mocks.waitForTransactionReceipt,
    getTransactionReceipt: mocks.getTransactionReceipt,
    getTransaction: mocks.getTransaction,
    getCode: (args: never) => mocks.safeReads.getCode(args),
    getStorageAt: (args: never) => mocks.safeReads.getStorageAt(args),
    request: (args: never) => mocks.safeReads.request(args),
  }),
  simulateContract: mocks.simulateContract,
  switchChain: mocks.switchChain,
  watchAccount: () => () => undefined,
}));

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => mocks.queryClient,
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

/** The call this app proposed to the connected Safe, and its Safe transaction hash. */
const PROPOSED = safeProposalFor({ to: TARGET, data: "0x1234" }, 7);
const PROPOSAL = safeTransactionHash(11155111, ACCOUNT, PROPOSED);
const OTHER_PROPOSAL = `0x${"56".repeat(32)}` as Hex;
const UNCONFIRMED =
  "This Safe transaction's result can't be confirmed here. Check it in Safe before retrying.";
const SIGNATURE = `0x${"12".repeat(64)}1b` as Hex;

/**
 * A Safe proposal the tracker resumes after a reload, journaled with the call it was reviewed to
 * run, or with none (`reviewed` null), and made at `createdAt`.
 */
function savedProposal(
  activity: typeof import("@/lib/transaction-activity"),
  hash: Hex,
  chainId: number,
  reviewed: { to: Address; data: Hex } | null = { to: TARGET, data: "0x1234" },
  createdAt?: number,
) {
  activity.recordTransactionActivity({
    id: `tx:${chainId}:${hash}`,
    kind: "safe",
    title: "transfer",
    status: "safe-proposed",
    message: "Submitted to Safe.",
    chainId,
    account: ACCOUNT,
    hash,
    safeProposalHash: hash,
    ...(reviewed
      ? { safeProposal: { safe: ACCOUNT, calls: [{ ...reviewed, value: "0" }], batch: false } }
      : {}),
    createdAt,
  });
}

const HOUR = 60 * 60_000;
/** The raw call that reads a Safe's nonce. */
const NONCE_CALL = encodeFunctionData({
  abi: parseAbi(["function nonce() view returns (uint256)"]),
  functionName: "nonce",
});

/** The Safe's own transaction running `call`, as the chain returns it for an execution sent at once. */
function executionOf(call: { to: Address; data: Hex }, safe: Address = ACCOUNT) {
  return {
    hash: HASH,
    to: safe,
    input: encodeFunctionData({
      abi: SAFE_EXEC_ABI,
      functionName: "execTransaction",
      args: [call.to, 0n, call.data, 0, 0n, 0n, 0n, zeroAddress, zeroAddress, "0x"],
    }),
  };
}
const TRANSFER_7 = {
  to: TARGET,
  data: encodeFunctionData({ abi: ABI, functionName: "transfer", args: [RECIPIENT, 7n] }),
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
  Object.defineProperty(navigator, "locks", { configurable: true, value: undefined });
  mocks.account = {
    address: ACCOUNT,
    chainId: 11155111,
    connector: { id: "injected", name: "Injected" },
  };
  mocks.getAccount.mockImplementation(() => mocks.account);
  mocks.simulateContract.mockImplementation(async (_config, request) => ({ request }));
  mocks.estimateContractGas.mockResolvedValue(50_000n);
  mocks.submit.mockResolvedValue(HASH);
  mocks.switchChain.mockResolvedValue(undefined);
  mocks.waitForTransactionReceipt.mockImplementation(() => new Promise(() => undefined));
  mocks.getTransactionReceipt.mockRejectedValue(new Error("Receipt not found"));
  // A Safe proposal hash is never a transaction the chain knows.
  mocks.getTransaction.mockRejectedValue(new TransactionNotFoundError({ hash: HASH }));
  mocks.safeReads = safeChain(ACCOUNT);
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
        gas: 100_000n,
      });
      return HASH;
    });
    mocks.waitForTransactionReceipt.mockResolvedValue({ status: "success" });

    const reverify = vi.fn(async (variables, account) => {
      order.push("reverify");
      expect(variables).toBe(CALL);
      expect(account).toBe(ACCOUNT);
    });
    const { result } = renderHook(() => hooks.useWriteContract({ reverify }));
    let hash: Hex | undefined;
    await act(async () => {
      hash = await result.current.writeContractAsync(CALL as never);
    });

    expect(hash).toBe(HASH);
    expect(order).toEqual(["review", "reverify", "simulate", "submit"]);
    expect(reverify).toHaveBeenCalledOnce();
    await waitFor(() =>
      expect(activity.transactionActivityForHash(HASH)).toMatchObject({
        kind: "direct",
        status: "success",
        account: ACCOUNT,
      }),
    );
  });

  it("switches a wallet parked on another chain to the call's chain before submitting", async () => {
    const { review, hooks } = await freshHarness();
    review.registerTransactionReviewHandler(async () => true);
    mocks.account = { ...mocks.account, chainId: 1 };

    const { result } = renderHook(() => hooks.useWriteContract());
    await act(async () => {
      await result.current.writeContractAsync(CALL as never);
    });

    expect(mocks.switchChain).toHaveBeenCalledWith(mocks.config, { chainId: 11155111 });
    expect(mocks.submit).toHaveBeenCalledOnce();
  });

  it("names the target chain when the wallet refuses to switch", async () => {
    const { review, hooks } = await freshHarness();
    review.registerTransactionReviewHandler(async () => true);
    mocks.account = { ...mocks.account, chainId: 1 };
    mocks.switchChain.mockRejectedValue(new Error("User rejected"));

    const { result } = renderHook(() => hooks.useWriteContract());
    await expect(
      act(async () => {
        await result.current.writeContractAsync({ ...CALL, chainId: 8453 } as never);
      }),
    ).rejects.toThrow("Switch your wallet to Base to continue.");
    expect(mocks.submit).not.toHaveBeenCalled();
  });

  it("defers generic receipt success until an action-specific verifier releases it", async () => {
    const { review, activity, hooks } = await freshHarness();
    review.registerTransactionReviewHandler(async () => true);
    mocks.waitForTransactionReceipt.mockResolvedValue({ status: "success" });
    const manualReceiptVerification = vi.fn().mockReturnValue(true);
    const { result } = renderHook(() => hooks.useWriteContract({ manualReceiptVerification }));

    await act(async () => {
      await result.current.writeContractAsync(CALL as never);
    });
    await waitFor(() =>
      expect(activity.transactionActivityForHash(HASH)).toMatchObject({
        status: "pending",
        manualVerificationRequired: true,
      }),
    );
    expect(mocks.waitForTransactionReceipt).not.toHaveBeenCalled();

    activity.failTransactionActivityVerification(HASH, "Exact postcondition failed.");
    expect(activity.transactionActivityForHash(HASH)).toMatchObject({
      status: "failed",
      manualVerificationRequired: true,
      message: "Exact postcondition failed.",
    });
    await expect(result.current.writeContractAsync(CALL as never)).rejects.toThrow(
      "already pending",
    );

    activity.releaseTransactionActivityVerification(HASH, "Exact postcondition confirmed.");
    expect(activity.transactionActivityForHash(HASH)).toMatchObject({
      status: "success",
      manualVerificationRequired: false,
      message: "Exact postcondition confirmed.",
    });
    expect(manualReceiptVerification).toHaveBeenCalledWith(CALL);
  });

  it("rejects a manual-verification write through a Safe connector before submission", async () => {
    mocks.account = {
      address: ACCOUNT,
      chainId: 11155111,
      connector: { id: "safe", name: "Safe" },
    };
    const { activity, hooks } = await freshHarness();
    const { result } = renderHook(() =>
      hooks.useWriteContract({
        reviewedInParent: true,
        manualReceiptVerification: () => true,
      }),
    );

    await expect(result.current.writeContractAsync(CALL as never)).rejects.toThrow(
      "cannot be proposed through a Safe connector",
    );
    expect(mocks.submit).not.toHaveBeenCalled();
    expect(activity.transactionActivityForHash(HASH)).toBeUndefined();
  });

  it("skips only the duplicate app review when a parent already showed the exact call", async () => {
    const { hooks } = await freshHarness();
    const reverify = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() =>
      hooks.useWriteContract({ reviewedInParent: true, reverify }),
    );

    await act(async () => {
      await result.current.writeContractAsync(CALL as never);
    });

    expect(reverify).toHaveBeenCalledOnce();
    expect(mocks.simulateContract).toHaveBeenCalledOnce();
    expect(mocks.submit).toHaveBeenCalledOnce();
  });

  it("supports a raw preflight without running Viem's CCIP-aware simulation", async () => {
    const { review, hooks } = await freshHarness();
    review.registerTransactionReviewHandler(async () => true);
    const preflightSimulation = vi.fn().mockResolvedValue({ gas: 500_000n });
    const { result } = renderHook(() => hooks.useWriteContract({ preflightSimulation }));

    await act(async () => {
      await result.current.writeContractAsync(CALL as never);
    });

    expect(preflightSimulation).toHaveBeenCalledWith(CALL, ACCOUNT);
    expect(mocks.simulateContract).not.toHaveBeenCalled();
    expect(mocks.estimateContractGas).not.toHaveBeenCalled();
    expect(mocks.submit).toHaveBeenCalledWith(expect.objectContaining({ gas: 500_000n }));
    expect(mocks.submit).toHaveBeenCalledOnce();
  });

  it("keeps a Safe raw preflight bounded while signing a zero Safe gas envelope", async () => {
    mocks.account = {
      address: ACCOUNT,
      chainId: 11155111,
      connector: { id: "safe", name: "Safe" },
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise(() => undefined)),
    );
    const { review, hooks } = await freshHarness();
    review.registerTransactionReviewHandler(async (request) => {
      expect(request.calls[0].safeTxGas).toBe(0n);
      expect(request.calls[0].gas).toBeUndefined();
      return true;
    });
    const preflightSimulation = vi.fn().mockResolvedValue({ gas: 500_000n });
    const { result } = renderHook(() => hooks.useWriteContract({ preflightSimulation }));
    const call = { ...CALL, gas: 500_000n };

    await act(async () => {
      await result.current.writeContractAsync(call as never);
    });

    expect(preflightSimulation).toHaveBeenCalledWith(call, ACCOUNT);
    expect(mocks.estimateContractGas).not.toHaveBeenCalled();
    expect(mocks.submit).toHaveBeenCalledWith(expect.objectContaining({ gas: 0n }));
  });

  it("reviews the fixed gas limit a raw preflight sends", async () => {
    const { review, hooks } = await freshHarness();
    let reviewedGas: bigint | undefined;
    review.registerTransactionReviewHandler(async (request) => {
      reviewedGas = request.calls[0].gas;
      return true;
    });
    const preflightSimulation = vi.fn().mockResolvedValue({ gas: 500_000n });
    const { result } = renderHook(() => hooks.useWriteContract({ preflightSimulation }));

    await act(async () => {
      await result.current.writeContractAsync({ ...CALL, gas: 500_000n } as never);
    });

    expect(reviewedGas).toBe(500_000n);
    expect(mocks.submit).toHaveBeenCalledWith(expect.objectContaining({ gas: reviewedGas }));
  });

  it("sends nothing when a preflight's gas differs from the reviewed gas limit", async () => {
    const { review, hooks } = await freshHarness();
    review.registerTransactionReviewHandler(async () => true);
    const preflightSimulation = vi.fn().mockResolvedValue({ gas: 600_000n });
    const { result } = renderHook(() => hooks.useWriteContract({ preflightSimulation }));

    await expect(
      result.current.writeContractAsync({ ...CALL, gas: 500_000n } as never),
    ).rejects.toThrow("The gas limit changed after review");
    expect(mocks.submit).not.toHaveBeenCalled();
  });

  it("fails closed before simulation when reviewed state changes", async () => {
    const { review, hooks } = await freshHarness();
    review.registerTransactionReviewHandler(async () => true);
    const reverify = vi.fn().mockRejectedValue(new Error("The project controller changed."));
    const { result } = renderHook(() => hooks.useWriteContract({ reverify }));

    await expect(result.current.writeContractAsync(CALL as never)).rejects.toThrow(
      "controller changed",
    );
    expect(mocks.simulateContract).not.toHaveBeenCalled();
    expect(mocks.submit).not.toHaveBeenCalled();
  });

  it("preserves Wagmi 3 per-call mutation callback context", async () => {
    const { review, hooks } = await freshHarness();
    review.registerTransactionReviewHandler(async () => true);
    const onSuccess = vi.fn();
    const onSettled = vi.fn();
    const { result } = renderHook(() => hooks.useWriteContract());

    act(() => {
      result.current.writeContract(CALL as never, { onSuccess, onSettled });
    });

    await waitFor(() => expect(onSettled).toHaveBeenCalledOnce());
    const expectedContext = expect.objectContaining({
      client: mocks.queryClient,
      mutationKey: ["writeContract"],
    });
    expect(onSuccess).toHaveBeenCalledWith(HASH, CALL, undefined, expectedContext);
    expect(onSettled).toHaveBeenCalledWith(HASH, null, CALL, undefined, expectedContext);
  });

  it("carries action-specific decoded review labels into the single safety review", async () => {
    const { review, hooks } = await freshHarness();
    const reviewer = vi.fn().mockResolvedValue(true);
    review.registerTransactionReviewHandler(reviewer);
    const { result } = renderHook(() =>
      hooks.useWriteContract({
        transactionReview: {
          title: "Review shop items",
          label: "Add shop items",
          contractName: "JB721TiersHook",
          confirmLabel: "Confirm & send",
        },
      }),
    );

    await act(async () => {
      await result.current.writeContractAsync(CALL as never);
    });

    expect(reviewer).toHaveBeenCalledOnce();
    expect(reviewer).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Review shop items",
        confirmLabel: "Confirm & send",
        calls: [
          expect.objectContaining({
            label: "Add shop items",
            contractName: "JB721TiersHook",
            functionName: "transfer",
          }),
        ],
      }),
    );
  });

  it("leaves the review description unset when there is no extra guidance", async () => {
    const { review, hooks } = await freshHarness();
    const reviewer = vi.fn().mockResolvedValue(true);
    review.registerTransactionReviewHandler(reviewer);
    const { result } = renderHook(() => hooks.useWriteContract());

    await act(async () => {
      await result.current.writeContractAsync(CALL as never);
    });

    // An empty string would render as a blank guidance banner in the review.
    expect(reviewer.mock.calls[0][0].description).toBeUndefined();
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

  it("refuses a call built for another account before its review, and sends one built for this account", async () => {
    const { review, hooks } = await freshHarness();
    const reviewer = vi.fn().mockResolvedValue(true);
    review.registerTransactionReviewHandler(reviewer);
    const { result } = renderHook(() => hooks.useWriteContract());

    // The plan pays RECIPIENT on behalf of OTHER_ACCOUNT, but ACCOUNT is connected.
    for (const planned of [OTHER_ACCOUNT, { address: OTHER_ACCOUNT, type: "json-rpc" }]) {
      await expect(
        result.current.writeContractAsync({ ...CALL, account: planned } as never),
      ).rejects.toThrow(hooks.ACCOUNT_CHANGED);
    }
    expect(hooks.ACCOUNT_CHANGED).toBe("The connected account changed. Review again.");
    expect(reviewer).not.toHaveBeenCalled();
    expect(mocks.simulateContract).not.toHaveBeenCalled();
    expect(mocks.submit).not.toHaveBeenCalled();

    await act(async () => {
      await result.current.writeContractAsync({
        ...CALL,
        account: ACCOUNT.toLowerCase(),
      } as never);
    });
    expect(mocks.submit).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ account: ACCOUNT, address: TARGET }),
    );
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

  it("refreshes a sibling tab's persisted pending lock before opening review", async () => {
    const { review, activity, hooks } = await freshHarness();
    activity.transactionActivitySnapshot();
    const reviewer = vi.fn().mockResolvedValue(true);
    review.registerTransactionReviewHandler(reviewer);
    const callKey = `${ACCOUNT.toLowerCase()}:11155111:${TARGET.toLowerCase()}:0:${encodeFunctionData(
      {
        abi: ABI,
        functionName: "transfer",
        args: [RECIPIENT, 7n],
      },
    )}`;
    window.localStorage.setItem(
      "revnet:transaction-activities:v1",
      JSON.stringify([
        {
          id: "other-tab:safe-proposal",
          kind: "safe",
          title: "Publish project handle",
          status: "safe-proposed",
          message: "Awaiting Safe execution",
          chainId: 11155111,
          account: ACCOUNT,
          hash: HASH,
          safeProposalHash: HASH,
          callKey,
          createdAt: 1,
          updatedAt: 1,
        },
      ]),
    );

    const { result } = renderHook(() => hooks.useWriteContract());
    await expect(result.current.writeContractAsync(CALL as never)).rejects.toBeInstanceOf(
      hooks.SafeProposalPendingError,
    );
    expect(reviewer).not.toHaveBeenCalled();
    expect(mocks.submit).not.toHaveBeenCalled();
  });

  it("serializes simultaneous identical submissions before either wallet prompt", async () => {
    let tail = Promise.resolve();
    const lockRequest = vi.fn(async (_name: string, callback: () => Promise<Hex>) => {
      const previous = tail;
      let release: () => void = () => {};
      tail = new Promise<void>((resolve) => {
        release = resolve;
      });
      await previous;
      try {
        return await callback();
      } finally {
        release();
      }
    });
    Object.defineProperty(navigator, "locks", {
      configurable: true,
      value: { request: lockRequest },
    });
    const { review, hooks } = await freshHarness();
    const reviewer = vi.fn().mockResolvedValue(true);
    review.registerTransactionReviewHandler(reviewer);
    const { result } = renderHook(() => hooks.useWriteContract());

    let outcomes: PromiseSettledResult<Hex>[] = [];
    await act(async () => {
      outcomes = await Promise.allSettled([
        result.current.writeContractAsync(CALL as never),
        result.current.writeContractAsync(CALL as never),
      ]);
    });

    expect(outcomes.map((outcome) => outcome.status).sort()).toEqual(["fulfilled", "rejected"]);
    expect(lockRequest).toHaveBeenCalledTimes(2);
    expect(reviewer).toHaveBeenCalledOnce();
    expect(mocks.submit).toHaveBeenCalledOnce();
  });

  it("fails closed when the connector changes across Safe review", async () => {
    mocks.account = {
      address: ACCOUNT,
      chainId: 11155111,
      connector: { id: "safe", name: "Safe" },
    };
    const { review, hooks } = await freshHarness();
    review.registerTransactionReviewHandler(async () => {
      mocks.account = {
        address: ACCOUNT,
        chainId: 11155111,
        connector: { id: "injected", name: "Injected" },
      };
      return true;
    });
    const { result } = renderHook(() => hooks.useWriteContract());

    await expect(result.current.writeContractAsync(CALL as never)).rejects.toThrow(
      "Wallet connection changed",
    );
    expect(mocks.submit).not.toHaveBeenCalled();
  });

  it("tracks success through a direct receipt read when the watcher rejects", async () => {
    const { review, activity, hooks } = await freshHarness();
    review.registerTransactionReviewHandler(async () => true);
    mocks.waitForTransactionReceipt.mockRejectedValue(new Error("Invalid RPC parameters"));
    mocks.getTransactionReceipt.mockResolvedValue({ status: "success" });
    const { result } = renderHook(() => hooks.useWriteContract());

    await act(async () => {
      await result.current.writeContractAsync(CALL as never);
    });

    await waitFor(() =>
      expect(activity.transactionActivityForHash(HASH)).toMatchObject({ status: "success" }),
    );
    expect(mocks.getTransactionReceipt).toHaveBeenCalledWith({ hash: HASH });
  });

  it.each(["success", "failed"] as const)(
    "reports no result for an unsent write when a finished batch's %s row has no hash",
    async (status) => {
      const { activity, hooks } = await freshHarness();
      // A multichain batch is tracked under its batch id, without a transaction hash.
      activity.recordTransactionActivity({
        id: "batch:1",
        kind: "direct",
        title: "Add items",
        status,
        message: "Batch finished.",
        account: ACCOUNT,
      });

      const { result } = renderHook(() => hooks.useWaitForTransactionReceipt({ hash: undefined }));

      expect(result.current).toMatchObject({
        isSuccess: false,
        isError: false,
        statusMessage: undefined,
      });
    },
  );

  it("persists Safe proposal locks through terminal-history churn and blocks duplicate execution", async () => {
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
      expect(request.calls[0].safeTxGas).toBe(0n);
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
    expect(mocks.submit).toHaveBeenCalledWith(expect.objectContaining({ gas: 0n }));
    for (let index = 0; index < 25; index += 1) {
      activity.recordTransactionActivity({
        id: `completed:${index}`,
        kind: "direct",
        title: `Completed ${index}`,
        status: "success",
        message: "Confirmed",
      });
    }

    const reloaded = await freshHarness();
    const reloadedHook = renderHook(() => reloaded.hooks.useWriteContract());
    await expect(
      reloadedHook.result.current.writeContractAsync(CALL as never),
    ).rejects.toBeInstanceOf(reloaded.hooks.SafeProposalPendingError);
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

  it("proposes through Safe{Wallet} over WalletConnect and sends through SafePal", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise(() => undefined)),
    );
    const { review, activity, hooks } = await freshHarness();
    const { watchSafeWalletPeer } = await import("@/lib/safe-connector");
    review.registerTransactionReviewHandler(async () => true);
    mocks.account = {
      address: ACCOUNT,
      chainId: 11155111,
      connector: {
        id: "walletConnect",
        name: "WalletConnect",
        getProvider: async () => ({
          session: { peer: { metadata: { url: "https://app.safe.global" } } },
        }),
      },
    };
    await act(async () => {
      watchSafeWalletPeer(mocks.config as never);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    const { result } = renderHook(() => hooks.useWriteContract());

    await act(async () => {
      await result.current.writeContractAsync(CALL as never);
    });
    // Safe{Wallet} takes a dapp's gas as the proposal's safeTxGas.
    expect(mocks.submit).toHaveBeenLastCalledWith(expect.objectContaining({ gas: 0n }));
    expect(activity.transactionActivityForHash(HASH)).toMatchObject({
      kind: "safe",
      status: "safe-proposed",
    });

    // SafePal is an ordinary wallet: it gets a gas limit and a receipt watch.
    const SAFEPAL_HASH = `0x${"56".repeat(32)}` as Hex;
    mocks.account = {
      address: ACCOUNT,
      chainId: 11155111,
      connector: { id: "injected", name: "SafePal" },
    };
    mocks.submit.mockResolvedValue(SAFEPAL_HASH);
    await act(async () => {
      await result.current.writeContractAsync({ ...CALL, args: [RECIPIENT, 8n] } as never);
    });
    expect(mocks.submit).toHaveBeenLastCalledWith(expect.objectContaining({ gas: 100_000n }));
    expect(activity.transactionActivityForHash(SAFEPAL_HASH)).toMatchObject({ kind: "direct" });
  });

  it.each([
    ["succeeded", [executionLog(ACCOUNT, OTHER_PROPOSAL)], "success"],
    [
      "ran a Safe call that failed",
      [executionLog(ACCOUNT, OTHER_PROPOSAL, "ExecutionFailure")],
      "failed",
    ],
  ] as const)(
    "settles a Safe reply that is already an execution which %s from its receipt",
    async (_outcome, logs, status) => {
      mocks.account = {
        address: ACCOUNT,
        chainId: 11155111,
        connector: { id: "safe", name: "Safe" },
      };
      const service = vi.fn();
      vi.stubGlobal("fetch", service);
      // Safe{Wallet} replied with the execution's own hash: the chain knows it,
      // and it runs exactly the reviewed call from this Safe.
      mocks.getTransaction.mockResolvedValue(executionOf(TRANSFER_7));
      mocks.waitForTransactionReceipt.mockResolvedValue({
        status: "success",
        transactionHash: HASH,
        logs,
      });
      const { review, activity, hooks } = await freshHarness();
      review.registerTransactionReviewHandler(async () => true);
      const { result } = renderHook(() => hooks.useWriteContract());

      await act(async () => {
        await result.current.writeContractAsync(CALL as never);
      });

      await waitFor(() =>
        expect(activity.transactionActivityForHash(HASH)).toMatchObject({
          kind: "safe",
          status,
          executionHash: HASH,
        }),
      );
      expect(mocks.getTransaction).toHaveBeenCalledWith({ hash: HASH });
      expect(service).not.toHaveBeenCalled();
    },
  );

  it.each([
    [
      "another call",
      executionOf({
        ...TRANSFER_7,
        data: encodeFunctionData({ abi: ABI, functionName: "transfer", args: [RECIPIENT, 8n] }),
      }),
    ],
    ["another Safe's execution", executionOf(TRANSFER_7, OTHER_ACCOUNT)],
    ["no execTransaction", { hash: HASH, to: ACCOUNT, input: TRANSFER_7.data }],
  ])("leaves a reply unconfirmed that executes %s", async (_case, execution) => {
    mocks.account = {
      address: ACCOUNT,
      chainId: 11155111,
      connector: { id: "safe", name: "Safe" },
    };
    vi.stubGlobal("fetch", vi.fn());
    mocks.getTransaction.mockResolvedValue(execution);
    // The receipt shows one success of this Safe: the at-once reading alone would accept it.
    mocks.waitForTransactionReceipt.mockResolvedValue({
      status: "success",
      transactionHash: HASH,
      logs: [executionLog(ACCOUNT, OTHER_PROPOSAL)],
    });
    const { review, activity, hooks } = await freshHarness();
    review.registerTransactionReviewHandler(async () => true);
    const { result } = renderHook(() => hooks.useWriteContract());

    await act(async () => {
      await result.current.writeContractAsync(CALL as never);
    });

    await waitFor(() =>
      expect(activity.transactionActivityForHash(HASH)).toMatchObject({
        status: "safe-proposed",
        message: UNCONFIRMED,
        safeResultUnconfirmed: true,
      }),
    );
    expect(activity.transactionActivityForHash(HASH)?.executionHash).toBeUndefined();
  });

  it("settles a reply journaled without reviewed calls by its Safe's one execution", async () => {
    const { activity, hooks } = await freshHarness();
    savedProposal(activity, HASH, 11155420, null);
    mocks.getTransaction.mockResolvedValue(executionOf(TRANSFER_7));
    mocks.waitForTransactionReceipt.mockResolvedValue({
      status: "success",
      transactionHash: HASH,
      logs: [executionLog(ACCOUNT, OTHER_PROPOSAL)],
    });

    hooks.resumeSafeProposalTracking(mocks.config as never);

    await waitFor(() =>
      expect(activity.transactionActivityForHash(HASH)).toMatchObject({
        status: "success",
        executionHash: HASH,
      }),
    );
  });

  it.each([
    ["no execution event of its Safe", [executionLog(OTHER_ACCOUNT, OTHER_PROPOSAL)]],
    [
      "two execution events of its Safe",
      [executionLog(ACCOUNT, OTHER_PROPOSAL), executionLog(ACCOUNT, PROPOSAL)],
    ],
  ])("leaves an execution unconfirmed whose receipt has %s", async (_case, logs) => {
    const { activity, hooks } = await freshHarness();
    savedProposal(activity, HASH, 11155420);
    mocks.getTransaction.mockResolvedValue(executionOf({ to: TARGET, data: "0x1234" }));
    mocks.waitForTransactionReceipt.mockResolvedValue({
      status: "success",
      transactionHash: HASH,
      logs,
    });

    hooks.resumeSafeProposalTracking(mocks.config as never);

    await waitFor(() =>
      expect(activity.transactionActivityForHash(HASH)).toMatchObject({
        status: "safe-proposed",
        executionHash: HASH,
        message: UNCONFIRMED,
        safeResultUnconfirmed: true,
      }),
    );
  });

  it.each([
    ["with", 11155111],
    ["without", 11155420],
  ])(
    "resumes a saved proposal on a chain %s a Safe service through the chain's client",
    async (_service, chainId) => {
      const { activity, hooks } = await freshHarness();
      savedProposal(activity, HASH, chainId);
      const service = vi.fn();
      vi.stubGlobal("fetch", service);
      mocks.getTransaction.mockResolvedValue(executionOf({ to: TARGET, data: "0x1234" }));
      mocks.waitForTransactionReceipt.mockResolvedValue({
        status: "success",
        transactionHash: HASH,
        logs: [executionLog(ACCOUNT, OTHER_PROPOSAL)],
      });

      hooks.resumeSafeProposalTracking(mocks.config as never);

      await waitFor(() =>
        expect(activity.transactionActivityForHash(HASH)).toMatchObject({
          status: "success",
          executionHash: HASH,
        }),
      );
      expect(service).not.toHaveBeenCalled();
    },
  );

  describe("a proposal the Safe service reports executed", () => {
    const EXECUTION = `0x${"34".repeat(32)}` as Hex;

    function executedRecord(record: SafeQueuedTransaction) {
      const service = vi.fn(async (input: RequestInfo | URL) =>
        String(input).endsWith(`/multisig-transactions/${PROPOSAL}/`)
          ? new Response(
              JSON.stringify({
                ...record,
                safe: ACCOUNT,
                isExecuted: true,
                // The service's own verdict, which never decides this proposal.
                isSuccessful: true,
                transactionHash: EXECUTION,
              }),
            )
          : new Response("Not found", { status: 404 }),
      );
      vi.stubGlobal("fetch", service);
      return service;
    }

    it.each([
      ["succeeded", executionLog(ACCOUNT, PROPOSAL), "success"],
      ["failed", executionLog(ACCOUNT, PROPOSAL, "ExecutionFailure"), "failed"],
    ] as const)(
      "settles from its Safe's event for this proposal when it %s",
      async (_case, log, status) => {
        const { activity, hooks } = await freshHarness();
        savedProposal(activity, PROPOSAL, 11155111);
        executedRecord(PROPOSED);
        mocks.waitForTransactionReceipt.mockResolvedValue({
          status: "success",
          transactionHash: EXECUTION,
          logs: [log],
        });

        hooks.resumeSafeProposalTracking(mocks.config as never);

        await waitFor(() =>
          expect(activity.transactionActivityForHash(PROPOSAL)).toMatchObject({
            status,
            executionHash: EXECUTION,
          }),
        );
        expect(mocks.waitForTransactionReceipt).toHaveBeenCalledWith(
          expect.objectContaining({ hash: EXECUTION }),
        );
      },
    );

    it("is not confirmed by another proposal's success in the same receipt", async () => {
      const { activity, hooks } = await freshHarness();
      savedProposal(activity, PROPOSAL, 11155111);
      executedRecord(PROPOSED);
      mocks.waitForTransactionReceipt.mockResolvedValue({
        status: "success",
        transactionHash: EXECUTION,
        logs: [executionLog(ACCOUNT, OTHER_PROPOSAL)],
      });

      hooks.resumeSafeProposalTracking(mocks.config as never);

      await waitFor(() =>
        expect(activity.transactionActivityForHash(PROPOSAL)).toMatchObject({
          status: "safe-proposed",
          executionHash: EXECUTION,
          message: UNCONFIRMED,
          safeResultUnconfirmed: true,
        }),
      );
    });

    it("settles a proposal journaled without reviewed calls from its Safe's event for this proposal", async () => {
      const { activity, hooks } = await freshHarness();
      savedProposal(activity, PROPOSAL, 11155111, null);
      executedRecord(PROPOSED);
      mocks.waitForTransactionReceipt.mockResolvedValue({
        status: "success",
        transactionHash: EXECUTION,
        logs: [executionLog(ACCOUNT, PROPOSAL)],
      });

      hooks.resumeSafeProposalTracking(mocks.config as never);

      await waitFor(() =>
        expect(activity.transactionActivityForHash(PROPOSAL)).toMatchObject({
          status: "success",
          executionHash: EXECUTION,
        }),
      );
    });

    it("leaves a proposal unconfirmed that is not the call it was reviewed to run", async () => {
      const { activity, hooks } = await freshHarness();
      savedProposal(activity, PROPOSAL, 11155111, { to: TARGET, data: "0xabcd" });
      const service = executedRecord(PROPOSED);
      mocks.waitForTransactionReceipt.mockResolvedValue({
        status: "success",
        transactionHash: EXECUTION,
        logs: [executionLog(ACCOUNT, PROPOSAL)],
      });

      hooks.resumeSafeProposalTracking(mocks.config as never);

      await waitFor(() =>
        expect(activity.transactionActivityForHash(PROPOSAL)).toMatchObject({
          status: "safe-proposed",
          message: UNCONFIRMED,
          safeResultUnconfirmed: true,
        }),
      );
      expect(mocks.waitForTransactionReceipt).not.toHaveBeenCalled();

      // Its result can't be confirmed here, so a reload does not ask Safe again.
      const asked = service.mock.calls.length;
      hooks.resumeSafeProposalTracking(mocks.config as never);
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(service).toHaveBeenCalledTimes(asked);
    });

    it("never trusts a record whose fields are another proposal's", async () => {
      vi.useFakeTimers();
      const { activity, hooks } = await freshHarness();
      savedProposal(activity, PROPOSAL, 11155111);
      executedRecord({ ...PROPOSED, nonce: 8 });

      hooks.resumeSafeProposalTracking(mocks.config as never);
      await vi.advanceTimersByTimeAsync(3 * 5_000);

      expect(mocks.waitForTransactionReceipt).not.toHaveBeenCalled();
      expect(activity.transactionActivityForHash(PROPOSAL)).toMatchObject({
        status: "safe-proposed",
      });
    });
  });

  it.each([
    ["keeps asking Safe after a minute of chain checks", 11155111],
    ["stops after a minute of chain checks without a Safe service", 11155420],
  ])("tracks a proposal that never becomes a transaction: %s", async (_name, chainId) => {
    vi.useFakeTimers();
    const { activity, hooks } = await freshHarness();
    const proposal = safeTransactionHash(chainId, ACCOUNT, PROPOSED);
    savedProposal(activity, proposal, chainId);
    const service = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            ...PROPOSED,
            safe: ACCOUNT,
            isExecuted: false,
            // One current owner, and one address that does not own the Safe.
            confirmations: [
              { owner: SAFE_OWNER_A, signature: SIGNATURE },
              { owner: OTHER_ACCOUNT, signature: SIGNATURE },
            ],
            // The service's own count, which the journal does not use.
            confirmationsRequired: 1,
          }),
        ),
    );
    vi.stubGlobal("fetch", service);

    hooks.resumeSafeProposalTracking(mocks.config as never);
    await vi.advanceTimersByTimeAsync(20 * 5_000);

    // An execution sent at once reaches the chain within a minute of the reply.
    expect(mocks.getTransaction).toHaveBeenCalledTimes(12);
    if (chainId === 11155420) expect(service).not.toHaveBeenCalled();
    else expect(service.mock.calls.length).toBeGreaterThan(12);
    expect(activity.transactionActivityForHash(proposal)).toMatchObject(
      chainId === 11155420
        ? { status: "safe-proposed", message: UNCONFIRMED, safeResultUnconfirmed: true }
        : { status: "safe-proposed", message: expect.stringContaining("| 1/2 approvals.") },
    );
    if (chainId === 11155111) {
      expect(activity.transactionActivityForHash(proposal)?.safeResultUnconfirmed).toBeUndefined();
    }
  });

  it.each([
    ["every one of its chain checks fails", () => true],
    ["its last chain check fails", (check: number) => check === 12],
  ])(
    "follows a proposal again on the next load, on a chain without a Safe service, when %s",
    async (_case, fails) => {
      vi.useFakeTimers();
      const { activity, hooks } = await freshHarness();
      const proposal = safeTransactionHash(11155420, ACCOUNT, PROPOSED);
      savedProposal(activity, proposal, 11155420);
      let checks = 0;
      mocks.getTransaction.mockImplementation(async ({ hash }: { hash: Hex }) => {
        checks += 1;
        // A node that can't be reached says nothing about the transaction.
        throw fails(checks)
          ? new HttpRequestError({ url: "https://rpc.example", details: "fetch failed" })
          : new TransactionNotFoundError({ hash });
      });

      hooks.resumeSafeProposalTracking(mocks.config as never);
      await vi.advanceTimersByTimeAsync(20 * 5_000);

      expect(mocks.getTransaction).toHaveBeenCalledTimes(12);
      expect(activity.transactionActivityForHash(proposal)).toMatchObject({
        status: "safe-proposed",
      });
      expect(activity.transactionActivityForHash(proposal)?.safeResultUnconfirmed).toBeUndefined();
    },
  );

  describe("a proposal the app can't follow to a result", () => {
    const EXECUTION = `0x${"34".repeat(32)}` as Hex;

    /** The Safe service answering every request for the proposal with `answer`. */
    function serviceAnswering(answer: () => Response) {
      const service = vi.fn(async () => answer());
      vi.stubGlobal("fetch", service);
      return service;
    }

    it("ends unconfirmed when its watch gives up on a proposal Safe never lists", async () => {
      vi.useFakeTimers();
      const { activity, hooks } = await freshHarness();
      savedProposal(activity, PROPOSAL, 11155111);
      serviceAnswering(() => new Response("Not found", { status: 404 }));

      hooks.resumeSafeProposalTracking(mocks.config as never);
      await vi.advanceTimersByTimeAsync(HOUR - 60_000);
      expect(activity.transactionActivityForHash(PROPOSAL)?.safeResultUnconfirmed).toBeUndefined();
      await vi.advanceTimersByTimeAsync(2 * 60_000);

      expect(activity.transactionActivityForHash(PROPOSAL)).toMatchObject({
        status: "safe-proposed",
        message: UNCONFIRMED,
        safeResultUnconfirmed: true,
      });
    });

    it.each([
      ["Safe never lists", () => new Response("Not found", { status: 404 })],
      [
        "Safe lists with another proposal's fields",
        () => new Response(JSON.stringify({ ...PROPOSED, nonce: 8, safe: ACCOUNT })),
      ],
      [
        "Safe reports executed without its transaction",
        () => new Response(JSON.stringify({ ...PROPOSED, safe: ACCOUNT, isExecuted: true })),
      ],
    ])(
      "ends unconfirmed, an hour after it was made, after ten minutes of looks in a row when %s",
      async (_case, answer) => {
        vi.useFakeTimers();
        const { activity, hooks } = await freshHarness();
        savedProposal(activity, PROPOSAL, 11155111, undefined, Date.now() - HOUR);
        serviceAnswering(answer);

        hooks.resumeSafeProposalTracking(mocks.config as never);
        await vi.advanceTimersByTimeAsync(9 * 60_000);
        expect(
          activity.transactionActivityForHash(PROPOSAL)?.safeResultUnconfirmed,
        ).toBeUndefined();
        await vi.advanceTimersByTimeAsync(2 * 60_000);

        expect(activity.transactionActivityForHash(PROPOSAL)).toMatchObject({
          status: "safe-proposed",
          message: UNCONFIRMED,
          safeResultUnconfirmed: true,
        });
      },
    );

    it.each([
      ["another transaction took its nonce, ends unconfirmed after ten minutes of looks", 8n, true],
      ["its nonce is still to come, keeps following it", 7n, false],
    ])("an hour after it was made, when %s", async (_case, safeNonce, ended) => {
      vi.useFakeTimers();
      const { activity, hooks } = await freshHarness();
      mocks.safeReads = safeChain(ACCOUNT, { nonce: safeNonce });
      savedProposal(activity, PROPOSAL, 11155111, undefined, Date.now() - HOUR);
      serviceAnswering(
        () => new Response(JSON.stringify({ ...PROPOSED, safe: ACCOUNT, isExecuted: false })),
      );

      hooks.resumeSafeProposalTracking(mocks.config as never);
      // A nonce past the proposal's may be its own execution, which the service lists later.
      await vi.advanceTimersByTimeAsync(9 * 60_000);
      expect(activity.transactionActivityForHash(PROPOSAL)).toMatchObject({
        message: expect.stringContaining("approvals"),
      });
      expect(activity.transactionActivityForHash(PROPOSAL)?.safeResultUnconfirmed).toBeUndefined();
      await vi.advanceTimersByTimeAsync(2 * 60_000);

      expect(activity.transactionActivityForHash(PROPOSAL)).toMatchObject(
        ended
          ? { message: UNCONFIRMED, safeResultUnconfirmed: true }
          : { message: expect.stringContaining("approvals") },
      );
      if (!ended) {
        expect(
          activity.transactionActivityForHash(PROPOSAL)?.safeResultUnconfirmed,
        ).toBeUndefined();
      }
    });

    it("reads the Safe's nonce at most once a minute", async () => {
      vi.useFakeTimers();
      const { activity, hooks } = await freshHarness();
      mocks.safeReads = safeChain(ACCOUNT, { nonce: 7n });
      savedProposal(activity, PROPOSAL, 11155111, undefined, Date.now() - HOUR);
      const service = serviceAnswering(
        () => new Response(JSON.stringify({ ...PROPOSED, safe: ACCOUNT, isExecuted: false })),
      );

      hooks.resumeSafeProposalTracking(mocks.config as never);
      await vi.advanceTimersByTimeAsync(5 * 60_000);

      expect(service.mock.calls.length).toBeGreaterThanOrEqual(60);
      const nonceReads = mocks.safeReads.request.mock.calls.filter(
        ([args]) => (args.params[0] as { data?: Hex } | undefined)?.data === NONCE_CALL,
      );
      expect(nonceReads.length).toBeGreaterThanOrEqual(5);
      expect(nonceReads.length).toBeLessThanOrEqual(6);
    });

    it.each([
      ["an hour", HOUR],
      ["half an hour", HOUR / 2],
    ])(
      "settles a proposal made %s ago that executed before the service listed its execution",
      async (_age, age) => {
        vi.useFakeTimers();
        const { activity, hooks } = await freshHarness();
        // Mining its execution moved the Safe's nonce past the proposal's 7.
        mocks.safeReads = safeChain(ACCOUNT, { nonce: 8n });
        savedProposal(activity, PROPOSAL, 11155111, undefined, Date.now() - age);
        let looks = 0;
        serviceAnswering(() => {
          looks += 1;
          // The service lists the execution from its fourth look.
          return new Response(
            JSON.stringify({
              ...PROPOSED,
              safe: ACCOUNT,
              ...(looks >= 4
                ? { isExecuted: true, transactionHash: EXECUTION }
                : { isExecuted: false }),
            }),
          );
        });
        mocks.waitForTransactionReceipt.mockResolvedValue({
          status: "success",
          transactionHash: EXECUTION,
          logs: [executionLog(ACCOUNT, PROPOSAL)],
        });

        hooks.resumeSafeProposalTracking(mocks.config as never);
        await vi.advanceTimersByTimeAsync(4 * 5_000);

        expect(activity.transactionActivityForHash(PROPOSAL)).toMatchObject({
          status: "success",
          executionHash: EXECUTION,
        });
        expect(
          activity.transactionActivityForHash(PROPOSAL)?.safeResultUnconfirmed,
        ).toBeUndefined();
      },
    );

    it("is followed again on the next load when only the last looks before its watch gives up can't be read", async () => {
      vi.useFakeTimers();
      const { activity, hooks } = await freshHarness();
      savedProposal(activity, PROPOSAL, 11155111);
      const givesUp = Date.now() + HOUR;
      serviceAnswering(() =>
        Date.now() < givesUp - 30_000
          ? new Response(JSON.stringify({ ...PROPOSED, safe: ACCOUNT, isExecuted: false }))
          : // A record the app can't authenticate.
            new Response(JSON.stringify({ ...PROPOSED, nonce: 8, safe: ACCOUNT })),
      );

      hooks.resumeSafeProposalTracking(mocks.config as never);
      await vi.advanceTimersByTimeAsync(HOUR + 60_000);

      expect(activity.transactionActivityForHash(PROPOSAL)).toMatchObject({
        status: "safe-proposed",
        message: expect.stringContaining("approvals"),
      });
      expect(activity.transactionActivityForHash(PROPOSAL)?.safeResultUnconfirmed).toBeUndefined();
    });

    it("ends unconfirmed, an hour after it was made, when the chain never returns its execution's receipt", async () => {
      vi.useFakeTimers();
      const { activity, hooks } = await freshHarness();
      savedProposal(activity, PROPOSAL, 11155111, undefined, Date.now() - HOUR);
      serviceAnswering(
        () =>
          new Response(
            JSON.stringify({
              ...PROPOSED,
              safe: ACCOUNT,
              isExecuted: true,
              transactionHash: `0x${"34".repeat(32)}`,
            }),
          ),
      );
      mocks.waitForTransactionReceipt.mockRejectedValue(new Error("timed out"));

      hooks.resumeSafeProposalTracking(mocks.config as never);
      await vi.advanceTimersByTimeAsync(5 * 60_000);

      expect(activity.transactionActivityForHash(PROPOSAL)).toMatchObject({
        status: "safe-proposed",
        message: UNCONFIRMED,
        safeResultUnconfirmed: true,
      });
    });
  });
});
