import { encodeFunctionData, parseAbi, type Address, type Hex } from "viem";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  config: { id: "test-config", chains: [{ id: 8453, name: "Base" }] },
  account: {
    address: "0x000000000000000000000000000000000000dEaD" as Address | undefined,
    chainId: 8453 as number | undefined,
    connector: { id: "safe", name: "Safe" } as { id: string; name: string } | undefined,
  },
  getAccount: vi.fn(),
  switchChain: vi.fn(),
  sendCalls: vi.fn(),
  simulateCalls: vi.fn(),
}));

vi.mock("wagmi/actions", () => ({
  getAccount: mocks.getAccount,
  getPublicClient: () => ({ simulateCalls: mocks.simulateCalls }),
  simulateContract: vi.fn(),
  switchChain: mocks.switchChain,
}));
vi.mock("@wagmi/core", () => ({ sendCalls: mocks.sendCalls }));
vi.mock("wagmi", () => ({
  useConfig: () => mocks.config,
  useWaitForTransactionReceipt: vi.fn(),
  useWriteContract: vi.fn(),
}));

import {
  BatchSimulationUnavailableError,
  proposeSafeBatch,
  SafeProposalPendingError,
} from "@/hooks/useReviewedWriteContract";
import { transactionActivitySnapshot } from "@/lib/transaction-activity";
import {
  registerTransactionReviewHandler,
  type TransactionReviewRequest,
} from "@/lib/transaction-review";

const ACCOUNT = "0x000000000000000000000000000000000000dEaD" as Address;
const TOKEN = "0x0000000000000000000000000000000000001000" as Address;
const SPENDER = "0x0000000000000000000000000000000000002000" as Address;
const SAFE_TX_HASH = `0x${"ab".repeat(32)}` as Hex;
const ERC20 = parseAbi(["function approve(address spender, uint256 amount)"]);
let nonce = 0n;
// Distinct amounts per test so the duplicate guard sees a fresh batch each time.
const calls = () => {
  nonce += 1n;
  return [
    {
      address: TOKEN,
      abi: ERC20,
      functionName: "approve" as const,
      args: [SPENDER, nonce] as const,
    },
    {
      address: SPENDER,
      abi: ERC20,
      functionName: "approve" as const,
      args: [TOKEN, nonce * 2n] as const,
      value: 1n,
    },
  ];
};

describe("wallet-action:safe-batch — one Safe proposal for a whole flow", () => {
  let seen: TransactionReviewRequest | null;
  let approve: boolean;
  beforeEach(() => {
    seen = null;
    approve = true;
    mocks.account.connector = { id: "safe", name: "Safe" };
    mocks.getAccount.mockImplementation(() => mocks.account);
    mocks.sendCalls.mockReset().mockResolvedValue({ id: SAFE_TX_HASH });
    mocks.simulateCalls
      .mockReset()
      .mockResolvedValue({ results: [{ status: "success" }, { status: "success" }] });
    registerTransactionReviewHandler(async (request) => {
      seen = request;
      return approve;
    });
  });

  it("reviews every call in order, sends them as one batch, and tracks the proposal", async () => {
    const CALLS = calls();
    const hash = await proposeSafeBatch(mocks.config as never, 8453, "Make the market", CALLS);

    expect(hash).toBe(SAFE_TX_HASH);
    const expected = CALLS.map((call) => ({
      to: call.address,
      value: call.value,
      data: encodeFunctionData({ abi: call.abi, functionName: call.functionName, args: call.args }),
    }));
    expect(
      seen!.calls.map((call) => ({ to: call.to, value: call.value, data: call.data })),
    ).toEqual(expected);
    expect(seen!.calls.every((call) => call.from === ACCOUNT && call.safeTxGas === 0n)).toBe(true);
    expect(seen!.description).toContain("one batch");
    expect(mocks.simulateCalls).toHaveBeenCalledWith({ account: ACCOUNT, calls: expected });
    expect(mocks.sendCalls).toHaveBeenCalledWith(mocks.config, { chainId: 8453, calls: expected });
    const activity = transactionActivitySnapshot().find((row) => row.hash === SAFE_TX_HASH);
    expect(activity?.status).toBe("safe-proposed");
    expect(activity?.kind).toBe("safe");

    // The same batch again is the pending proposal, not a second one.
    await expect(
      proposeSafeBatch(mocks.config as never, 8453, "Make the market", CALLS),
    ).rejects.toBeInstanceOf(SafeProposalPendingError);
    expect(mocks.sendCalls).toHaveBeenCalledTimes(1);
  });

  it("refuses a batch whose sequence reverts in simulation", async () => {
    mocks.simulateCalls.mockResolvedValue({
      results: [{ status: "success" }, { status: "failure", error: new Error("allowance") }],
    });
    await expect(
      proposeSafeBatch(mocks.config as never, 8453, "Make the market", calls()),
    ).rejects.toThrow("step 2");
    expect(seen).toBeNull();
    expect(mocks.sendCalls).not.toHaveBeenCalled();
  });

  it("hands back to the step-by-step path when the RPC cannot simulate a batch", async () => {
    mocks.simulateCalls.mockRejectedValue(new Error("Method not found"));
    await expect(
      proposeSafeBatch(mocks.config as never, 8453, "Make the market", calls()),
    ).rejects.toBeInstanceOf(BatchSimulationUnavailableError);
    expect(seen).toBeNull();
    expect(mocks.sendCalls).not.toHaveBeenCalled();
  });

  it("sends nothing when the review is closed", async () => {
    approve = false;
    await expect(
      proposeSafeBatch(mocks.config as never, 8453, "Make the market", calls()),
    ).rejects.toThrow("Nothing was sent");
    expect(mocks.sendCalls).not.toHaveBeenCalled();
  });

  it("refuses outside a Safe connection", async () => {
    mocks.account.connector = { id: "injected", name: "Injected" };
    await expect(
      proposeSafeBatch(mocks.config as never, 8453, "Make the market", calls()),
    ).rejects.toThrow("Safe connection");
    expect(mocks.sendCalls).not.toHaveBeenCalled();
  });
});
