import {
  approvalIntent,
  borrowIntent,
  bridgeIntent,
  cashOutIntent,
  HELD_AWAY_SUCCESS_LINE,
  HELD_CONFIRMING_LINE,
  HELD_POLL_MS,
  HELD_SEND_AGAIN_LABEL,
  HELD_SUCCESS_LINE,
  launchIntent,
  liquidityIntent,
  loanIntent,
  payIntent,
  WRITE_HOLD_HASHED_EXIT_LINE,
  WRITE_HOLD_NONCE_LINE,
  WRITE_HOLD_PENDING_LINE,
  WRITE_HOLD_SAFE_UNPROVEN_LINE,
  WRITE_HOLD_UNCHECKED_LINE,
} from "@bananapus/nana-sdk-core/review";
import { encodeMultiSend, MULTI_SEND_CALL_ONLY } from "@bananapus/nana-sdk-core/safe";
import {
  SAFE_EXEC_ABI,
  SAFE_PROPOSAL_AWAITING,
  safeBatchProposalFor,
  safeProposalFor,
  safeTransactionHash,
} from "@bananapus/nana-sdk-core/safe-service";
import {
  resetSafeRelayrForTests,
  resetWriteHoldsForTests,
  resetWriteRecoveryForTests,
} from "@bananapus/nana-sdk-core/testing";
import { act, cleanup, render, renderHook, waitFor } from "@testing-library/react";
import {
  encodeFunctionData,
  parseAbi,
  TransactionNotFoundError,
  TransactionReceiptNotFoundError,
  WaitForTransactionReceiptTimeoutError,
  zeroAddress,
  type Address,
  type Hex,
} from "viem";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
  getTransactionCount: vi.fn(),
  submit: vi.fn(),
  wagmiReceipt: vi.fn(),
  // The connected Safe's own reads: its owners and threshold.
  safeReads: undefined as unknown as ReturnType<typeof import("./fixtures/safe-chain").safeChain>,
  // When set, no chain has a client.
  noClient: false,
  // The SDK's chain look at a proposal whose nonce the Safe has passed.
  lookAtSafeProposal: vi.fn(),
  // The execution transaction a proven proposal's Safe event names (the SDK's canonical proof).
  provenSafeProposalEnd: vi.fn(),
  // A Safe connection's wallet_sendCalls.
  sendCalls: vi.fn(),
  // Safe's service record of a proposal, and the confirmations of it that count; unset, the SDK's.
  readSafeTransaction: undefined as undefined | ((...args: never[]) => Promise<unknown>),
  usableSafeConfirmations: undefined as undefined | ((...args: never[]) => unknown[]),
}));

vi.mock("@wagmi/core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@wagmi/core")>()),
  sendCalls: mocks.sendCalls,
}));

vi.mock("@bananapus/nana-sdk-core/review", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@bananapus/nana-sdk-core/review")>()),
  // A batch's sequence simulation runs on the node, which these tests don't model.
  simulateCallSequence: async () => undefined,
}));

vi.mock("@bananapus/nana-sdk-core/safe-service", async (importOriginal) => {
  const original = await importOriginal<typeof import("@bananapus/nana-sdk-core/safe-service")>();
  return {
    ...original,
    lookAtSafeProposal: mocks.lookAtSafeProposal,
    provenSafeProposalEnd: mocks.provenSafeProposalEnd,
    readSafeTransaction: (...args: Parameters<typeof original.readSafeTransaction>) =>
      mocks.readSafeTransaction
        ? (mocks.readSafeTransaction(...(args as unknown as never[])) as ReturnType<
            typeof original.readSafeTransaction
          >)
        : original.readSafeTransaction(...args),
    usableSafeConfirmations: (...args: Parameters<typeof original.usableSafeConfirmations>) =>
      mocks.usableSafeConfirmations
        ? (mocks.usableSafeConfirmations(...(args as unknown as never[])) as ReturnType<
            typeof original.usableSafeConfirmations
          >)
        : original.usableSafeConfirmations(...args),
  };
});

/** One client per chain, as wagmi keeps them. */
const clients = new Map<number, unknown>();
function clientOf(chainId: number) {
  if (mocks.noClient) return undefined;
  if (!clients.has(chainId))
    clients.set(chainId, {
      chain: { id: chainId },
      getChainId: async () => chainId,
      estimateContractGas: mocks.estimateContractGas,
      waitForTransactionReceipt: mocks.waitForTransactionReceipt,
      getTransactionReceipt: mocks.getTransactionReceipt,
      getTransaction: mocks.getTransaction,
      getBlockNumber: async () => 100n,
      getBlock: async ({ blockNumber }: { blockNumber?: bigint } = {}) => ({
        number: blockNumber ?? 100n,
        hash: `0x${"bb".repeat(32)}`,
      }),
      getTransactionCount: mocks.getTransactionCount,
      getCode: (args: never) => mocks.safeReads.getCode(args),
      getStorageAt: (args: never) => mocks.safeReads.getStorageAt(args),
      request: (args: never) => mocks.safeReads.request(args),
    });
  return clients.get(chainId);
}

vi.mock("wagmi/actions", () => ({
  getAccount: mocks.getAccount,
  getPublicClient: (_config: unknown, { chainId = 11155111 }: { chainId?: number } = {}) =>
    clientOf(chainId),
  simulateContract: mocks.simulateContract,
  switchChain: mocks.switchChain,
  watchAccount: () => () => undefined,
}));

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => mocks.queryClient,
}));

vi.mock("wagmi", () => ({
  useConfig: () => mocks.config,
  usePublicClient: ({ chainId = 11155111 }: { chainId?: number } = {}) => clientOf(chainId),
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
/** What a proposal its follower couldn't confirm shows: the hold's own line, with its exit. */
const UNCONFIRMED = WRITE_HOLD_SAFE_UNPROVEN_LINE;

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

const BLOCK_HASH = `0x${"bb".repeat(32)}` as Hex;
const MINED_TX = {
  hash: HASH,
  from: ACCOUNT,
  to: TARGET,
  input: TRANSFER_7.data,
  value: 0n,
  nonce: 3,
  blockNumber: 9n,
  blockHash: BLOCK_HASH,
  transactionIndex: 0,
  chainId: 11155111,
};
const MINED_RECEIPT = {
  status: "success" as const,
  transactionHash: HASH,
  from: ACCOUNT,
  to: TARGET,
  blockNumber: 9n,
  blockHash: BLOCK_HASH,
  transactionIndex: 0,
  logs: [],
};

/**
 * The chain holds `hash` as an owner's execTransaction of `call` on the Safe, its receipt carrying
 * `logs`, as every reader (the watch and the hold) sees it, final. Any other hash is unknown.
 */
function safeExecutionMined(
  hash: Hex,
  logs: readonly unknown[],
  {
    call = TRANSFER_7,
    status = "success",
    chainId = 11155111,
  }: { call?: typeof TRANSFER_7; status?: "success" | "reverted"; chainId?: number } = {},
) {
  const mined = { blockNumber: 9n, blockHash: BLOCK_HASH, transactionIndex: 0 };
  const transaction = {
    ...executionOf(call),
    ...mined,
    hash,
    from: SAFE_OWNER_A,
    value: 0n,
    nonce: 3,
    chainId,
  };
  const receipt = {
    ...mined,
    status,
    transactionHash: hash,
    from: SAFE_OWNER_A,
    to: ACCOUNT,
    logs: logs.map((log) => ({
      ...(log as object),
      ...mined,
      removed: false,
      transactionHash: hash,
    })),
  };
  const known =
    <T,>(value: T) =>
    async ({ hash: asked }: { hash: Hex }) => {
      if (asked.toLowerCase() === hash.toLowerCase()) return value;
      throw new TransactionNotFoundError({ hash: asked });
    };
  mocks.getTransaction.mockImplementation(known(transaction));
  mocks.getTransactionReceipt.mockImplementation(known(receipt));
  mocks.waitForTransactionReceipt.mockImplementation(known(receipt));
  return { receipt, transaction };
}

/** The chain mines the wallet's transaction: the node knows it and holds its receipt. */
/**
 * The send's receipt: mined and returned `at once` (while the send is still under way), or landing
 * `after the send` returned. Call what this returns once the send is over.
 */
function receiptLands(timing: "at once" | "after the send"): () => void {
  if (timing === "at once") {
    chainMines();
    mocks.waitForTransactionReceipt.mockResolvedValue(MINED_RECEIPT);
    return () => undefined;
  }
  let mine: () => void = () => undefined;
  mocks.waitForTransactionReceipt.mockImplementation(
    () =>
      new Promise((resolve) => {
        mine = () => resolve(MINED_RECEIPT);
      }),
  );
  return () => {
    chainMines();
    mine();
  };
}

function chainMines() {
  mocks.getTransaction.mockResolvedValue(MINED_TX);
  mocks.getTransactionReceipt.mockResolvedValue(MINED_RECEIPT);
}

/** The node never learns of a hash the wallet returned, and 31 minutes pass. */
function unseenForThirtyMinutes() {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(Date.now() + 31 * 60_000);
}

async function freshHarness({ followers = false }: { followers?: boolean } = {}) {
  vi.resetModules();
  const [review, activity, hooks, held] = await Promise.all([
    import("@/lib/transaction-review"),
    import("@/lib/transaction-activity"),
    import("@/hooks/useReviewedWriteContract"),
    import("@/lib/flow-choice"),
  ]);
  // The followers the app mounts for every held write.
  if (followers) {
    const { HeldRowFollowers } = await import("@/components/HeldRowFollowers");
    render(<HeldRowFollowers />);
  }
  return { review, activity, hooks, held };
}

afterEach(() => {
  cleanup();
  resetWriteHoldsForTests();
  resetWriteRecoveryForTests();
  resetSafeRelayrForTests();
});

beforeEach(() => {
  mocks.readSafeTransaction = undefined;
  mocks.usableSafeConfirmations = undefined;
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
  mocks.switchChain.mockImplementation(async (_config, { chainId }) => {
    mocks.account = { ...mocks.account, chainId };
  });
  mocks.waitForTransactionReceipt.mockImplementation(() => new Promise(() => undefined));
  mocks.getTransactionReceipt.mockRejectedValue(new Error("Receipt not found"));
  // A Safe proposal hash is never a transaction the chain knows.
  mocks.getTransaction.mockRejectedValue(new TransactionNotFoundError({ hash: HASH }));
  mocks.getTransactionCount.mockResolvedValue(3);
  mocks.safeReads = safeChain(ACCOUNT);
  mocks.noClient = false;
  mocks.lookAtSafeProposal.mockReset().mockResolvedValue("live");
  mocks.provenSafeProposalEnd.mockReset().mockResolvedValue(null);
  mocks.sendCalls.mockReset().mockResolvedValue({ id: HASH });
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

  it("refuses a call that names no chain before review, with no wallet call", async () => {
    const { review, hooks } = await freshHarness();
    const reviewHandler = vi.fn(async () => true);
    review.registerTransactionReviewHandler(reviewHandler);
    // The wallet is connected on a supported chain the call could otherwise have gone to.
    const { chainId: _named, ...chainless } = CALL;

    const { result } = renderHook(() => hooks.useWriteContract());
    await expect(result.current.writeContractAsync(chainless as never)).rejects.toThrow(
      "This transaction names no chain. Nothing was sent.",
    );
    expect(reviewHandler).not.toHaveBeenCalled();
    expect(mocks.switchChain).not.toHaveBeenCalled();
    expect(mocks.simulateContract).not.toHaveBeenCalled();
    expect(mocks.estimateContractGas).not.toHaveBeenCalled();
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
    // The hold settled it while its result was still being verified: sent again only on the
    // user's "Send it again".
    chainMines();
    await expect(result.current.writeContractAsync(CALL as never)).rejects.toThrow(
      HELD_AWAY_SUCCESS_LINE,
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
      hooks.ACCOUNT_CHANGED,
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
      hooks.ACCOUNT_CHANGED,
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

  for (const stage of [
    "switch",
    "reverify",
    "preflight",
    "simulation",
    "estimate",
    "persistence",
  ] as const) {
    it.each([
      [
        "account",
        () => {
          mocks.account.address = OTHER_ACCOUNT;
        },
        /account changed/i,
      ],
      [
        "disconnected account",
        () => {
          mocks.account.address = undefined;
        },
        /account changed/i,
      ],
      [
        "chain",
        () => {
          mocks.account.chainId = 8453;
        },
        /chain changed/i,
      ],
      [
        "another connection of the same wallet type",
        () => {
          mocks.account.connector = { id: "injected", name: "Injected" };
        },
        /connection changed/i,
      ],
      [
        "view-as mode",
        async () => {
          (await import("@/lib/view-as")).setViewAs(OTHER_ACCOUNT);
        },
        /Exit View as/i,
      ],
    ] as const)(`refuses a changed %s after awaiting ${stage}`, async (_name, change, error) => {
      const { review, activity, hooks } = await freshHarness();
      review.registerTransactionReviewHandler(async () => true);
      let resume!: () => void;
      let entered = false;
      const pending = new Promise<void>((resolve) => {
        resume = resolve;
      });
      const pause = async () => {
        entered = true;
        await pending;
      };
      const beforeSubmission = vi.fn(async () => {
        if (stage === "persistence") await pause();
      });
      if (stage === "switch") {
        mocks.account.chainId = 1;
        mocks.switchChain.mockImplementation(async (_config, { chainId }) => {
          mocks.account.chainId = chainId;
          await pause();
        });
      }
      if (stage === "simulation")
        mocks.simulateContract.mockImplementation(async (_config, request) => {
          await pause();
          return { request };
        });
      if (stage === "estimate")
        mocks.estimateContractGas.mockImplementation(async () => {
          await pause();
          return 50_000n;
        });
      const { result } = renderHook(() =>
        hooks.useWriteContract({
          beforeSubmission,
          reverify: stage === "reverify" ? pause : undefined,
          preflightSimulation:
            stage === "preflight"
              ? async () => {
                  await pause();
                  return { gas: 100_000n };
                }
              : undefined,
        }),
      );
      const attempt = result.current.writeContractAsync(CALL as never);
      const refused = expect(attempt).rejects.toThrow(error);
      await waitFor(() => expect(entered).toBe(true));
      await change();
      resume();
      await refused;
      expect(mocks.submit).not.toHaveBeenCalled();
      expect(activity.transactionActivityForHash(HASH)).toBeUndefined();
      expect(beforeSubmission).toHaveBeenCalledTimes(stage === "persistence" ? 1 : 0);
    });
  }

  it("uses the shared switch, reverify, simulation, persistence, write order", async () => {
    const { review, hooks } = await freshHarness();
    const order: string[] = [];
    review.registerTransactionReviewHandler(async () => {
      order.push("review");
      return true;
    });
    mocks.account.chainId = 1;
    mocks.switchChain.mockImplementation(async (_config, { chainId }) => {
      order.push("switch");
      mocks.account.chainId = chainId;
    });
    mocks.simulateContract.mockImplementation(async (_config, request) => {
      order.push("simulate");
      return { request };
    });
    mocks.submit.mockImplementation(async () => {
      order.push("write");
      return HASH;
    });
    const { result } = renderHook(() =>
      hooks.useWriteContract({
        reverify: async () => {
          order.push("reverify");
        },
        beforeSubmission: async () => {
          order.push("persist");
        },
      }),
    );
    await act(async () => {
      await result.current.writeContractAsync(CALL as never);
    });
    expect(order).toEqual(["review", "switch", "reverify", "simulate", "persist", "write"]);
  });

  it("does not clear persisted recovery when the wallet submission fails ambiguously", async () => {
    const { review, hooks } = await freshHarness();
    review.registerTransactionReviewHandler(async () => true);
    let persisted = false;
    const onSubmissionRejected = vi.fn();
    const onBeforeSubmissionAborted = vi.fn(async () => {
      persisted = false;
    });
    mocks.submit.mockRejectedValue(new Error("Wallet transport timed out"));
    const { result } = renderHook(() =>
      hooks.useWriteContract({
        beforeSubmission: async () => {
          persisted = true;
        },
        onBeforeSubmissionAborted,
        onSubmissionRejected,
      }),
    );
    await expect(result.current.writeContractAsync(CALL as never)).rejects.toThrow("timed out");
    expect(persisted).toBe(true);
    expect(onBeforeSubmissionAborted).not.toHaveBeenCalled();
    expect(onSubmissionRejected).not.toHaveBeenCalled();
    expect(mocks.submit).toHaveBeenCalledOnce();
  });

  it("releases caller recovery only for definite rejection from the actual wallet writer", async () => {
    const { review, hooks } = await freshHarness();
    review.registerTransactionReviewHandler(async () => true);
    let persisted = false;
    const onSubmissionRejected = vi.fn(async () => {
      persisted = false;
    });
    mocks.submit.mockRejectedValue(Object.assign(new Error("User rejected"), { code: 4001 }));
    const { result } = renderHook(() =>
      hooks.useWriteContract({
        beforeSubmission: async () => {
          persisted = true;
        },
        onSubmissionRejected,
      }),
    );
    await expect(result.current.writeContractAsync(CALL as never)).rejects.toThrow("User rejected");
    expect(mocks.submit).toHaveBeenCalledOnce();
    expect(onSubmissionRejected).toHaveBeenCalledOnce();
    expect(persisted).toBe(false);
  });

  it("releases the saved intent only when the final shared gate refuses before the wallet", async () => {
    const { review, hooks } = await freshHarness();
    review.registerTransactionReviewHandler(async () => true);
    let persisted = false;
    const onBeforeSubmissionAborted = vi.fn(async () => {
      persisted = false;
    });
    const { result } = renderHook(() =>
      hooks.useWriteContract({
        beforeSubmission: async () => {
          persisted = true;
          mocks.account.chainId = 8453;
        },
        onBeforeSubmissionAborted,
      }),
    );
    await expect(result.current.writeContractAsync(CALL as never)).rejects.toThrow(
      /chain changed/i,
    );
    expect(persisted).toBe(false);
    expect(onBeforeSubmissionAborted).toHaveBeenCalledOnce();
    expect(mocks.submit).not.toHaveBeenCalled();
  });

  it("holds an identical write whose earlier send has no receipt, before opening another review", async () => {
    const { review, hooks, held } = await freshHarness();
    const reviewer = vi.fn().mockResolvedValue(true);
    review.registerTransactionReviewHandler(reviewer);
    const prompt = vi.fn().mockResolvedValue(false);
    held.registerFlowChoiceHandler(prompt);
    const { result } = renderHook(() => hooks.useWriteContract());

    await act(async () => {
      await result.current.writeContractAsync(CALL as never);
    });
    unseenForThirtyMinutes();
    await expect(result.current.writeContractAsync(CALL as never)).rejects.toThrow(
      WRITE_HOLD_UNCHECKED_LINE,
    );
    expect(prompt).toHaveBeenCalledExactlyOnceWith(
      {
        title: "Check your wallet",
        lines: [
          WRITE_HOLD_UNCHECKED_LINE,
          "If your earlier transaction went through, sending again runs it twice.",
          WRITE_HOLD_HASHED_EXIT_LINE,
        ],
        confirmLabel: "I checked my wallet. Send again",
      },
      expect.any(AbortSignal),
    );
    expect(reviewer).toHaveBeenCalledOnce();
    expect(mocks.simulateContract).toHaveBeenCalledOnce();
    expect(mocks.submit).toHaveBeenCalledOnce();
  });

  it("serializes simultaneous identical submissions before either wallet prompt", async () => {
    let tail = Promise.resolve();
    const lockRequest = vi.fn(
      async (_name: string, _options: unknown, callback: (lock: unknown) => Promise<Hex>) => {
        const previous = tail;
        let release: () => void = () => {};
        tail = new Promise<void>((resolve) => {
          release = resolve;
        });
        await previous;
        try {
          return await callback({});
        } finally {
          release();
        }
      },
    );
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
    expect(lockRequest).toHaveBeenCalled();
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

  it("reports a Safe proposal whose result can't be confirmed as neither loading nor settled", async () => {
    const { activity, hooks } = await freshHarness();
    savedProposal(activity, PROPOSAL, 11155111);
    activity.updateTransactionActivity(`tx:11155111:${PROPOSAL}`, {
      message: UNCONFIRMED,
      safeResultUnconfirmed: true,
    });

    const { result } = renderHook(() => hooks.useWaitForTransactionReceipt({ hash: PROPOSAL }));

    expect(result.current).toMatchObject({
      isLoading: false,
      isSuccess: false,
      isError: false,
      isSafeResultUnconfirmed: true,
      statusMessage: UNCONFIRMED,
    });
  });

  it("persists Safe proposal locks through terminal-history churn and blocks duplicate execution", async () => {
    mocks.account = {
      address: ACCOUNT,
      chainId: 11155111,
      connector: { id: "safe", name: "Safe" },
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("Not found", { status: 404 })),
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
      // The hold that holds the proposal refuses it, as awaiting the Safe.
    ).rejects.toThrow(SAFE_PROPOSAL_AWAITING);
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

  it.each([["succeeded", [executionLog(ACCOUNT, OTHER_PROPOSAL)], "success"]] as const)(
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
      safeExecutionMined(HASH, logs);
      const { review, activity, hooks } = await freshHarness({ followers: true });
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
      // Settled from the chain alone; only the SDK's hold asks Safe's service, for the proposal.
      expect(service.mock.calls.every(([url]) => String(url).includes(HASH))).toBe(true);
    },
  );

  it("keeps a Safe reply whose execution reverted confirming until the hold settles it", async () => {
    mocks.account = {
      address: ACCOUNT,
      chainId: 11155111,
      connector: { id: "safe", name: "Safe" },
    };
    vi.stubGlobal("fetch", vi.fn());
    safeExecutionMined(HASH, [executionLog(ACCOUNT, OTHER_PROPOSAL, "ExecutionFailure")]);
    const { review, activity, hooks } = await freshHarness({ followers: true });
    review.registerTransactionReviewHandler(async () => true);
    const { result } = renderHook(() => hooks.useWriteContract());

    await act(async () => {
      await result.current.writeContractAsync(CALL as never);
    });

    // A revert is final only at a finalized block: never a success, never sent again meanwhile.
    await waitFor(() =>
      expect(activity.transactionActivityForHash(HASH)).toMatchObject({
        kind: "safe",
        status: "safe-proposed",
        message: HELD_CONFIRMING_LINE,
      }),
    );
  });

  it.each([
    [
      "another call",
      executionOf({
        ...TRANSFER_7,
        data: encodeFunctionData({ abi: ABI, functionName: "transfer", args: [RECIPIENT, 8n] }),
      }),
    ],
    ["another Safe's execution", executionOf(TRANSFER_7, OTHER_ACCOUNT)],
    [
      "the single reviewed call wrapped as an unreviewed batch",
      {
        hash: HASH,
        to: ACCOUNT,
        input: encodeFunctionData({
          abi: SAFE_EXEC_ABI,
          functionName: "execTransaction",
          args: [
            MULTI_SEND_CALL_ONLY,
            0n,
            encodeMultiSend([{ ...TRANSFER_7, value: 0n }]),
            1,
            0n,
            0n,
            0n,
            zeroAddress,
            zeroAddress,
            "0x",
          ],
        }),
      },
    ],
    ["no execTransaction", { hash: HASH, to: ACCOUNT, input: TRANSFER_7.data }],
  ])("leaves a reply that executes %s to the hold, never a success", async (_case, execution) => {
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
    const { review, activity, hooks } = await freshHarness({ followers: true });
    review.registerTransactionReviewHandler(async () => true);
    const { result } = renderHook(() => hooks.useWriteContract());

    await act(async () => {
      await result.current.writeContractAsync(CALL as never);
    });

    // The hold decides a reply the chain knows as some other transaction: until it offers its
    // exit, the proposal shows it is being confirmed.
    await waitFor(() =>
      expect(activity.transactionActivityForHash(HASH)).toMatchObject({
        status: "safe-proposed",
        message: HELD_CONFIRMING_LINE,
      }),
    );
    expect(activity.transactionActivityForHash(HASH)?.executionHash).toBeUndefined();
  });

  it("settles a reply journaled without reviewed calls by its Safe's one execution, as on main", async () => {
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

  it("leaves a proposal journaled without reviewed calls that the chain can't show to its account to dismiss", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise(() => undefined)),
    );
    const { activity, hooks } = await freshHarness();
    savedProposal(activity, HASH, 11155111, null);

    hooks.resumeSafeProposalTracking(mocks.config as never);

    // No hold can hold what was never saved: never a success or a resend, only its Dismiss.
    expect(activity.transactionActivityForHash(HASH)).toMatchObject({
      status: "safe-proposed",
      message: WRITE_HOLD_SAFE_UNPROVEN_LINE,
      safeResultUnconfirmed: true,
    });
  });

  it("shows how many of the Safe's owners approved a proposal while it awaits them", async () => {
    mocks.account = {
      address: ACCOUNT,
      chainId: 11155111,
      connector: { id: "safe", name: "Safe" },
    };
    mocks.safeReads = safeChain(ACCOUNT);
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise(() => undefined)),
    );
    mocks.readSafeTransaction = vi.fn(async () => ({ isExecuted: false, confirmations: [] }));
    mocks.usableSafeConfirmations = vi.fn(() => [{ owner: SAFE_OWNER_A }]);
    const { review, activity, hooks } = await freshHarness({ followers: true });
    review.registerTransactionReviewHandler(async () => true);
    const { result } = renderHook(() => hooks.useWriteContract());

    await act(async () => {
      await result.current.writeContractAsync(CALL as never);
    });

    await waitFor(() =>
      expect(activity.transactionActivityForHash(HASH)).toMatchObject({
        status: "safe-proposed",
        message: "Waiting for your Safe's approvals: 1 of 2.",
      }),
    );
  });

  it.each([
    ["no execution event of its Safe", [executionLog(OTHER_ACCOUNT, OTHER_PROPOSAL)]],
    [
      "two execution events of its Safe",
      [executionLog(ACCOUNT, OTHER_PROPOSAL), executionLog(ACCOUNT, PROPOSAL)],
    ],
  ])("keeps an execution held, never unconfirmed, whose receipt has %s", async (_case, logs) => {
    const { activity, hooks } = await freshHarness({ followers: true });
    savedProposal(activity, HASH, 11155420);
    mocks.getTransaction.mockResolvedValue(executionOf({ to: TARGET, data: "0x1234" }));
    mocks.waitForTransactionReceipt.mockResolvedValue({
      status: "success",
      transactionHash: HASH,
      logs,
    });

    hooks.resumeSafeProposalTracking(mocks.config as never);

    // The hold decides: never a success, with no exit while it may still run.
    await waitFor(() =>
      expect(activity.transactionActivityForHash(HASH)).toMatchObject({
        status: "safe-proposed",
        sdkHeld: true,
      }),
    );
    expect(activity.transactionActivityForHash(HASH)?.safeResultUnconfirmed).toBeUndefined();
  });

  it.each([
    ["with", 11155111],
    ["without", 11155420],
  ])(
    "resumes a saved proposal on a chain %s a Safe service through the chain's client",
    async (_service, chainId) => {
      const { activity } = await freshHarness({ followers: true });
      const service = vi.fn();
      vi.stubGlobal("fetch", service);
      safeExecutionMined(HASH, [executionLog(ACCOUNT, OTHER_PROPOSAL)], {
        call: { to: TARGET, data: "0x1234" },
        chainId,
      });
      // Found in the journal on load: its hold follows it from there.
      await act(async () => savedProposal(activity, HASH, chainId));

      await waitFor(() =>
        expect(activity.transactionActivityForHash(HASH)).toMatchObject({
          status: "success",
          executionHash: HASH,
        }),
      );
      // Settled from the chain alone; only the SDK's hold asks Safe's service, for the proposal.
      expect(service.mock.calls.every(([url]) => String(url).includes(HASH))).toBe(true);
    },
  );
});

describe("held wallet writes", () => {
  const VALUE_CALL = { ...CALL, value: 3n };

  it("holds an identical write whose wallet gave no answer until the user says they checked their wallet", async () => {
    const { review, hooks, held } = await freshHarness();
    const reviewer = vi.fn().mockResolvedValue(true);
    review.registerTransactionReviewHandler(reviewer);
    const prompt = vi.fn().mockResolvedValue(false);
    held.registerFlowChoiceHandler(prompt);
    mocks.submit.mockRejectedValueOnce(new Error("Wallet transport timed out"));
    const { result } = renderHook(() => hooks.useWriteContract());

    await expect(result.current.writeContractAsync(CALL as never)).rejects.toThrow("timed out");
    // A reload keeps the hold: the record lives in browser storage.
    const reloaded = await freshHarness();
    reloaded.review.registerTransactionReviewHandler(reviewer);
    reloaded.held.registerFlowChoiceHandler(prompt);
    const next = renderHook(() => reloaded.hooks.useWriteContract()).result;
    await expect(next.current.writeContractAsync(CALL as never)).rejects.toThrow(
      "Your earlier transaction hasn't confirmed yet. Check your wallet.",
    );
    expect(reviewer).toHaveBeenCalledOnce();
    expect(mocks.submit).toHaveBeenCalledOnce();

    prompt.mockResolvedValue(true);
    await act(async () => {
      await expect(next.current.writeContractAsync(CALL as never)).resolves.toBe(HASH);
    });
    expect(prompt).toHaveBeenCalledTimes(2);
    expect(reviewer).toHaveBeenCalledTimes(2);
    expect(mocks.submit).toHaveBeenCalledTimes(2);
  });

  it("says a held write that carries value pays twice if sent again", async () => {
    const { review, hooks, held } = await freshHarness();
    review.registerTransactionReviewHandler(async () => true);
    const prompt = vi.fn().mockResolvedValue(false);
    held.registerFlowChoiceHandler(prompt);
    mocks.submit.mockRejectedValueOnce(new Error("Wallet transport timed out"));
    const { result } = renderHook(() => hooks.useWriteContract());

    await expect(result.current.writeContractAsync(VALUE_CALL as never)).rejects.toThrow();
    await expect(result.current.writeContractAsync(VALUE_CALL as never)).rejects.toThrow(
      /hasn't confirmed yet/,
    );
    expect(prompt).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        lines: [
          "Your earlier transaction hasn't confirmed yet. Check your wallet.",
          "If your earlier transaction went through, sending again pays twice.",
        ],
      }),
      expect.any(AbortSignal),
    );
  });

  it("holds only the exact call: another amount goes straight to review", async () => {
    const { review, hooks, held } = await freshHarness();
    const reviewer = vi.fn().mockResolvedValue(true);
    review.registerTransactionReviewHandler(reviewer);
    const prompt = vi.fn().mockResolvedValue(false);
    held.registerFlowChoiceHandler(prompt);
    mocks.submit.mockRejectedValueOnce(new Error("Wallet transport timed out"));
    const { result } = renderHook(() => hooks.useWriteContract());

    await expect(result.current.writeContractAsync(CALL as never)).rejects.toThrow();
    await act(async () => {
      await result.current.writeContractAsync({ ...CALL, args: [RECIPIENT, 8n] } as never);
    });
    expect(prompt).not.toHaveBeenCalled();
    expect(mocks.submit).toHaveBeenCalledTimes(2);
  });

  it("holds nothing when the account's nonce can't be read before the wallet opens", async () => {
    const { review, hooks, held } = await freshHarness();
    review.registerTransactionReviewHandler(async () => true);
    const prompt = vi.fn().mockResolvedValue(false);
    held.registerFlowChoiceHandler(prompt);
    mocks.getTransactionCount.mockRejectedValueOnce(new Error("RPC down"));
    mocks.getTransactionCount.mockRejectedValueOnce(new Error("RPC down"));
    const { result } = renderHook(() => hooks.useWriteContract());

    await expect(result.current.writeContractAsync(CALL as never)).rejects.toThrow(
      WRITE_HOLD_NONCE_LINE,
    );
    expect(mocks.submit).not.toHaveBeenCalled();
    await act(async () => {
      await result.current.writeContractAsync(CALL as never);
    });
    expect(prompt).not.toHaveBeenCalled();
    expect(mocks.submit).toHaveBeenCalledOnce();
  });

  it("holds nothing after the wallet definitely rejected", async () => {
    const { review, hooks, held } = await freshHarness();
    review.registerTransactionReviewHandler(async () => true);
    const prompt = vi.fn().mockResolvedValue(false);
    held.registerFlowChoiceHandler(prompt);
    mocks.submit.mockRejectedValueOnce(Object.assign(new Error("User rejected"), { code: 4001 }));
    const { result } = renderHook(() => hooks.useWriteContract());

    await expect(result.current.writeContractAsync(CALL as never)).rejects.toThrow("User rejected");
    await act(async () => {
      await result.current.writeContractAsync(CALL as never);
    });
    expect(prompt).not.toHaveBeenCalled();
    expect(mocks.submit).toHaveBeenCalledTimes(2);
  });

  // The receipt reaches the send's own view at once (the SDK's handles of one key share its
  // events), so the next send of the same call goes straight on, however fast the chain is.
  it.each(["at once", "after the send"] as const)(
    "releases the hold once the earlier send's receipt lands (%s)",
    async (timing) => {
      const { review, activity, hooks, held } = await freshHarness();
      review.registerTransactionReviewHandler(async () => true);
      const prompt = vi.fn().mockResolvedValue(false);
      held.registerFlowChoiceHandler(prompt);
      const lands = receiptLands(timing);
      const { result } = renderHook(() => hooks.useWriteContract());

      await act(async () => {
        await result.current.writeContractAsync(CALL as never);
      });
      await act(async () => lands());
      await waitFor(() =>
        expect(activity.transactionActivityForHash(HASH)).toMatchObject({ status: "success" }),
      );
      await act(async () => {
        await result.current.writeContractAsync(CALL as never);
      });
      expect(prompt).not.toHaveBeenCalled();
      expect(mocks.submit).toHaveBeenCalledTimes(2);
    },
  );

  it("sends nothing again when the send itself finds the earlier attempt went through", async () => {
    const { review, hooks, held } = await freshHarness();
    const { withWriteIntent } = await import("@/lib/write-hold");
    review.registerTransactionReviewHandler(async () => true);
    const prompt = vi.fn().mockResolvedValue(false);
    held.registerFlowChoiceHandler(prompt);
    const { result } = renderHook(() => hooks.useWriteContract());
    const launch = () =>
      withWriteIntent(result.current.writeContractAsync, "intent:launch:test")(CALL as never);

    await act(async () => {
      await launch();
    });
    // The page lost its completion; the earlier attempt confirms while the retry checks it.
    chainMines();
    await expect(launch()).rejects.toThrow(HELD_AWAY_SUCCESS_LINE);
    expect(mocks.submit).toHaveBeenCalledOnce();
    // That settlement was shown: a deliberate later send goes through.
    await act(async () => {
      await launch();
    });
    expect(mocks.submit).toHaveBeenCalledTimes(2);
  });

  it("asks before sending again what went through while the page was closed, and sends once on Send it again", async () => {
    const before = await freshHarness();
    before.review.registerTransactionReviewHandler(async () => true);
    const first = renderHook(() => before.hooks.useWriteContract());
    await act(async () => {
      await first.result.current.writeContractAsync(CALL as never);
    });
    // The page closes; while no page is open, the chain shows it went through and another
    // window's SDK saves that.
    cleanup();
    chainMines();
    const { writeHolds } = await import("@/lib/write-hold");
    const { getPublicClient } = await import("wagmi/actions");
    const chain = getPublicClient(mocks.config as never, { chainId: 11155111 } as never);
    await writeHolds
      .open({
        chainId: 11155111,
        account: ACCOUNT,
        safe: false,
        call: { to: TARGET, data: TRANSFER_7.data, value: 0n },
      })
      .state(chain as never);

    // A reload.
    const { review, hooks, held } = await freshHarness();
    review.registerTransactionReviewHandler(async () => true);
    const prompt = vi.fn().mockResolvedValue(false);
    held.registerFlowChoiceHandler(prompt);
    const { result } = renderHook(() => hooks.useWriteContract());

    await expect(result.current.writeContractAsync(CALL as never)).rejects.toThrow(
      HELD_AWAY_SUCCESS_LINE,
    );
    expect(prompt).toHaveBeenCalledWith(
      expect.objectContaining({
        lines: [HELD_AWAY_SUCCESS_LINE],
        confirmLabel: HELD_SEND_AGAIN_LABEL,
      }),
    );
    expect(mocks.submit).toHaveBeenCalledOnce();

    prompt.mockResolvedValue(true);
    await act(async () => {
      await result.current.writeContractAsync(CALL as never);
    });
    expect(mocks.submit).toHaveBeenCalledTimes(2);
  });

  it("tells a write that settles after a reload in its row, so the next send goes straight on", async () => {
    const before = await freshHarness({ followers: true });
    before.review.registerTransactionReviewHandler(async () => true);
    const first = renderHook(() => before.hooks.useWriteContract());
    await act(async () => {
      await first.result.current.writeContractAsync(CALL as never);
    });
    cleanup();

    // A reload, after which the chain shows it went through: the row says so.
    const { review, activity, hooks, held } = await freshHarness({ followers: true });
    review.registerTransactionReviewHandler(async () => true);
    chainMines();
    await waitFor(
      () =>
        expect(activity.transactionActivityForHash(HASH)).toMatchObject({
          status: "success",
          message: "Confirmed onchain.",
        }),
      { timeout: 8_000 },
    );
    const prompt = vi.fn().mockResolvedValue(false);
    held.registerFlowChoiceHandler(prompt);
    const { result } = renderHook(() => hooks.useWriteContract());
    await act(async () => {
      await result.current.writeContractAsync(CALL as never);
    });
    expect(prompt).not.toHaveBeenCalled();
    expect(mocks.submit).toHaveBeenCalledTimes(2);
  }, 15_000);

  it("leaves a write whose caller owns its recovery to that caller", async () => {
    const { review, hooks, held } = await freshHarness();
    review.registerTransactionReviewHandler(async () => true);
    const prompt = vi.fn().mockResolvedValue(false);
    held.registerFlowChoiceHandler(prompt);
    mocks.submit.mockRejectedValueOnce(new Error("Wallet transport timed out"));
    const { result } = renderHook(() =>
      hooks.useWriteContract({ recovery: "caller", beforeSubmission: async () => undefined }),
    );

    await expect(result.current.writeContractAsync(CALL as never)).rejects.toThrow();
    await act(async () => {
      await result.current.writeContractAsync(CALL as never);
    });
    expect(prompt).not.toHaveBeenCalled();
    expect(mocks.submit).toHaveBeenCalledTimes(2);
  });
});

describe("held wallet writes: fix round 1", () => {
  it("holds in this tab's memory and says so in the review when the browser refuses storage", async () => {
    const { review, hooks, held } = await freshHarness();
    const reviews: string[] = [];
    review.registerTransactionReviewHandler(async (request) => {
      reviews.push(String(request.description ?? ""));
      return true;
    });
    const prompt = vi.fn().mockResolvedValue(false);
    held.registerFlowChoiceHandler(prompt);
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("Refused", "SecurityError");
    });
    mocks.submit.mockRejectedValueOnce(new Error("Wallet transport timed out"));
    const { result } = renderHook(() => hooks.useWriteContract());

    await expect(result.current.writeContractAsync(CALL as never)).rejects.toThrow("timed out");
    expect(reviews[0]).toContain(
      "This browser can't remember pending transactions. Check your wallet before repeating one.",
    );
    expect(mocks.submit).toHaveBeenCalledOnce();
    await expect(result.current.writeContractAsync(CALL as never)).rejects.toThrow(
      /hasn't confirmed yet/,
    );
    expect(prompt).toHaveBeenCalledOnce();
    expect(mocks.submit).toHaveBeenCalledOnce();
  });

  it("offers no resend while the earlier transaction is known to be pending", async () => {
    const { review, hooks, held } = await freshHarness();
    review.registerTransactionReviewHandler(async () => true);
    const prompt = vi.fn().mockResolvedValue(true);
    held.registerFlowChoiceHandler(prompt);
    const { result } = renderHook(() => hooks.useWriteContract());
    await act(async () => {
      await result.current.writeContractAsync(CALL as never);
    });
    mocks.getTransaction.mockResolvedValue({ ...MINED_TX, blockNumber: null, blockHash: null });

    await expect(result.current.writeContractAsync(CALL as never)).rejects.toThrow(
      WRITE_HOLD_PENDING_LINE,
    );
    expect(prompt).not.toHaveBeenCalled();
    expect(mocks.submit).toHaveBeenCalledOnce();
  });

  it("does not send again when the earlier transaction confirms as the user accepts the exit", async () => {
    const { review, hooks, held } = await freshHarness();
    review.registerTransactionReviewHandler(async () => true);
    // The node does not know the hash when the exit is offered, then shows it mined.
    held.registerFlowChoiceHandler(async () => {
      chainMines();
      return true;
    });
    const { result } = renderHook(() => hooks.useWriteContract());
    await act(async () => {
      await result.current.writeContractAsync(CALL as never);
    });
    unseenForThirtyMinutes();

    await expect(result.current.writeContractAsync(CALL as never)).rejects.toThrow(
      HELD_SUCCESS_LINE,
    );
    expect(mocks.submit).toHaveBeenCalledOnce();
  });

  it("closes the exit when the earlier transaction confirms while it is open", async () => {
    const { review, hooks, held } = await freshHarness();
    review.registerTransactionReviewHandler(async () => true);
    let opened = false;
    held.registerFlowChoiceHandler(
      (_choice, signal) =>
        new Promise<boolean>((resolve) => {
          opened = true;
          signal?.addEventListener("abort", () => resolve(false));
        }),
    );
    const { result } = renderHook(() => hooks.useWriteContract());
    await act(async () => {
      await result.current.writeContractAsync(CALL as never);
    });

    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"], shouldAdvanceTime: true });
    vi.setSystemTime(Date.now() + 31 * 60_000);
    const second = result.current.writeContractAsync(CALL as never);
    await waitFor(() => expect(opened).toBe(true));
    chainMines();
    const closed = expect(second).rejects.toThrow(HELD_SUCCESS_LINE);
    // The SDK's next look while the exit is open.
    await vi.advanceTimersByTimeAsync(HELD_POLL_MS);
    await closed;
    expect(mocks.submit).toHaveBeenCalledOnce();
  });
});

describe("a send whose receipt watch gives up", () => {
  /** wagmi's watch ended at its timeout with no receipt. */
  const watchGaveUp = () =>
    mocks.wagmiReceipt.mockReturnValue({
      data: undefined,
      error: new WaitForTransactionReceiptTimeoutError({ hash: HASH }),
      isError: true,
      isLoading: false,
      isSuccess: false,
    });
  /** Let the hold's reads answer (only interval timers and the clock are faked here). */
  const flush = () =>
    act(async () => {
      for (let i = 0; i < 20; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
    });

  it("shows the hold's line and keeps watching it, so the exit appears without reopening and sends exactly once more", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] });
    const { review, hooks, held } = await freshHarness();
    review.registerTransactionReviewHandler(async () => true);
    const prompt = vi.fn().mockResolvedValue(true);
    held.registerFlowChoiceHandler(prompt);
    const { result } = renderHook(() => hooks.useWriteContract());
    await act(async () => {
      await result.current.writeContractAsync(CALL as never);
    });
    watchGaveUp();

    const receipt = renderHook(() =>
      hooks.useWaitForTransactionReceipt({ hash: HASH, chainId: 11155111, timeout: 120_000 }),
    );
    await flush();
    expect(receipt.result.current.heldLine).toBe(HELD_CONFIRMING_LINE);
    expect(receipt.result.current.isUnconfirmed).toBe(true);

    // Half an hour with the hash unknown to the node: the next minute's look offers the exit.
    vi.setSystemTime(Date.now() + 31 * 60_000);
    await act(async () => {
      vi.advanceTimersByTime(60_000);
    });
    await flush();
    expect(receipt.result.current.heldLine).toBe(WRITE_HOLD_UNCHECKED_LINE);
    expect(receipt.result.current.isUnconfirmed).toBe(false);

    await act(async () => {
      await result.current.writeContractAsync(CALL as never);
    });
    expect(prompt).toHaveBeenCalledOnce();
    expect(mocks.submit).toHaveBeenCalledTimes(2);
  });

  it("never takes another attempt's settlement as its own", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] });
    const { review, activity, hooks, held } = await freshHarness();
    review.registerTransactionReviewHandler(async () => true);
    held.registerFlowChoiceHandler(vi.fn().mockResolvedValue(true));
    const { result } = renderHook(() => hooks.useWriteContract());
    await act(async () => {
      await result.current.writeContractAsync(CALL as never);
    });
    watchGaveUp();
    const receipt = renderHook(() =>
      hooks.useWaitForTransactionReceipt({ hash: HASH, chainId: 11155111, timeout: 120_000 }),
    );
    await flush();

    // Its hash never lands; after the exit, the same call is sent again and that send mines.
    vi.setSystemTime(Date.now() + 31 * 60_000);
    const RESENT = `0x${"9a".repeat(32)}` as Hex;
    mocks.submit.mockResolvedValue(RESENT);
    await act(async () => {
      await result.current.writeContractAsync(CALL as never);
    });
    mocks.getTransaction.mockImplementation(async ({ hash }: { hash: Hex }) => {
      if (hash !== RESENT) throw new TransactionNotFoundError({ hash });
      return { ...MINED_TX, hash: RESENT };
    });
    mocks.getTransactionReceipt.mockImplementation(async ({ hash }: { hash: Hex }) => {
      if (hash !== RESENT) throw new TransactionReceiptNotFoundError({ hash });
      return { ...MINED_RECEIPT, transactionHash: RESENT };
    });
    await act(async () => {
      vi.advanceTimersByTime(60_000);
    });
    await flush();

    expect(receipt.result.current.isSuccess).toBe(false);
    expect(activity.transactionActivityForHash(HASH)?.status).not.toBe("success");
  });

  it("shows the hold's notice with its line while holds last only in this tab", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] });
    const { review, hooks } = await freshHarness();
    review.registerTransactionReviewHandler(async () => true);
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("Refused", "SecurityError");
    });
    const { result } = renderHook(() => hooks.useWriteContract());
    await act(async () => {
      await result.current.writeContractAsync(CALL as never);
    });
    watchGaveUp();
    const receipt = renderHook(() =>
      hooks.useWaitForTransactionReceipt({ hash: HASH, chainId: 11155111, timeout: 120_000 }),
    );
    await flush();
    expect(receipt.result.current.heldLine).toBe(
      `${HELD_CONFIRMING_LINE} This browser can't remember pending transactions. Check your wallet before repeating one.`,
    );
  });

  it("settles from the hold when the receipt lands after the watch gave up", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] });
    const { review, activity, hooks } = await freshHarness();
    review.registerTransactionReviewHandler(async () => true);
    const { result } = renderHook(() => hooks.useWriteContract());
    await act(async () => {
      await result.current.writeContractAsync(CALL as never);
    });
    watchGaveUp();
    const receipt = renderHook(() =>
      hooks.useWaitForTransactionReceipt({ hash: HASH, chainId: 11155111, timeout: 120_000 }),
    );
    await flush();
    expect(receipt.result.current.isUnconfirmed).toBe(true);

    chainMines();
    await act(async () => {
      vi.advanceTimersByTime(60_000);
    });
    await flush();
    expect(receipt.result.current.isSuccess).toBe(true);
    expect(receipt.result.current).toMatchObject({ isUnconfirmed: false, heldLine: undefined });
    expect(activity.transactionActivityForHash(HASH)).toMatchObject({ status: "success" });
  });
});

describe("Safe proposals under the write hold", () => {
  const OTHER_HASH = `0x${"78".repeat(32)}` as Hex;
  beforeEach(() => {
    mocks.account = {
      address: ACCOUNT,
      chainId: 11155111,
      connector: { id: "safe", name: "Safe" },
    };
  });
  /** The reviewed transfer proposed at Safe nonce 7. */
  const TRANSFER_7_AT_7 = safeTransactionHash(11155111, ACCOUNT, safeProposalFor(TRANSFER_7, 7));
  const transferKey = (activity: typeof import("@/lib/transaction-activity")) =>
    activity.contractTransactionKey(ACCOUNT, 11155111, { ...CALL, data: TRANSFER_7.data });
  /** The SDK's hold of the reviewed single call proposed to the connected Safe. */
  const holdOfTransfer = async () =>
    (await import("@/lib/write-hold")).writeHolds.open({
      chainId: 11155111,
      account: ACCOUNT,
      safe: true,
      call: { to: TARGET, data: TRANSFER_7.data, value: 0n },
    });

  // The Safe flow rule: only the hold's authenticated settlement, or the user's exit, ends the
  // follower; until the hold offers its exit, the proposal shows it is being confirmed.
  it("shows a Safe execution's success only once the hold settles it, confirming until then", async () => {
    vi.useFakeTimers();
    const EXECUTION = `0x${"56".repeat(32)}` as Hex;
    const { activity, hooks } = await freshHarness({ followers: true });
    savedProposal(activity, PROPOSAL, 11155111);
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              ...PROPOSED,
              safe: ACCOUNT,
              isExecuted: true,
              transactionHash: EXECUTION,
            }),
          ),
      ),
    );
    // The follower reads the Safe's success event, but the chain can't yet show the hold the
    // execution's transaction.
    const { receipt } = safeExecutionMined(EXECUTION, [executionLog(ACCOUNT, PROPOSAL)], {
      call: { to: TARGET, data: "0x1234" },
    });
    mocks.getTransactionReceipt.mockRejectedValue(new Error("Receipt not found"));
    mocks.waitForTransactionReceipt.mockResolvedValue(receipt);

    hooks.resumeSafeProposalTracking(mocks.config as never);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(activity.transactionActivityForHash(PROPOSAL)).toMatchObject({
      status: "safe-proposed",
      message: HELD_CONFIRMING_LINE,
    });

    // A reload never goes back to awaiting: the hold keeps deciding, and settles it.
    await freshHarness();
    hooks.resumeSafeProposalTracking(mocks.config as never);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(activity.transactionActivityForHash(PROPOSAL)?.message).toBe(HELD_CONFIRMING_LINE);
    mocks.getTransactionReceipt.mockResolvedValue(receipt);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(activity.transactionActivityForHash(PROPOSAL)).toMatchObject({
      status: "success",
      executionHash: EXECUTION,
    });
  });

  it("holds a proposal the Safe gave no hash for, and asks for the exit before proposing again", async () => {
    const { review, hooks, held } = await freshHarness();
    review.registerTransactionReviewHandler(async () => true);
    const prompt = vi.fn().mockResolvedValue(false);
    held.registerFlowChoiceHandler(prompt);
    mocks.submit.mockRejectedValueOnce(new Error("Safe app transport timed out"));
    const { result } = renderHook(() => hooks.useWriteContract());

    await expect(result.current.writeContractAsync(CALL as never)).rejects.toThrow("timed out");
    await expect(result.current.writeContractAsync(CALL as never)).rejects.toThrow(
      "Your earlier transaction hasn't confirmed yet. Check your wallet.",
    );
    expect(prompt).toHaveBeenCalledOnce();
    expect(mocks.submit).toHaveBeenCalledOnce();

    prompt.mockResolvedValue(true);
    await act(async () => {
      await result.current.writeContractAsync(CALL as never);
    });
    expect(mocks.submit).toHaveBeenCalledTimes(2);
  });

  it("lets the hold's exit through for a proposal its journal still lists, once the hold offers it, and releases the listed one on it", async () => {
    // Its nonce can't be authenticated, Safe's service never answers, and the chain knows no hash.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("Not found", { status: 404 })),
    );
    const { review, activity, hooks, held } = await freshHarness();
    review.registerTransactionReviewHandler(async () => true);
    const prompt = vi.fn().mockResolvedValue(false);
    held.registerFlowChoiceHandler(prompt);
    const { result } = renderHook(() => hooks.useWriteContract());
    await act(async () => {
      await result.current.writeContractAsync(CALL as never);
    });
    expect(activity.transactionActivityForHash(HASH)).toMatchObject({ status: "safe-proposed" });

    // While the hold says it is awaiting the Safe, a resend is refused, by the hold.
    await expect(result.current.writeContractAsync(CALL as never)).rejects.toThrow();
    expect(mocks.submit).toHaveBeenCalledOnce();

    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + 31 * 60_000);
    prompt.mockResolvedValue(true);
    const OTHER = `0x${"9b".repeat(32)}` as Hex;
    mocks.submit.mockResolvedValue(OTHER);
    await act(async () => {
      await expect(result.current.writeContractAsync(CALL as never)).resolves.toBe(OTHER);
    });
    expect(prompt).toHaveBeenCalledOnce();
    expect(mocks.submit).toHaveBeenCalledTimes(2);
    // The proposal the exit replaced no longer refuses anything.
    expect(activity.transactionActivityForHash(HASH)?.status).not.toBe("safe-proposed");
  });

  it("shows a proposal the exit released as released, and the new one once it is submitted", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("Not found", { status: 404 })),
    );
    const { review, activity, hooks, held } = await freshHarness({ followers: true });
    const reviewer = vi.fn().mockResolvedValue(true);
    review.registerTransactionReviewHandler(reviewer);
    held.registerFlowChoiceHandler(vi.fn().mockResolvedValue(true));
    const { result } = renderHook(() => hooks.useWriteContract());
    await act(async () => {
      await result.current.writeContractAsync(CALL as never);
    });
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + 31 * 60_000);

    // The user takes the exit, then closes the review: nothing is sent.
    reviewer.mockResolvedValueOnce(false);
    await act(async () => {
      await expect(result.current.writeContractAsync(CALL as never)).rejects.toThrow();
    });
    expect(mocks.submit).toHaveBeenCalledOnce();
    // Released, never a result or a resend claim.
    await waitFor(() =>
      expect(activity.transactionActivityForHash(HASH)).toMatchObject({ status: "failed" }),
    );
    expect(activity.transactionActivityForHash(HASH)?.message).not.toMatch(/went through/);

    const OTHER = `0x${"9c".repeat(32)}` as Hex;
    mocks.submit.mockResolvedValue(OTHER);
    await act(async () => {
      await expect(result.current.writeContractAsync(CALL as never)).resolves.toBe(OTHER);
    });
    expect(activity.transactionActivityForHash(OTHER)).toMatchObject({ status: "safe-proposed" });
  });

  it("tells the hold when the watch ends a proposal unproven, so the exit survives a reload", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("Not found", { status: 404 })),
    );
    const { review, activity, hooks } = await freshHarness({ followers: true });
    review.registerTransactionReviewHandler(async () => true);
    const { result } = renderHook(() => hooks.useWriteContract());
    await act(async () => {
      await result.current.writeContractAsync(CALL as never);
    });
    await vi.advanceTimersByTimeAsync(HOUR + 2 * 60_000);
    expect(activity.transactionActivityForHash(HASH)).toMatchObject({
      safeResultUnconfirmed: true,
    });

    // A reload: this page's followers go with it.
    cleanup();
    await freshHarness();
    cleanup();
    // Only the hold's gate offers the exit (SDK 2.34.1): after a reload it still does.
    const hold = await holdOfTransfer();
    expect(hold.peek()).toMatchObject({ exit: false });
    const { getPublicClient } = await import("wagmi/actions");
    const chain = getPublicClient(mocks.config as never, { chainId: 11155111 } as never);
    // Asked once any read the closed page left has let go of the call's lock.
    vi.useRealTimers();
    await waitFor(async () =>
      expect(await hold.state(chain as never)).toMatchObject({ exit: true }),
    );
    // An hour of the watch on fake timers: give a loaded machine room.
  }, 30_000);

  it("moves an unconfirmed proposal saved before the hold held it into the hold on load, which holds its resend", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("Not found", { status: 404 })),
    );
    const { review, activity, hooks, held } = await freshHarness({ followers: true });
    review.registerTransactionReviewHandler(async () => true);
    const prompt = vi.fn().mockResolvedValue(false);
    held.registerFlowChoiceHandler(prompt);
    savedProposal(activity, HASH, 11155111, TRANSFER_7);
    activity.updateTransactionActivity(`tx:11155111:${HASH}`, {
      safeResultUnconfirmed: true,
      callKey: transferKey(activity),
    });
    hooks.resumeSafeProposalTracking(mocks.config as never);
    await waitFor(() =>
      expect(activity.transactionActivityForHash(HASH)).toMatchObject({ sdkHeld: true }),
    );
    const { result } = renderHook(() => hooks.useWriteContract());

    await expect(result.current.writeContractAsync(CALL as never)).rejects.toThrow();
    expect(mocks.submit).not.toHaveBeenCalled();
  });

  it("holds a replaced proposal saved before the hold held it, with its saved hash and nonce, so it needs the exit", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("Not found", { status: 404 })),
    );
    const { review, activity, hooks, held } = await freshHarness({ followers: true });
    review.registerTransactionReviewHandler(async () => true);
    const prompt = vi.fn().mockResolvedValue(false);
    held.registerFlowChoiceHandler(prompt);
    savedProposal(activity, TRANSFER_7_AT_7, 11155111, TRANSFER_7);
    activity.updateTransactionActivity(`tx:11155111:${TRANSFER_7_AT_7}`, {
      status: "failed",
      message: "Another Safe transaction used this nonce. Propose it again to run it.",
      safeProposalNonce: "7",
      callKey: transferKey(activity),
    });
    hooks.resumeSafeProposalTracking(mocks.config as never);
    await waitFor(async () =>
      expect((await holdOfTransfer()).peek()).toMatchObject({ record: { safeNonce: "7" } }),
    );
    const { result } = renderHook(() => hooks.useWriteContract());

    await expect(result.current.writeContractAsync(CALL as never)).rejects.toThrow();
    expect(mocks.submit).not.toHaveBeenCalled();
    expect((await holdOfTransfer()).peek()).toMatchObject({
      record: { hash: TRANSFER_7_AT_7.toLowerCase(), safeNonce: "7" },
    });
  });

  it("gives the hold the proposal's Safe nonce when proposing, one call or a batch", async () => {
    mocks.safeReads = safeChain(ACCOUNT, { nonce: 7n });
    const { review, hooks } = await freshHarness();
    review.registerTransactionReviewHandler(async () => true);
    mocks.submit.mockResolvedValue(TRANSFER_7_AT_7);
    const { result } = renderHook(() => hooks.useWriteContract());
    await act(async () => {
      await result.current.writeContractAsync(CALL as never);
    });
    expect((await holdOfTransfer()).peek()).toMatchObject({ record: { safeNonce: "7" } });

    // Not led by the single call above: the SDK holds a batch by its first call too.
    const calls = [
      { address: TARGET, abi: ABI, functionName: "transfer", args: [RECIPIENT, 9n] },
      { address: TARGET, abi: ABI, functionName: "transfer", args: [RECIPIENT, 8n] },
    ] as const;
    const encoded = calls.map((call) => ({
      to: call.address,
      value: 0n,
      data: encodeFunctionData({ abi: ABI, functionName: "transfer", args: call.args }),
    }));
    mocks.sendCalls.mockResolvedValue({
      id: safeTransactionHash(11155111, ACCOUNT, safeBatchProposalFor(encoded, 7)),
    });
    await renderHook(() => hooks.useProposeSafeBatch()).result.current(
      mocks.config as never,
      11155111,
      "Two",
      calls as never,
    );
    // The batch is held as its one MultiSend call, the SDK's batch identity.
    const { safeHoldOf } = await import("@/lib/write-hold");
    expect(
      safeHoldOf(11155111, {
        safe: ACCOUNT,
        calls: encoded.map((call) => ({ ...call, value: "0" })),
        batch: true,
      }).peek(),
    ).toMatchObject({
      record: { safeNonce: "7", call: { to: MULTI_SEND_CALL_ONLY.toLowerCase() } },
    });
  });

  it("never offers the exit for a Safe reply that is an execution still pending", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("Not found", { status: 404 })),
    );
    const { review, activity, hooks } = await freshHarness();
    review.registerTransactionReviewHandler(async () => true);
    // Safe{Wallet} executed at once: its reply is the execution, which stays in the mempool.
    mocks.getTransaction.mockResolvedValue({
      ...executionOf(TRANSFER_7),
      blockNumber: null,
      blockHash: null,
    });
    mocks.waitForTransactionReceipt.mockRejectedValue(new Error("Timed out"));
    mocks.getTransactionReceipt.mockRejectedValue(
      new TransactionReceiptNotFoundError({ hash: HASH }),
    );
    const { result } = renderHook(() => hooks.useWriteContract());
    await act(async () => {
      await result.current.writeContractAsync(CALL as never);
    });
    // An earlier load first found it with no receipt an hour ago.
    activity.updateTransactionActivity(`tx:11155111:${HASH}`, {
      executionHash: HASH,
      executionSeenAt: Date.now() - HOUR,
    });
    await vi.advanceTimersByTimeAsync(5 * 60_000);

    const { getPublicClient } = await import("wagmi/actions");
    const chain = getPublicClient(mocks.config as never, { chainId: 11155111 } as never);
    // The SDK's one exit gate asks the chain: a pending execution keeps no exit.
    const now = await (await holdOfTransfer()).state(chain as never);
    expect(now).toMatchObject({ exit: false });
  });
  it("holds a batch the Safe gave no answer for, and asks for the exit before proposing it again", async () => {
    const { review, hooks, held } = await freshHarness();
    review.registerTransactionReviewHandler(async () => true);
    const prompt = vi.fn().mockResolvedValue(false);
    held.registerFlowChoiceHandler(prompt);
    mocks.sendCalls.mockRejectedValueOnce(new Error("Safe app transport timed out"));
    const calls = [
      { address: TARGET, abi: ABI, functionName: "transfer", args: [RECIPIENT, 7n] },
      { address: TARGET, abi: ABI, functionName: "transfer", args: [RECIPIENT, 8n] },
    ] as const;
    const propose = () =>
      renderHook(() => hooks.useProposeSafeBatch()).result.current(
        mocks.config as never,
        11155111,
        "Two transfers",
        calls as never,
      );

    await expect(propose()).rejects.toThrow("timed out");
    await expect(propose()).rejects.toThrow(
      "Your earlier transaction hasn't confirmed yet. Check your wallet.",
    );
    expect(prompt).toHaveBeenCalledOnce();
    expect(mocks.sendCalls).toHaveBeenCalledOnce();

    prompt.mockResolvedValue(true);
    mocks.sendCalls.mockResolvedValue({ id: OTHER_HASH });
    await expect(propose()).resolves.toBe(OTHER_HASH);
    expect(mocks.sendCalls).toHaveBeenCalledTimes(2);
  });
});

describe("holds keyed by the SDK's intents", () => {
  const LP_ABI = parseAbi([
    "function modifyLiquidities(bytes unlockData, uint256 deadline) payable",
    "function approve(address token, address spender, uint160 amount, uint48 expiration)",
  ]);
  const POOL = `0x${"7a".repeat(32)}` as Hex;
  const SUCKER = "0x0000000000000000000000000000000000004000" as Address;
  const OTHER_TARGET = "0x0000000000000000000000000000000000003000" as Address;
  const lostOnce = async () => {
    const { review, hooks, held } = await freshHarness();
    const holds = await import("@/lib/write-hold");
    review.registerTransactionReviewHandler(async () => true);
    const prompt = vi.fn().mockResolvedValue(false);
    held.registerFlowChoiceHandler(prompt);
    mocks.submit.mockRejectedValueOnce(new Error("Wallet transport timed out"));
    const { result } = renderHook(() => hooks.useWriteContract());
    return { holds, prompt, write: result.current.writeContractAsync };
  };

  // Each user action, held by its SDK intent: a retry whose calldata the app built again (a new
  // quote, deadline, route or fee) is refused until the exit, and the exit sends it once more.
  it.each([
    [
      "a payment (a checkout emptied into a pay, a new route)",
      payIntent({ chainId: 11155111, project: 7n, beneficiary: ACCOUNT }),
    ],
    [
      "a cash out (another venue)",
      cashOutIntent({ chainId: 11155111, project: 7n, holder: ACCOUNT, beneficiary: ACCOUNT }),
    ],
    ["a repay or reallocation (an accrued ceiling)", loanIntent({ chainId: 11155111, loanId: 5n })],
    ["a borrow (a fresh quote)", borrowIntent({ chainId: 11155111, project: 7n, holder: ACCOUNT })],
    [
      "a bridge send, prepare or sync (a fresh fee)",
      bridgeIntent({ chainId: 11155111, sucker: SUCKER, token: TARGET, account: ACCOUNT }),
    ],
    [
      "an approval step (a calculated amount)",
      approvalIntent(payIntent({ chainId: 11155111, project: 7n, beneficiary: ACCOUNT }), {
        step: "erc20",
        token: TARGET,
        spender: RECIPIENT,
      }),
    ],
    [
      "a launch (a fresh salt and stage start)",
      launchIntent({ chainId: 11155111, account: ACCOUNT, config: { name: "Rev" } }),
    ],
    [
      "a liquidity change (a fresh deadline and limits)",
      liquidityIntent({ chainId: 11155111, pool: POOL, positions: [5n] }),
    ],
  ])("%s: a retry after a lost reply is refused until the exit", async (_action, namespace) => {
    const { holds, prompt, write } = await lostOnce();
    const send = (minimum: bigint, address: Address = TARGET) =>
      holds.withWriteIntent(
        write,
        namespace,
      )({
        ...CALL,
        address,
        args: [RECIPIENT, minimum] as const,
      } as never);
    await expect(send(7n)).rejects.toThrow("timed out");
    await expect(send(8n, OTHER_TARGET)).rejects.toThrow(/hasn't confirmed yet/);
    expect(prompt).toHaveBeenCalledOnce();
    expect(mocks.submit).toHaveBeenCalledOnce();

    prompt.mockResolvedValue(true);
    await act(async () => {
      await send(9n);
    });
    expect(mocks.submit).toHaveBeenCalledTimes(2);
  });

  // The legacy matcher (target and selector) skips other intents' mirrors (SDK 2.38.1).
  it("holds another position's liquidity change apart from this one", async () => {
    const { holds, prompt, write } = await lostOnce();
    // Each position's change is its own calldata.
    const change = (positions: bigint[]) =>
      holds.withWriteIntent(
        write,
        liquidityIntent({ chainId: 11155111, pool: POOL, positions }),
      )({ ...CALL, args: [RECIPIENT, positions[0]] } as never);
    await expect(change([2n])).rejects.toThrow("timed out");
    await act(async () => {
      await change([1n]);
    });
    expect(prompt).not.toHaveBeenCalled();
    expect(mocks.submit).toHaveBeenCalledTimes(2);
  });

  it("refuses a named retry while an exact-calldata hold from before intent keys holds an earlier attempt, until the exit", async () => {
    const { review, hooks, held } = await freshHarness();
    const { withWriteIntent, writeHolds } = await import("@/lib/write-hold");
    review.registerTransactionReviewHandler(async () => true);
    const prompt = vi.fn().mockResolvedValue(false);
    held.registerFlowChoiceHandler(prompt);
    // A cash out sent before intent keys: held by its exact calldata, with no wallet answer.
    const { getPublicClient } = await import("wagmi/actions");
    const chain = getPublicClient(mocks.config as never, { chainId: 11155111 } as never);
    await writeHolds
      .open({
        chainId: 11155111,
        account: ACCOUNT,
        safe: false,
        call: { to: TARGET, data: TRANSFER_7.data, value: 0n },
      })
      .send(chain as never, async (gate) => {
        await gate.beforeSend();
        throw new Error("Wallet transport timed out");
      })
      .catch(() => undefined);
    const { result } = renderHook(() => hooks.useWriteContract());
    const cashOut = () =>
      withWriteIntent(
        result.current.writeContractAsync,
        cashOutIntent({ chainId: 11155111, project: 7n, holder: ACCOUNT, beneficiary: ACCOUNT }),
      )({
        ...CALL,
        // Its quoted minimum, read again.
        args: [RECIPIENT, 8n] as const,
      } as never);

    await expect(cashOut()).rejects.toThrow(/hasn't confirmed yet/);
    expect(prompt).toHaveBeenCalledOnce();
    expect(mocks.submit).not.toHaveBeenCalled();

    prompt.mockResolvedValue(true);
    await act(async () => {
      await cashOut();
    });
    expect(mocks.submit).toHaveBeenCalledOnce();
  });

  it("refuses a Safe batch retry whose expiration and deadline were stamped again, until the exit", async () => {
    mocks.account = {
      address: ACCOUNT,
      chainId: 11155111,
      connector: { id: "safe", name: "Safe" },
    };
    const { review, hooks, held } = await freshHarness();
    review.registerTransactionReviewHandler(async () => true);
    const prompt = vi.fn().mockResolvedValue(false);
    held.registerFlowChoiceHandler(prompt);
    mocks.sendCalls.mockRejectedValueOnce(new Error("Safe app transport timed out"));
    const batch = (at: bigint) => [
      {
        address: RECIPIENT,
        abi: LP_ABI,
        functionName: "approve",
        args: [TARGET, TARGET, 5n, Number(at)],
      },
      {
        chainId: 11155111,
        address: TARGET,
        abi: LP_ABI,
        functionName: "modifyLiquidities",
        args: ["0x1234", at],
        dependsOnPrior: true,
      },
    ];
    const propose = (at: bigint) =>
      renderHook(() => hooks.useProposeSafeBatch()).result.current(
        mocks.config as never,
        11155111,
        "Add liquidity",
        batch(at) as never,
        undefined,
        liquidityIntent({ chainId: 11155111, pool: POOL, positions: [] }),
      );

    await expect(propose(1_000n)).rejects.toThrow("timed out");
    await expect(propose(2_000n)).rejects.toThrow(/hasn't confirmed yet/);
    expect(prompt).toHaveBeenCalledOnce();
    expect(mocks.sendCalls).toHaveBeenCalledOnce();
  });
});

// REMOVE WITH src/lib/legacy-intents.ts: attempts the build before SDK 2.38's builders saved.
describe("attempts held under the previous build's intent namespaces", () => {
  /** Leave a write held the way origin/main did: under `namespace`, with no wallet answer. */
  async function heldByMain(namespace: string, call: { to: Address; data: Hex }, safe = false) {
    const { writeHolds } = await import("@/lib/write-hold");
    const { getPublicClient } = await import("wagmi/actions");
    const chain = getPublicClient(mocks.config as never, { chainId: 11155111 } as never);
    await writeHolds
      .open({ chainId: 11155111, account: ACCOUNT, safe, namespace, call: { ...call, value: 0n } })
      .send(chain as never, async (gate) => {
        await gate.beforeSend();
        throw new Error("Wallet transport timed out");
      })
      .catch(() => undefined);
  }

  it("refuses a retry under the new intent, with regenerated calldata, until the exit", async () => {
    const { review, hooks, held } = await freshHarness();
    const { legacyIntents } = await import("@/lib/legacy-intents");
    const { withWriteIntent } = await import("@/lib/write-hold");
    review.registerTransactionReviewHandler(async () => true);
    const prompt = vi.fn().mockResolvedValue(false);
    held.registerFlowChoiceHandler(prompt);
    const legacy = legacyIntents.repay("5");
    await heldByMain(legacy[0]!, TRANSFER_7);
    const { result } = renderHook(() => hooks.useWriteContract());
    const repay = () =>
      withWriteIntent(
        result.current.writeContractAsync,
        loanIntent({ chainId: 11155111, loanId: 5n }),
        legacy,
      )({ ...CALL, args: [RECIPIENT, 8n] as const } as never);

    await expect(repay()).rejects.toThrow(/hasn't confirmed yet/);
    expect(prompt).toHaveBeenCalledOnce();
    expect(mocks.submit).not.toHaveBeenCalled();
    prompt.mockResolvedValue(true);
    await act(async () => {
      await repay();
    });
    expect(mocks.submit).toHaveBeenCalledOnce();
  });

  it("refuses a cash out retried on the other venue while a 25% cash out that build left is unresolved", async () => {
    const { review, hooks, held } = await freshHarness();
    const { legacyIntents } = await import("@/lib/legacy-intents");
    const { withWriteIntent } = await import("@/lib/write-hold");
    const { intent, writeIntentKey } = await import("@bananapus/nana-sdk-core/review");
    review.registerTransactionReviewHandler(async () => true);
    const prompt = vi.fn().mockResolvedValue(false);
    held.registerFlowChoiceHandler(prompt);
    // The terminal cash out, keyed by the 25% button, with no wallet answer.
    await heldByMain(
      writeIntentKey("cash-out", {
        projectId: 7n,
        token: intent.address(TARGET),
        amount: "policy:25%",
        beneficiary: intent.address(ACCOUNT),
      }),
      TRANSFER_7,
    );
    const { result } = renderHook(() => hooks.useWriteContract());
    // The retry sells on the AMM: another target, so no call-shaped hold matches it.
    const sell = () =>
      withWriteIntent(
        result.current.writeContractAsync,
        cashOutIntent({ chainId: 11155111, project: 7n, holder: ACCOUNT, beneficiary: ACCOUNT }),
        legacyIntents.cashOut({ projectId: 7n, token: TARGET, amount: 9n, beneficiary: ACCOUNT }),
      )({ ...CALL, address: RECIPIENT, args: [TARGET, 9n] as const } as never);

    await expect(sell()).rejects.toThrow(/hasn't confirmed yet/);
    expect(mocks.submit).not.toHaveBeenCalled();
  });

  it("does not hold an approval by its call's old namespace: a new amount goes through", async () => {
    const { review, hooks, held } = await freshHarness();
    const { legacyCallNamespace } = await import("@/lib/legacy-intents");
    const { withWriteIntent } = await import("@/lib/write-hold");
    review.registerTransactionReviewHandler(async () => true);
    const prompt = vi.fn().mockResolvedValue(false);
    held.registerFlowChoiceHandler(prompt);
    const APPROVE_ABI = parseAbi(["function approve(address spender, uint256 amount)"]);
    const approve = (amount: bigint) => ({
      chainId: 11155111,
      address: TARGET,
      abi: APPROVE_ABI,
      functionName: "approve",
      args: [RECIPIENT, amount] as const,
    });
    await heldByMain(legacyCallNamespace(approve(5n))!, {
      to: TARGET,
      data: encodeFunctionData({
        abi: APPROVE_ABI,
        functionName: "approve",
        args: [RECIPIENT, 5n],
      }),
    });
    const { result } = renderHook(() => hooks.useWriteContract());
    const send = () =>
      withWriteIntent(
        result.current.writeContractAsync,
        approvalIntent(payIntent({ chainId: 11155111, project: 7n, beneficiary: ACCOUNT }), {
          step: "erc20",
          token: TARGET,
          spender: RECIPIENT,
        }),
      )(approve(6n) as never);

    await act(async () => {
      await send();
    });
    expect(prompt).not.toHaveBeenCalled();
    expect(mocks.submit).toHaveBeenCalledOnce();
  });

  it("refuses a Safe batch held by the old batch namespace, with stamped-again calldata, until the exit", async () => {
    mocks.account = {
      address: ACCOUNT,
      chainId: 11155111,
      connector: { id: "safe", name: "Safe" },
    };
    const { review, hooks, held } = await freshHarness();
    const { legacyBatchNamespace } = await import("@/lib/legacy-intents");
    review.registerTransactionReviewHandler(async () => true);
    const prompt = vi.fn().mockResolvedValue(false);
    held.registerFlowChoiceHandler(prompt);
    const LP = parseAbi(["function modifyLiquidities(bytes unlockData, uint256 deadline) payable"]);
    const batch = (at: bigint) => [
      { address: TARGET, abi: LP, functionName: "modifyLiquidities", args: ["0x1234", at] },
    ];
    const data = (at: bigint) =>
      encodeFunctionData({ abi: LP, functionName: "modifyLiquidities", args: ["0x1234", at] });
    await heldByMain(
      legacyBatchNamespace(batch(1_000n) as never),
      {
        to: MULTI_SEND_CALL_ONLY,
        data: encodeMultiSend([{ to: TARGET, value: 0n, data: data(1_000n) }]),
      },
      true,
    );

    await expect(
      renderHook(() => hooks.useProposeSafeBatch()).result.current(
        mocks.config as never,
        11155111,
        "Edit liquidity",
        batch(2_000n) as never,
        undefined,
        liquidityIntent({ chainId: 11155111, pool: `0x${"7a".repeat(32)}`, positions: [] }),
      ),
    ).rejects.toThrow(/hasn't confirmed yet/);
    expect(prompt).toHaveBeenCalledOnce();
    expect(mocks.sendCalls).not.toHaveBeenCalled();
  });
});

describe("an execution the Safe service reports", () => {
  it("is given to the hold, so its pending transaction keeps the exit closed", async () => {
    vi.useFakeTimers();
    const EXECUTION = `0x${"34".repeat(32)}` as Hex;
    const { activity, hooks } = await freshHarness({ followers: true });
    savedProposal(activity, PROPOSAL, 11155111);
    // An earlier load saw the reported execution with no receipt an hour ago.
    activity.updateTransactionActivity(`tx:11155111:${PROPOSAL}`, {
      executionHash: EXECUTION,
      executionSeenAt: Date.now() - HOUR,
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) =>
        String(input).endsWith(`/multisig-transactions/${PROPOSAL}/`)
          ? new Response(
              JSON.stringify({
                ...PROPOSED,
                safe: ACCOUNT,
                isExecuted: true,
                transactionHash: EXECUTION,
              }),
            )
          : new Response("Not found", { status: 404 }),
      ),
    );
    // The execution is still in the mempool.
    mocks.getTransaction.mockImplementation(async ({ hash }: { hash: Hex }) => {
      if (hash !== EXECUTION) throw new TransactionNotFoundError({ hash });
      return { ...executionOf({ to: TARGET, data: "0x1234" }), hash: EXECUTION, blockNumber: null };
    });
    mocks.waitForTransactionReceipt.mockRejectedValue(new Error("Timed out"));
    mocks.getTransactionReceipt.mockImplementation(async ({ hash }: { hash: Hex }) => {
      throw new TransactionReceiptNotFoundError({ hash });
    });

    hooks.resumeSafeProposalTracking(mocks.config as never);
    await vi.advanceTimersByTimeAsync(5 * 60_000);

    const { safeHoldOf } = await import("@/lib/write-hold");
    const { getPublicClient } = await import("wagmi/actions");
    const chain = getPublicClient(mocks.config as never, { chainId: 11155111 } as never);
    const hold = safeHoldOf(11155111, {
      safe: ACCOUNT,
      calls: [{ to: TARGET, data: "0x1234", value: "0" }],
      batch: false,
    });
    expect(await hold.state(chain as never)).toMatchObject({ exit: false });
  });
});

// The happy path, as on main: one review, one wallet prompt, no flow choice or notice, and the
// next send of the same action after the first confirmed goes straight to review again.
describe("the normal path adds no step", () => {
  it.each([
    ["a payment", payIntent({ chainId: 11155111, project: 7n, beneficiary: ACCOUNT })],
    [
      "a cash out",
      cashOutIntent({ chainId: 11155111, project: 7n, holder: ACCOUNT, beneficiary: ACCOUNT }),
    ],
    ["a launch", launchIntent({ chainId: 11155111, account: ACCOUNT, config: { name: "Rev" } })],
  ])("%s: one review and one wallet prompt, twice in a row", async (_action, namespace) => {
    for (const timing of ["at once", "after the send"] as const)
      await twiceInARow(namespace, timing);
  });
});

async function twiceInARow(namespace: string, timing: "at once" | "after the send") {
  {
    window.localStorage.clear();
    mocks.submit.mockReset().mockResolvedValue(HASH);
    const { review, activity, hooks, held } = await freshHarness();
    const { withWriteIntent } = await import("@/lib/write-hold");
    const reviewer = vi.fn().mockResolvedValue(true);
    review.registerTransactionReviewHandler(reviewer);
    const choice = vi.fn().mockResolvedValue(false);
    held.registerFlowChoiceHandler(choice);
    const lands = receiptLands(timing);
    const { result } = renderHook(() => hooks.useWriteContract());
    const send = (amount: bigint) =>
      withWriteIntent(
        result.current.writeContractAsync,
        namespace,
      )({ ...CALL, args: [RECIPIENT, amount] } as never);

    await act(async () => {
      await send(7n);
    });
    expect(reviewer).toHaveBeenCalledOnce();
    expect(mocks.submit).toHaveBeenCalledOnce();
    await act(async () => lands());
    await waitFor(() =>
      expect(activity.transactionActivityForHash(HASH)).toMatchObject({
        status: "success",
        message: "Confirmed onchain.",
      }),
    );

    // The same action again, once the first confirmed: straight to review, never "Already done".
    const NEXT = `0x${"9d".repeat(32)}` as Hex;
    mocks.submit.mockResolvedValue(NEXT);
    await act(async () => {
      await send(8n);
    });
    expect(reviewer).toHaveBeenCalledTimes(2);
    expect(mocks.submit).toHaveBeenCalledTimes(2);
    expect(choice).not.toHaveBeenCalled();
  }
}
