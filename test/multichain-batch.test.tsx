import { useMultichainBatch } from "@/hooks/useMultichainBatch";
import {
  batchCallKey,
  createMultichainBatch,
  findPendingBatch,
  makeBatchRounds,
  readMultichainBatches,
  saveMultichainBatch,
  type MultichainCall,
} from "@/lib/multichain-batch";
import { routerGatewayAbi } from "@/lib/router-gateway-abi";
import { SAFE_EXEC_ABI, safeProposalFor, safeTransactionHash } from "@/lib/safe-queue";
import {
  recordTransactionActivity,
  refreshTransactionActivities,
} from "@/lib/transaction-activity";
import { act, renderHook } from "@testing-library/react";
import {
  encodeAbiParameters,
  encodeEventTopics,
  encodeFunctionData,
  encodeFunctionResult,
  parseAbi,
  parseAbiParameters,
  zeroAddress,
  zeroHash,
  type Address,
  type Hash,
} from "viem";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ACCOUNT = "0x1111111111111111111111111111111111111111" as Address;
const TARGET = "0x2222222222222222222222222222222222222222" as Address;
const HASH = `0x${"ab".repeat(32)}` as Hash;
const ABI = parseAbi(["function distribute(uint256 projectId)"]);
const call = (chainId: number, id = 1n): MultichainCall => ({
  chainId,
  address: TARGET,
  abi: ABI,
  functionName: "distribute",
  args: [id],
  recoveryScope: `distribution:${chainId}:${id}`,
});
const commitmentData = encodeFunctionData({
  abi: routerGatewayAbi,
  functionName: "pendingCallCommitmentOf",
  args: [HASH],
});
const failureData = encodeFunctionData({
  abi: routerGatewayAbi,
  functionName: "pendingCallFailureOf",
  args: [HASH],
});
const failureSnapshot = encodeFunctionResult({
  abi: routerGatewayAbi,
  functionName: "pendingCallFailureOf",
  result: {
    errorHash: zeroHash,
    count: 0,
    lastFailureAt: 0,
    highestGasLimit: 0n,
  },
});
const retryCall = (chainId: number): MultichainCall => ({
  ...call(chainId),
  gas: 6_600_000n,
  preconditions: [
    { address: TARGET, data: commitmentData, expected: HASH },
    { address: TARGET, data: failureData, expected: failureSnapshot },
  ],
  expectedRouterPending: { gateway: TARGET, pendingCallId: HASH, callHash: HASH },
});
const mocks = vi.hoisted(() => ({
  safe: false,
  account: "0x1111111111111111111111111111111111111111",
  chainId: 1,
  quote: vi.fn(),
  pay: vi.fn(),
  wait: vi.fn(),
  scopeAvailable: vi.fn(),
  choose: vi.fn(),
  write: vi.fn(),
  verify: vi.fn(),
  estimate: vi.fn(),
  simulate: vi.fn(),
  rawCall: vi.fn(),
  review: vi.fn(),
  resumeSafe: vi.fn(),
  transaction: vi.fn(),
  receipt: vi.fn(),
  block: vi.fn(),
  options: {} as {
    reverify?: () => Promise<void>;
    beforeSubmission?: () => Promise<void>;
    preflightSimulation?: (variables: unknown, account: Address) => Promise<{ gas: bigint } | void>;
  },
}));
vi.mock("wagmi", () => ({ useConfig: () => ({}) }));
vi.mock("wagmi/actions", () => ({
  getAccount: () => ({ address: mocks.account, chainId: mocks.chainId }),
  getPublicClient: () => ({
    estimateContractGas: mocks.estimate,
    simulateContract: mocks.simulate,
    request: mocks.rawCall,
    call: mocks.verify,
    getTransaction: mocks.transaction,
    getTransactionReceipt: mocks.receipt,
    getBlock: mocks.block,
    waitForTransactionReceipt: mocks.receipt,
  }),
}));
vi.mock("@/hooks/useReviewedRelayr", () => ({
  useGetRelayrTxQuote: () => ({ getRelayrTxQuote: mocks.quote }),
  useSendRelayrTx: () => ({ sendRelayrTx: mocks.pay }),
  waitForRelayrBundle: mocks.wait,
  requireRelayrRecoveryScopeAvailable: mocks.scopeAvailable,
}));
vi.mock("@/hooks/useReviewedWriteContract", () => ({
  isSafeConnection: () => mocks.safe,
  submittedViaSafe: () => mocks.safe,
  resumeSafeProposalTracking: mocks.resumeSafe,
  useWriteContract: (options: typeof mocks.options) => {
    mocks.options = options;
    return {
      writeContractAsync: async (variables: { chainId: number }) => {
        // The reviewed direct wrapper switches to each destination before its
        // final source/account checks and wallet submission.
        mocks.chainId = variables.chainId;
        await options.reverify?.();
        await options.preflightSimulation?.(variables, mocks.account as Address);
        await options.beforeSubmission?.();
        return mocks.write(variables);
      },
    };
  },
}));
vi.mock("@/lib/transaction-review", () => ({
  requireTransactionReview: mocks.review,
  chooseRelayrPayment: mocks.choose,
}));
afterEach(() => vi.unstubAllGlobals());

beforeEach(() => {
  window.localStorage.clear();
  mocks.safe = false;
  mocks.account = ACCOUNT;
  mocks.chainId = 1;
  mocks.review.mockResolvedValue(undefined);
  mocks.scopeAvailable.mockReturnValue(undefined);
  mocks.estimate.mockResolvedValue(100000n);
  mocks.simulate.mockResolvedValue({ request: {} });
  mocks.rawCall.mockResolvedValue("0x");
  mocks.verify.mockImplementation(async ({ data }) => ({
    data: data === commitmentData ? HASH : data === failureData ? failureSnapshot : "0x",
  }));
  mocks.choose.mockResolvedValue({ chain: 1 });
  mocks.pay.mockResolvedValue(HASH);
  mocks.write.mockResolvedValue(HASH);
  const frozen = createMultichainBatch(ACCOUNT, "fixture", "Fixture", [call(1)], "direct").calls[0];
  mocks.transaction.mockResolvedValue({
    hash: HASH,
    from: ACCOUNT,
    to: TARGET,
    input: frozen.data,
    value: 0n,
    blockHash: HASH,
    blockNumber: 1n,
  });
  mocks.receipt.mockResolvedValue({
    transactionHash: HASH,
    status: "success",
    blockHash: HASH,
    blockNumber: 1n,
    logs: [],
  });
  mocks.block.mockResolvedValue({ hash: HASH, gasLimit: 36_000_000n });
  mocks.quote.mockImplementation(async (requests: MultichainCall[]) => ({
    bundle_uuid: `bundle-${mocks.quote.mock.calls.length}`,
    payment_info: [{ chain: requests[0].chainId }],
    requests,
  }));
  mocks.wait.mockImplementation(async (uuid: string) => {
    const index = Number(uuid.split("-")[1]) - 1;
    const requests = mocks.quote.mock.calls[index][0] as MultichainCall[];
    return {
      transactions: requests.map((request) => ({
        request: { chain: request.chainId },
        status: { data: { hash: HASH } },
      })),
    };
  });
});

describe("durable multichain batch journal", () => {
  it("adversarial: rechecks a completed routing receipt after reload", async () => {
    const batch = createMultichainBatch(
      ACCOUNT,
      "orphaned-routing",
      "Route fees",
      [retryCall(1), retryCall(10)],
      "direct",
    );
    // Persist the same checkpoint produced after the first successful attempt.
    batch.calls[0].state = "success";
    batch.calls[0].hash = HASH;
    saveMultichainBatch(batch);
    mocks.block.mockResolvedValue({ hash: zeroHash, gasLimit: 36_000_000n });
    mocks.verify.mockResolvedValue({ data: zeroHash }); // Keeper resolved the unsent second call.
    const { result } = renderHook(() => useMultichainBatch());
    let failure: unknown;
    await act(async () => {
      try {
        await result.current.runBatch({ scope: batch.scope, label: batch.label, calls: [] });
      } catch (error) {
        failure = error;
      }
    });
    expect(mocks.write).not.toHaveBeenCalled();
    expect(
      failure,
      "must not return the orphaned transaction as a verified successful hash",
    ).toBeTruthy();
    expect(findPendingBatch(ACCOUNT, batch.scope)).toBeDefined();
    expect(mocks.receipt).toHaveBeenCalledWith({ hash: HASH });
    expect(readMultichainBatches()[0].calls[0]).toMatchObject({
      hash: HASH,
      checkpointUnverified: true,
    });
    expect(result.current.getPendingBatch(batch.scope)?.completed).toBe(0);
  });

  it.each(["success", "reverted"] as const)(
    "keeps a saved %s receipt unresolved across retries when it disappears",
    async (state) => {
      const batch = createMultichainBatch(
        ACCOUNT,
        "missing-receipt",
        "Route fees",
        [retryCall(1)],
        "direct",
      );
      Object.assign(batch.calls[0], { state, hash: HASH });
      saveMultichainBatch(batch);
      mocks.receipt.mockRejectedValue(new Error("Receipt not found"));
      const { result } = renderHook(() => useMultichainBatch());
      for (let attempt = 0; attempt < 2; attempt++) {
        await act(async () => {
          await expect(
            result.current.runBatch({ scope: batch.scope, label: batch.label, calls: [] }),
          ).rejects.toThrow(/Receipt not found/);
        });
      }
      expect(result.current.getPendingBatch(batch.scope)?.completed).toBe(0);
      expect(readMultichainBatches()[0].calls[0]).toMatchObject({
        hash: HASH,
        checkpointUnverified: true,
      });
      expect(mocks.write).not.toHaveBeenCalled();
    },
  );

  it("rechecks earlier receipts after the remaining calls finish", async () => {
    const secondHash = `0x${"cd".repeat(32)}` as Hash;
    const batch = createMultichainBatch(
      ACCOUNT,
      "final-reorg",
      "Route fees",
      [retryCall(1), call(10)],
      "direct",
    );
    saveMultichainBatch(batch);
    mocks.write.mockResolvedValueOnce(HASH).mockResolvedValueOnce(secondHash);
    mocks.transaction.mockImplementation(async ({ hash }) => ({
      hash,
      from: ACCOUNT,
      to: TARGET,
      input: batch.calls[0].data,
      value: 0n,
      blockHash: HASH,
      blockNumber: hash === HASH ? 1n : 2n,
    }));
    mocks.receipt.mockImplementation(async ({ hash }) => ({
      transactionHash: hash,
      status: hash === HASH ? "reverted" : "success",
      blockHash: HASH,
      blockNumber: hash === HASH ? 1n : 2n,
      logs: [],
    }));
    mocks.block.mockImplementation(async ({ blockNumber }) => ({
      hash: blockNumber === 1n && mocks.write.mock.calls.length === 2 ? zeroHash : HASH,
    }));
    const { result } = renderHook(() => useMultichainBatch());
    await act(async () => {
      await expect(
        result.current.runBatch({ scope: batch.scope, label: batch.label, calls: [] }),
      ).rejects.toThrow(/canonical/);
    });
    expect(mocks.write).toHaveBeenCalledTimes(2);
    expect(findPendingBatch(ACCOUNT, batch.scope)).toBeDefined();
    expect(result.current.getPendingBatch(batch.scope)?.completed).toBe(0);
    await act(async () => {
      await expect(
        result.current.runBatch({ scope: batch.scope, label: batch.label, calls: [] }),
      ).rejects.toThrow(/canonical/);
    });
    expect(mocks.write).toHaveBeenCalledTimes(2);
  });

  it.each(["resume", "completion"])("rechecks keeper skip decisions at %s", async (phase) => {
    const batch = createMultichainBatch(
      ACCOUNT,
      "keeper-reorg",
      "Route fees",
      [retryCall(1)],
      "direct",
    );
    if (phase === "resume")
      Object.assign(batch.calls[0], { state: "skipped", skipReason: "resolved-externally" });
    else mocks.verify.mockResolvedValueOnce({ data: zeroHash });
    saveMultichainBatch(batch);
    const { result } = renderHook(() => useMultichainBatch());
    await act(async () => {
      await expect(
        result.current.runBatch({ scope: batch.scope, label: batch.label, calls: [] }),
      ).rejects.toThrow(/payment is pending again/);
    });
    expect(result.current.getPendingBatch(batch.scope)?.completed).toBe(0);
    expect(mocks.write).not.toHaveBeenCalled();
    expect(readMultichainBatches()[0].calls[0]).toMatchObject({ state: "ready" });
    expect(readMultichainBatches()[0].calls[0].skipReason).toBeUndefined();
    expect(readMultichainBatches()[0].calls[0].checkpointUnverified).toBeUndefined();
  });

  it("resumes a restored unsigned keeper call without replaying completed transactions", async () => {
    const secondHash = `0x${"cd".repeat(32)}` as Hash;
    const batch = createMultichainBatch(
      ACCOUNT,
      "keeper-resume",
      "Route fees",
      [call(1), retryCall(10)],
      "direct",
    );
    Object.assign(batch.calls[0], { state: "success", hash: HASH });
    Object.assign(batch.calls[1], { state: "skipped", skipReason: "resolved-externally" });
    saveMultichainBatch(batch);
    mocks.write.mockResolvedValue(secondHash);
    mocks.transaction.mockImplementation(async ({ hash }) => ({
      hash,
      from: ACCOUNT,
      to: TARGET,
      input: batch.calls[0].data,
      value: 0n,
      blockHash: HASH,
      blockNumber: 1n,
    }));
    mocks.receipt.mockImplementation(async ({ hash }) => ({
      transactionHash: hash,
      status: hash === secondHash ? "reverted" : "success",
      blockHash: HASH,
      blockNumber: 1n,
      logs: [],
    }));
    const { result } = renderHook(() => useMultichainBatch());
    await act(async () => {
      await expect(
        result.current.runBatch({ scope: batch.scope, label: batch.label, calls: [] }),
      ).rejects.toThrow(/payment is pending again/);
    });
    expect(mocks.write).not.toHaveBeenCalled();
    expect(readMultichainBatches()[0].calls[1]).toMatchObject({
      state: "ready",
      preconditions: batch.calls[1].preconditions,
    });
    await act(async () => {
      await expect(
        result.current.runBatch({ scope: batch.scope, label: batch.label, calls: [] }),
      ).resolves.toEqual({
        status: "success",
        hashes: [{ chainId: 1, hash: HASH, callIndex: 0 }],
        revertedHashes: [{ chainId: 10, hash: secondHash, callIndex: 1 }],
      });
    });
    expect(mocks.write).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ chainId: 10 }));
  });

  it("does not restore a skipped call when its publication scope cannot be reconciled", async () => {
    const batch = createMultichainBatch(
      ACCOUNT,
      "keeper-published",
      "Route fees",
      [retryCall(1)],
      "direct",
    );
    Object.assign(batch.calls[0], { state: "skipped", skipReason: "resolved-externally" });
    saveMultichainBatch(batch);
    mocks.scopeAvailable.mockImplementation(() => {
      throw new Error("Authorization already published");
    });
    const { result } = renderHook(() => useMultichainBatch());
    await act(async () => {
      await expect(
        result.current.runBatch({ scope: batch.scope, label: batch.label, calls: [] }),
      ).rejects.toThrow(/already published/);
    });
    expect(readMultichainBatches()[0].calls[0]).toMatchObject({
      state: "skipped",
      checkpointUnverified: true,
    });
    expect(mocks.write).not.toHaveBeenCalled();
  });

  it.each(["retained", "pruned"])(
    "revokes an obsolete Safe checkpoint with %s activity when the payment is pending again",
    async (history) => {
      const batch = createMultichainBatch(
        ACCOUNT,
        "obsolete-reorg",
        "Route fees",
        [retryCall(1)],
        "direct",
      );
      Object.assign(batch.calls[0], {
        state: "skipped",
        skipReason: "obsolete-safe",
        hash: HASH,
        safeProposalHash: HASH,
        safeNonce: 7,
      });
      saveMultichainBatch(batch);
      if (history === "retained")
        recordTransactionActivity({
          id: `tx:1:${HASH}`,
          kind: "safe",
          title: "Route fees",
          status: "failed",
          message: "Obsolete",
          account: ACCOUNT,
          chainId: 1,
          hash: HASH,
          safeProposalHash: HASH,
          obsoleteSafeNonce: 7,
        });
      const { result } = renderHook(() => useMultichainBatch());
      await act(async () => {
        await expect(
          result.current.runBatch({ scope: batch.scope, label: batch.label, calls: [] }),
        ).rejects.toThrow(/saved Safe proposal/);
      });
      expect(readMultichainBatches()[0].calls[0]).toMatchObject({
        safeProposalHash: HASH,
        checkpointUnverified: true,
      });
      expect(result.current.getPendingBatch(batch.scope)?.completed).toBe(0);
      expect(mocks.write).not.toHaveBeenCalled();
      expect(
        refreshTransactionActivities().find((row) => row.safeProposalHash === HASH),
      ).toMatchObject({
        status: "safe-proposed",
        manualVerificationRequired: true,
        hash: HASH,
      });
      expect(
        refreshTransactionActivities().find((row) => row.safeProposalHash === HASH)
          ?.obsoleteSafeNonce,
      ).toBeUndefined();
      expect(mocks.resumeSafe).toHaveBeenCalledOnce();
    },
  );

  it("reports the fresh outcome when the original routing transaction is canonically re-included", async () => {
    const newBlock = `0x${"cd".repeat(32)}` as Hash;
    const batch = createMultichainBatch(
      ACCOUNT,
      "changed-outcome",
      "Route fees",
      [retryCall(1)],
      "direct",
    );
    Object.assign(batch.calls[0], {
      state: "success",
      hash: HASH,
      receipt: { blockHash: HASH, blockNumber: 1n, outcome: "settled" },
    });
    saveMultichainBatch(batch);
    mocks.transaction.mockResolvedValue({
      hash: HASH,
      from: ACCOUNT,
      to: TARGET,
      input: batch.calls[0].data,
      value: 0n,
      blockHash: newBlock,
      blockNumber: 2n,
    });
    mocks.receipt.mockResolvedValue({
      transactionHash: HASH,
      status: "reverted",
      blockHash: newBlock,
      blockNumber: 2n,
      logs: [],
    });
    mocks.block.mockResolvedValue({ hash: newBlock });
    const { result } = renderHook(() => useMultichainBatch());
    await act(async () => {
      await expect(
        result.current.runBatch({ scope: batch.scope, label: batch.label, calls: [] }),
      ).resolves.toEqual({
        status: "success",
        hashes: [],
        revertedHashes: [{ chainId: 1, hash: HASH, callIndex: 0 }],
      });
    });
    expect(readMultichainBatches()[0].calls[0]).toMatchObject({
      state: "reverted",
      hash: HASH,
      receipt: { blockHash: newBlock, blockNumber: 2n, outcome: "reverted" },
    });
    expect(mocks.write).not.toHaveBeenCalled();
  });

  it.each(["current", "legacy", "pending", "reexecuted"])(
    "preserves the exact Safe proposal when rechecking a %s completion",
    async (mode) => {
      const executionHash = `0x${"cd".repeat(32)}` as Hash;
      const batch = createMultichainBatch(
        ACCOUNT,
        "safe-executed",
        "Distribute",
        [call(1)],
        "direct",
      );
      Object.assign(
        batch.calls[0],
        mode === "pending"
          ? { state: "safe", hash: HASH }
          : mode === "legacy"
            ? { state: "success", hash: executionHash }
            : {
                state: "success",
                hash: HASH,
                safeProposalHash: HASH,
                executionHash: mode === "reexecuted" ? `0x${"ef".repeat(32)}` : executionHash,
              },
      );
      saveMultichainBatch(batch);
      if (mode !== "current")
        recordTransactionActivity({
          id: `tx:1:${HASH}`,
          kind: "safe",
          title: "Distribute",
          status: "success",
          message: "Executed",
          account: ACCOUNT,
          chainId: 1,
          safeProposalHash: HASH,
          executionHash,
        });
      mocks.transaction.mockResolvedValue({
        hash: executionHash,
        from: TARGET,
        to: ACCOUNT,
        value: 0n,
        blockHash: HASH,
        blockNumber: 1n,
        input: encodeFunctionData({
          abi: SAFE_EXEC_ABI,
          functionName: "execTransaction",
          args: [TARGET, 0n, batch.calls[0].data, 0, 0n, 0n, 0n, zeroAddress, zeroAddress, "0x"],
        }),
      });
      mocks.receipt.mockResolvedValue({
        transactionHash: executionHash,
        status: "success",
        blockHash: HASH,
        blockNumber: 1n,
        logs: [
          {
            address: ACCOUNT,
            topics: encodeEventTopics({
              abi: SAFE_EXEC_ABI,
              eventName: "ExecutionSuccess",
              args: { txHash: HASH },
            }),
            data: encodeAbiParameters(parseAbiParameters("uint256"), [0n]),
          },
        ],
      });
      const { result } = renderHook(() => useMultichainBatch());
      await act(async () => {
        await expect(
          result.current.runBatch({ scope: batch.scope, label: batch.label, calls: [] }),
        ).resolves.toEqual({
          status: "success",
          hashes: [{ chainId: 1, hash: executionHash, callIndex: 0 }],
        });
      });
      expect(readMultichainBatches()[0].calls[0]).toMatchObject({
        hash: HASH,
        safeProposalHash: HASH,
        executionHash,
        receipt: { blockHash: HASH, blockNumber: 1n, outcome: "success" },
      });
      expect(mocks.receipt).toHaveBeenCalledTimes(2);
      expect(mocks.write).not.toHaveBeenCalled();
    },
  );

  it("keeps a legacy Safe completion unresolved when its original proposal identity is unavailable", async () => {
    const batch = createMultichainBatch(
      ACCOUNT,
      "safe-identity-lost",
      "Distribute",
      [call(1)],
      "direct",
    );
    Object.assign(batch.calls[0], { state: "success", hash: HASH });
    saveMultichainBatch(batch);
    mocks.transaction.mockResolvedValue({
      hash: HASH,
      from: TARGET,
      to: ACCOUNT,
      input: batch.calls[0].data,
      value: 0n,
      blockHash: HASH,
      blockNumber: 1n,
    });
    const { result } = renderHook(() => useMultichainBatch());
    await act(async () => {
      await expect(
        result.current.runBatch({ scope: batch.scope, label: batch.label, calls: [] }),
      ).rejects.toThrow(/exact reviewed call/);
    });
    expect(result.current.getPendingBatch(batch.scope)?.completed).toBe(0);
    expect(mocks.write).not.toHaveBeenCalled();
  });

  it("preserves all allocations in explicit rounds with one call per chain", () => {
    expect(
      makeBatchRounds([call(1, 1n), call(10, 1n), call(1, 2n), call(10, 2n), call(1, 3n)]).map(
        (round) => round.indices,
      ),
    ).toEqual([[0, 1], [2, 3], [4]]);
  });
  it("restores exact bigint arguments and prevents overlapping changed selections", () => {
    const job = createMultichainBatch(
      ACCOUNT,
      "credits",
      "Claim credits",
      [call(1), call(10)],
      "relayr",
    );
    saveMultichainBatch(job);
    expect(findPendingBatch(ACCOUNT, "credits")?.calls[0].args).toEqual([1n]);
    expect(() =>
      createMultichainBatch(ACCOUNT, "another-ui", "Changed", [call(10)], "relayr"),
    ).toThrow(/Resume the saved/);
    expect(batchCallKey([call(1, 2n)])).not.toBe(job.key);
  });
  it("does not treat corrupt recovery data as an empty journal", () => {
    localStorage.setItem("revnet:multichain-batches:v1", "bad JSON");
    expect(() => readMultichainBatches()).toThrow(/recovery data is unavailable/);
  });
});

describe("wallet-action:multichain-batch — reviewed selected-call orchestration", () => {
  it("verifies a retained-again attempt and frees its journal without claiming settlement", async () => {
    const gas = 6_600_000n;
    const retry = { ...retryCall(1), gas };
    mocks.receipt.mockResolvedValue({
      transactionHash: HASH,
      status: "success",
      blockHash: HASH,
      blockNumber: 1n,
      logs: [
        {
          address: TARGET,
          topics: encodeEventTopics({
            abi: routerGatewayAbi,
            eventName: "JBRouterTerminalGateway_RecordTerminalCallFailure",
            args: { id: HASH, errorHash: HASH },
          }),
          data: encodeAbiParameters(parseAbiParameters("uint32,uint256,address"), [
            1,
            1000n,
            ACCOUNT,
          ]),
        },
      ],
    });
    const { result } = renderHook(() => useMultichainBatch());
    await act(async () => {
      await expect(
        result.current.runBatch({ scope: "retry", label: "Route fee", calls: [retry] }),
      ).resolves.toMatchObject({ status: "success" });
    });
    expect(mocks.review).toHaveBeenCalledWith(
      expect.objectContaining({
        calls: [expect.objectContaining({ gas })],
      }),
    );
    expect(mocks.rawCall).toHaveBeenCalledWith({
      method: "eth_call",
      params: [expect.objectContaining({ from: ACCOUNT, to: TARGET, gas: "0x64b540" }), "latest"],
    });
    expect(mocks.simulate).not.toHaveBeenCalled();
    expect(mocks.write).toHaveBeenCalledWith(expect.objectContaining({ gas }));
    expect(mocks.estimate).not.toHaveBeenCalled();
    expect(findPendingBatch(ACCOUNT, "retry")).toBeUndefined();
    expect(readMultichainBatches()[0].calls[0].expectedRouterPending).toEqual(
      retry.expectedRouterPending,
    );
    expect(() =>
      createMultichainBatch(ACCOUNT, "retry", "Route fee", [retry], "direct"),
    ).not.toThrow();
  });

  it("keeps an unverified gateway receipt locked instead of replaying it", async () => {
    const retry = retryCall(1);
    const { result } = renderHook(() => useMultichainBatch());
    await act(async () => {
      await expect(
        result.current.runBatch({ scope: "retry", label: "Route fee", calls: [retry] }),
      ).rejects.toThrow(/no unique verified/);
      await expect(
        result.current.runBatch({ scope: "retry", label: "Route fee", calls: [] }),
      ).rejects.toThrow(/no unique verified/);
    });
    expect(mocks.write).toHaveBeenCalledOnce();
    expect(findPendingBatch(ACCOUNT, "retry")?.calls[0].state).toBe("submitted");
  });

  it("finishes a canonical reverted EOA routing attempt without replaying it, then continues the batch", async () => {
    const revertedHash = `0x${"cd".repeat(32)}` as Hash;
    const batch = createMultichainBatch(
      ACCOUNT,
      "reverted-routing",
      "Route fees",
      [retryCall(1), call(10)],
      "direct",
    );
    batch.calls[0].hash = revertedHash;
    batch.calls[0].state = "submitted";
    saveMultichainBatch(batch);
    const activityId = `tx:1:${revertedHash.toLowerCase()}`;
    recordTransactionActivity({
      id: activityId,
      kind: "direct",
      title: "Route fee",
      status: "pending",
      message: "Awaiting verification",
      manualVerificationRequired: true,
      hash: revertedHash,
      chainId: 1,
      account: ACCOUNT,
    });
    mocks.transaction.mockImplementation(async ({ hash }) => ({
      hash,
      from: ACCOUNT,
      to: TARGET,
      input: batch.calls[0].data,
      value: 0n,
      blockHash: HASH,
      blockNumber: 1n,
    }));
    mocks.receipt.mockImplementation(async ({ hash }) => ({
      transactionHash: hash,
      status: hash === revertedHash ? "reverted" : "success",
      blockHash: HASH,
      blockNumber: 1n,
      logs: [],
    }));
    const { result } = renderHook(() => useMultichainBatch());
    await act(async () => {
      await expect(
        result.current.runBatch({ scope: "reverted-routing", label: "Route fees", calls: [] }),
      ).resolves.toEqual({
        status: "success",
        hashes: [{ chainId: 10, hash: HASH, callIndex: 1 }],
        revertedHashes: [{ chainId: 1, hash: revertedHash, callIndex: 0 }],
      });
    });
    expect(mocks.write).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ chainId: 10 }));
    expect(readMultichainBatches()[0].calls.map((row) => row.state)).toEqual([
      "reverted",
      "success",
    ]);
    expect(refreshTransactionActivities().find((row) => row.id === activityId)).toMatchObject({
      status: "failed",
      manualVerificationRequired: false,
    });
    expect(findPendingBatch(ACCOUNT, "reverted-routing")).toBeUndefined();
    expect(() =>
      createMultichainBatch(ACCOUNT, "reverted-routing", "Route fees", [retryCall(1)], "direct"),
    ).not.toThrow();
  });

  it.each(["call", "block"])(
    "keeps a reverted routing receipt locked when its %s identity differs",
    async (mismatch) => {
      const batch = createMultichainBatch(
        ACCOUNT,
        "reverted-mismatch",
        "Route fee",
        [retryCall(1)],
        "direct",
      );
      batch.calls[0].hash = HASH;
      batch.calls[0].state = "submitted";
      saveMultichainBatch(batch);
      mocks.receipt.mockResolvedValue({
        transactionHash: HASH,
        status: "reverted",
        blockHash: HASH,
        blockNumber: 1n,
        logs: [],
      });
      mocks.transaction.mockResolvedValue({
        hash: HASH,
        from: ACCOUNT,
        to: TARGET,
        value: 0n,
        blockNumber: 1n,
        blockHash: mismatch === "block" ? zeroHash : HASH,
        input: mismatch === "call" ? "0x1234" : batch.calls[0].data,
      });
      const { result } = renderHook(() => useMultichainBatch());
      await act(async () => {
        await expect(
          result.current.runBatch({ scope: "reverted-mismatch", label: "Route fee", calls: [] }),
        ).rejects.toThrow();
      });
      expect(readMultichainBatches()[0].calls[0].state).toBe("submitted");
      expect(mocks.write).not.toHaveBeenCalled();
    },
  );

  it.each(["valid", "safe", "hash", "call", "unavailable"])(
    "archives an obsolete Safe proposal only after exact authentication: %s",
    async (mode) => {
      const batch = createMultichainBatch(
        ACCOUNT,
        "obsolete-safe",
        "Route fee",
        [retryCall(1)],
        "direct",
      );
      const proposal = safeProposalFor(
        { to: TARGET, data: mode === "call" ? "0x1234" : batch.calls[0].data },
        7,
      );
      const proposalHash = safeTransactionHash(1, ACCOUNT, proposal);
      batch.calls[0].hash = proposalHash;
      batch.calls[0].state = "safe";
      saveMultichainBatch(batch);
      recordTransactionActivity({
        id: `tx:1:${proposalHash}`,
        kind: "safe",
        title: "Route fee",
        status: "safe-proposed",
        message: "Awaiting execution",
        safeProposalHash: proposalHash,
        chainId: 1,
        account: ACCOUNT,
      });
      vi.stubGlobal(
        "fetch",
        vi.fn().mockImplementation(
          async () =>
            new Response(
              JSON.stringify({
                ...proposal,
                safe: mode === "safe" ? TARGET : ACCOUNT,
                nonce: mode === "hash" ? 8 : 7,
              }),
              { status: mode === "unavailable" ? 503 : 200 },
            ),
        ),
      );
      mocks.verify.mockResolvedValue({ data: zeroHash });
      const { result } = renderHook(() => useMultichainBatch());
      await act(async () => {
        const attempt = result.current.runBatch({
          scope: "obsolete-safe",
          label: "Route fee",
          calls: [],
        });
        if (mode === "valid") {
          await expect(attempt).resolves.toEqual({
            status: "success",
            hashes: [],
            obsoleteSafeProposals: [
              { chainId: 1, safe: ACCOUNT, hash: proposalHash, nonce: 7, callIndex: 0 },
            ],
          });
        } else await expect(attempt).rejects.toThrow();
      });
      expect(readMultichainBatches()[0].calls[0]).toMatchObject(
        mode === "valid"
          ? { state: "skipped", hash: proposalHash, skipReason: "obsolete-safe", safeNonce: 7 }
          : { state: "safe", hash: proposalHash },
      );
      if (mode === "valid") {
        expect(
          refreshTransactionActivities().find((row) => row.safeProposalHash === proposalHash),
        ).toMatchObject({ obsoleteSafeNonce: 7, manualVerificationRequired: false });
        expect(findPendingBatch(ACCOUNT, "obsolete-safe")).toBeUndefined();
      }
      expect(mocks.write).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["direct", "resolved-externally"],
    ["direct", "retried-externally"],
  ] as const)(
    "resumes %s by skipping only an unpublished fee that was %s",
    async (route, reason) => {
      const batch = createMultichainBatch(
        ACCOUNT,
        "keeper-race",
        "Route fees",
        [call(1), retryCall(1)],
        route,
      );
      batch.calls[0].state = "success";
      batch.calls[0].hash = HASH;
      batch.rounds[0].state = "success";
      saveMultichainBatch(batch);
      const advancedFailure = encodeFunctionResult({
        abi: routerGatewayAbi,
        functionName: "pendingCallFailureOf",
        result: {
          errorHash: HASH,
          count: 1,
          lastFailureAt: 1000,
          highestGasLimit: 5_000_000n,
        },
      });
      mocks.verify.mockImplementation(async ({ data }) => ({
        data:
          data === commitmentData
            ? reason === "resolved-externally"
              ? zeroHash
              : HASH
            : advancedFailure,
      }));
      const { result } = renderHook(() => useMultichainBatch());
      await act(async () => {
        await expect(
          result.current.runBatch({ scope: "keeper-race", label: "Route fees", calls: [] }),
        ).resolves.toEqual({
          status: "success",
          hashes: [{ chainId: 1, hash: HASH, callIndex: 0 }],
        });
      });
      expect(mocks.write).not.toHaveBeenCalled();
      expect(mocks.quote).not.toHaveBeenCalled();
      expect(mocks.pay).not.toHaveBeenCalled();
      expect(readMultichainBatches()[0].calls[1]).toMatchObject({
        state: "skipped",
        skipReason: reason,
      });
      expect(findPendingBatch(ACCOUNT, "keeper-race")).toBeUndefined();
    },
  );

  it("does not skip a ready call when its Relayr publication response was lost", async () => {
    const batch = createMultichainBatch(
      ACCOUNT,
      "lost-quote",
      "Route fees",
      [retryCall(1)],
      "direct",
    );
    saveMultichainBatch(batch);
    mocks.scopeAvailable.mockImplementation(() => {
      throw new Error("Authorization already published");
    });
    mocks.verify.mockResolvedValue({ data: zeroHash });
    const { result } = renderHook(() => useMultichainBatch());
    await act(async () => {
      await expect(
        result.current.runBatch({ scope: "lost-quote", label: "Route fees", calls: [] }),
      ).rejects.toThrow(/already published/);
    });
    expect(mocks.verify).not.toHaveBeenCalled();
    expect(readMultichainBatches()[0].calls[0].state).toBe("ready");
    expect(mocks.quote).not.toHaveBeenCalled();
  });

  it.each(["submitting", "submitted", "safe"] as const)(
    "does not skip a %s call even if a keeper advanced it",
    async (state) => {
      const batch = createMultichainBatch(
        ACCOUNT,
        "submitted-race",
        "Route fees",
        [retryCall(1)],
        "direct",
      );
      batch.calls[0].state = state;
      if (state !== "submitting") batch.calls[0].hash = HASH;
      saveMultichainBatch(batch);
      mocks.verify.mockResolvedValue({ data: zeroHash });
      if (state === "safe")
        vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Safe service unavailable")));
      const { result } = renderHook(() => useMultichainBatch());
      await act(async () => {
        await expect(
          result.current.runBatch({ scope: "submitted-race", label: "Route fees", calls: [] }),
        ).rejects.toThrow();
      });
      expect(readMultichainBatches()[0].calls[0].state).toBe(state);
      if (state === "safe") expect(mocks.verify).toHaveBeenCalledOnce();
      else expect(mocks.verify).not.toHaveBeenCalled();
      expect(mocks.write).not.toHaveBeenCalled();
    },
  );

  it.each([16_777_216n, 6_600_000n])(
    "uses direct transactions for every routing retry at %s gas",
    async (gas) => {
      mocks.receipt.mockResolvedValue({
        transactionHash: HASH,
        status: "reverted",
        blockHash: HASH,
        blockNumber: 1n,
        logs: [],
      });
      const { result } = renderHook(() => useMultichainBatch());
      await act(async () => {
        await result.current.runBatch({
          scope: "large-retry",
          label: "Route fees",
          calls: [1, 10].map((chainId) => ({ ...retryCall(chainId), gas })),
        });
      });
      expect(mocks.quote).not.toHaveBeenCalled();
      expect(mocks.write).toHaveBeenCalledTimes(2);
      expect(readMultichainBatches()[0].route).toBe("direct");
      expect(readMultichainBatches()[0].calls.every((row) => row.gas === gas)).toBe(true);
    },
  );

  it("does not follow token-controlled OffchainLookup URLs or submit after a raw preflight fails", async () => {
    const remote = vi.fn();
    vi.stubGlobal("fetch", remote);
    mocks.rawCall.mockRejectedValue(new Error("OffchainLookup: https://attacker.invalid/lookup"));
    const { result } = renderHook(() => useMultichainBatch());
    await act(async () => {
      await expect(
        result.current.runBatch({
          scope: "offchain-retry",
          label: "Route payment",
          calls: [retryCall(1)],
        }),
      ).rejects.toThrow(/OffchainLookup/);
    });
    expect(mocks.rawCall).toHaveBeenCalledWith(expect.objectContaining({ method: "eth_call" }));
    expect(mocks.simulate).not.toHaveBeenCalled();
    expect(mocks.write).not.toHaveBeenCalled();
    expect(mocks.quote).not.toHaveBeenCalled();
    expect(remote).not.toHaveBeenCalled();
  });

  it("routes all four supported testnet destinations through one reviewed Relayr round", async () => {
    const chainIds = [11155111, 11155420, 84532, 421614];
    mocks.choose.mockResolvedValue({ chain: 11155111 });
    const { result } = renderHook(() => useMultichainBatch());
    await act(async () => {
      const completed = await result.current.runBatch({
        scope: "testnet-auto",
        label: "Distribute",
        calls: chainIds.map((chainId, index) => call(chainId, BigInt(index + 10))),
      });
      expect(completed.status).toBe("success");
      expect(completed.hashes.map((row) => row.callIndex)).toEqual([0, 1, 2, 3]);
    });
    expect(mocks.quote).toHaveBeenCalledOnce();
    expect(mocks.quote.mock.calls[0][0].map((request: MultichainCall) => request.chainId)).toEqual(
      chainIds,
    );
    expect(mocks.choose).toHaveBeenCalledWith([{ chain: 11155111 }], 1);
    expect(mocks.pay).toHaveBeenCalledOnce();
    expect(mocks.write).not.toHaveBeenCalled();
    expect(readMultichainBatches()[0].route).toBe("relayr");
  });

  it("rejects a fresh mixed mainnet/testnet EOA batch before review, publication, or saving", async () => {
    const { result } = renderHook(() => useMultichainBatch());
    await act(async () => {
      await expect(
        result.current.runBatch({
          scope: "mixed-family",
          label: "Distribute",
          calls: [call(1), call(11155111)],
        }),
      ).rejects.toThrow(/Mainnet and testnet transactions cannot share/);
    });
    expect(mocks.review).not.toHaveBeenCalled();
    expect(mocks.quote).not.toHaveBeenCalled();
    expect(mocks.pay).not.toHaveBeenCalled();
    expect(mocks.write).not.toHaveBeenCalled();
    expect(readMultichainBatches()).toEqual([]);
  });

  it("resumes an older direct testnet job without switching transport or replaying its completed call", async () => {
    const originalHash = `0x${"cd".repeat(32)}` as Hash;
    const batch = createMultichainBatch(
      ACCOUNT,
      "old-testnet-direct",
      "Claim",
      [call(11155111, 21n), call(11155420, 32n)],
      "direct",
    );
    batch.calls[0].state = "success";
    batch.calls[0].hash = originalHash;
    saveMultichainBatch(batch);
    mocks.transaction.mockImplementation(async ({ hash }) => ({
      hash,
      from: ACCOUNT,
      to: TARGET,
      input: batch.calls[hash === originalHash ? 0 : 1].data,
      value: 0n,
      blockHash: HASH,
      blockNumber: 1n,
    }));
    mocks.receipt.mockImplementation(async ({ hash }) => ({
      transactionHash: hash,
      status: "success",
      blockHash: HASH,
      blockNumber: 1n,
      logs: [],
    }));
    const { result } = renderHook(() => useMultichainBatch());
    await act(async () => {
      const completed = await result.current.runBatch({
        scope: "old-testnet-direct",
        label: "Claim",
        calls: [],
      });
      expect(completed).toEqual({
        status: "success",
        hashes: [
          { chainId: 11155111, callIndex: 0, hash: originalHash },
          { chainId: 11155420, callIndex: 1, hash: HASH },
        ],
      });
    });
    expect(mocks.write).toHaveBeenCalledOnce();
    expect(mocks.write).toHaveBeenCalledWith(
      expect.objectContaining({ chainId: 11155420, args: [32n] }),
    );
    expect(mocks.quote).not.toHaveBeenCalled();
    expect(mocks.pay).not.toHaveBeenCalled();
    expect(readMultichainBatches()[0].route).toBe("direct");
  });

  it("resumes a paid testnet Relayr round without funding again or replaying confirmed allocations", async () => {
    const originalHash = `0x${"cd".repeat(32)}` as Hash;
    const batch = createMultichainBatch(
      ACCOUNT,
      "testnet-paid",
      "Distribute",
      [call(11155111, 1n), call(11155420, 1n), call(11155111, 2n)],
      "relayr",
    );
    batch.calls[0].state = "success";
    batch.calls[0].hash = originalHash;
    batch.calls[1].state = "success";
    batch.calls[1].hash = originalHash;
    batch.rounds[0].state = "success";
    batch.rounds[1].state = "pending";
    batch.rounds[1].bundleUuid = "saved-testnet-paid";
    saveMultichainBatch(batch);
    mocks.wait.mockResolvedValue({
      transactions: [{ request: { chain: 11155111 }, status: { data: { hash: HASH } } }],
    });
    const { result } = renderHook(() => useMultichainBatch());
    await act(async () => {
      const completed = await result.current.runBatch({
        scope: "testnet-paid",
        label: "Distribute",
        calls: [],
      });
      expect(completed.status).toBe("success");
      expect(completed.hashes.map((row) => row.callIndex)).toEqual([0, 1, 2]);
    });
    expect(mocks.wait).toHaveBeenCalledExactlyOnceWith("saved-testnet-paid");
    expect(mocks.quote).not.toHaveBeenCalled();
    expect(mocks.pay).not.toHaveBeenCalled();
    expect(mocks.write).not.toHaveBeenCalled();
    expect(readMultichainBatches()[0].route).toBe("relayr");
  });

  it("keeps fresh testnet Safe batches on the staged proposal route", async () => {
    mocks.safe = true;
    const { result } = renderHook(() => useMultichainBatch());
    await act(async () => {
      expect(
        (
          await result.current.runBatch({
            scope: "testnet-safe",
            label: "Distribute",
            calls: [call(11155111), call(11155420)],
          })
        ).status,
      ).toBe("pending");
    });
    expect(mocks.write).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ chainId: 11155111 }),
    );
    expect(mocks.quote).not.toHaveBeenCalled();
    expect(readMultichainBatches()[0]).toMatchObject({
      route: "direct",
      calls: [{ state: "safe" }, { state: "ready" }],
    });
  });

  it("keeps a soft-failed direct recipient result pending and never repeats its transaction", async () => {
    const topic = `0x${"ef".repeat(32)}` as Hash;
    mocks.receipt.mockResolvedValue({
      transactionHash: HASH,
      status: "success",
      blockHash: HASH,
      blockNumber: 1n,
      logs: [{ address: TARGET, topics: [topic], data: "0x" }],
    });
    const { result } = renderHook(() => useMultichainBatch());
    await act(async () => {
      await expect(
        result.current.runBatch({
          scope: "soft-failure",
          label: "Distribute",
          calls: [{ ...call(1), rejectEvents: [{ topic, address: TARGET }] }],
        }),
      ).rejects.toThrow(/incomplete recipient/);
    });
    expect(readMultichainBatches()[0].calls[0]).toMatchObject({ state: "submitted", hash: HASH });
    await act(async () => {
      await expect(
        result.current.runBatch({ scope: "soft-failure", label: "Distribute", calls: [] }),
      ).rejects.toThrow(/incomplete recipient/);
    });
    expect(mocks.write).toHaveBeenCalledOnce();
  });
  it("resumes original quote funding after reload during an unpaid wallet review", async () => {
    const batch = createMultichainBatch(
      ACCOUNT,
      "funding-review",
      "Distribute",
      [call(1), call(10)],
      "relayr",
    );
    batch.rounds[0].state = "funding";
    batch.rounds[0].bundleUuid = "bundle-1";
    saveMultichainBatch(batch);
    recordTransactionActivity({
      id: "relayr:bundle-1",
      kind: "relayr-bundle",
      title: "Unpaid quote",
      status: "pending",
      message: "Funding review open",
      bundleUuid: "bundle-1",
      relayrPaymentStatus: "unfunded",
      account: ACCOUNT,
    });
    const { result } = renderHook(() => useMultichainBatch());
    await act(async () => {
      expect(
        (await result.current.runBatch({ scope: "funding-review", label: "Distribute", calls: [] }))
          .status,
      ).toBe("success");
    });
    expect(mocks.pay).toHaveBeenCalledOnce();
    expect(mocks.choose).toHaveBeenCalledOnce();
  });
  it("executes all selected allocations, with one chosen funding payment for each explicit round", async () => {
    const { result } = renderHook(() => useMultichainBatch());
    await act(async () => {
      const completed = await result.current.runBatch({
        scope: "auto",
        label: "Distribute",
        calls: [call(1, 1n), call(10, 1n), call(1, 2n)],
      });
      expect(completed.status).toBe("success");
      expect(completed.hashes.map((row) => row.callIndex)).toEqual([0, 1, 2]);
    });
    expect(
      mocks.quote.mock.calls.map((args) => args[0].map((row: MultichainCall) => row.chainId)),
    ).toEqual([[1, 10], [1]]);
    expect(mocks.pay).toHaveBeenCalledTimes(2);
    expect(mocks.choose).toHaveBeenCalledTimes(2);
  });
  it("resumes the frozen paid round without paying again or replaying the completed round", async () => {
    mocks.wait
      .mockImplementationOnce(async () => ({
        transactions: [
          { request: { chain: 1 }, status: { data: { hash: HASH } } },
          { request: { chain: 10 }, status: { data: { hash: HASH } } },
        ],
      }))
      .mockRejectedValueOnce(new Error("destination RPC unavailable"))
      .mockResolvedValue({
        transactions: [{ request: { chain: 1 }, status: { data: { hash: HASH } } }],
      });
    const first = renderHook(() => useMultichainBatch());
    await act(async () => {
      await expect(
        first.result.current.runBatch({
          scope: "auto",
          label: "Distribute",
          calls: [call(1, 1n), call(10, 1n), call(1, 2n)],
        }),
      ).rejects.toThrow(/RPC unavailable/);
    });
    first.unmount();
    const second = renderHook(() => useMultichainBatch());
    expect(second.result.current.getPendingBatch("auto")?.completed).toBe(2);
    await act(async () => {
      expect(
        (await second.result.current.runBatch({ scope: "auto", label: "Distribute", calls: [] }))
          .status,
      ).toBe("success");
    });
    expect(mocks.pay).toHaveBeenCalledTimes(2);
    expect(mocks.quote).toHaveBeenCalledTimes(2);
  });
  it("keeps an unknown direct wallet result locked across reload", async () => {
    mocks.write.mockRejectedValue(new Error("RPC connection lost after send"));
    const first = renderHook(() => useMultichainBatch());
    await act(async () => {
      await expect(
        first.result.current.runBatch({ scope: "one", label: "Distribute", calls: [call(1)] }),
      ).rejects.toThrow(/connection lost/);
    });
    first.unmount();
    const second = renderHook(() => useMultichainBatch());
    await act(async () => {
      await expect(
        second.result.current.runBatch({ scope: "one", label: "Distribute", calls: [] }),
      ).rejects.toThrow(/unknown result/);
    });
    expect(mocks.write).toHaveBeenCalledOnce();
  });
  it("stops after the first Safe proposal without proposing other chains", async () => {
    mocks.safe = true;
    const { result } = renderHook(() => useMultichainBatch());
    await act(async () => {
      expect(
        (
          await result.current.runBatch({
            scope: "safe",
            label: "Distribute",
            calls: [call(1), call(10)],
          })
        ).status,
      ).toBe("pending");
    });
    expect(mocks.write).toHaveBeenCalledOnce();
    expect(mocks.quote).not.toHaveBeenCalled();
    expect(readMultichainBatches()[0].calls.map((row) => row.state)).toEqual(["safe", "ready"]);
  });
  it("never sends when the recovery journal cannot be persisted", async () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    const { result } = renderHook(() => useMultichainBatch());
    await act(async () => {
      await expect(
        result.current.runBatch({ scope: "no-storage", label: "Distribute", calls: [call(1)] }),
      ).rejects.toThrow(/saved for recovery/);
    });
    expect(mocks.write).not.toHaveBeenCalled();
    expect(mocks.quote).not.toHaveBeenCalled();
  });
});
