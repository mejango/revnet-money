import { safeBatchProposalFor, safeTransactionHash } from "@bananapus/nana-sdk-core/safe-service";
import { waitFor } from "@testing-library/react";
import {
  encodeFunctionData,
  getAddress,
  parseAbi,
  TransactionNotFoundError,
  type Address,
  type Hex,
} from "viem";
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
  simulateContract: vi.fn(),
  simulateCalls: vi.fn(),
  request: vi.fn(),
}));

vi.mock("wagmi/actions", () => ({
  getAccount: mocks.getAccount,
  getPublicClient: () => ({
    simulateCalls: mocks.simulateCalls,
    request: mocks.request,
    // A safeTxHash is never a transaction, so tracking polls the Safe service.
    getTransaction: async ({ hash }: { hash: Hex }) => {
      throw new TransactionNotFoundError({ hash });
    },
  }),
  simulateContract: mocks.simulateContract,
  switchChain: mocks.switchChain,
}));
vi.mock("@wagmi/core", () => ({ sendCalls: mocks.sendCalls }));
vi.mock("wagmi", () => ({
  useConfig: () => mocks.config,
  useWaitForTransactionReceipt: vi.fn(),
  useWriteContract: vi.fn(),
}));

import { proposeSafeBatch, SafeProposalPendingError } from "@/hooks/useReviewedWriteContract";
import {
  dismissTransactionActivity,
  transactionActivityForHash,
  transactionActivitySnapshot,
} from "@/lib/transaction-activity";
import {
  registerTransactionReviewHandler,
  type TransactionReviewRequest,
} from "@/lib/transaction-review";
import { clearViewAs, setViewAs } from "@/lib/view-as";

const ACCOUNT = "0x000000000000000000000000000000000000dEaD" as Address;
const TOKEN = "0x0000000000000000000000000000000000001000" as Address;
const SPENDER = "0x0000000000000000000000000000000000002000" as Address;
const SAFE_TX_HASH = `0x${"ab".repeat(32)}` as Hex;
/** Safe 1.4.1's MultiSendCallOnly, which Safe{Wallet} batches a 1.4.1 Safe's calls through. */
const MULTI_SEND_CALL_ONLY_141 = getAddress("0x9641d764fc13c8b624c04430c7356c1c7c8102e2");
/** A MultiSend the SDK does not list, so a proposal that runs through it can't be bound to the calls. */
const UNLISTED_MULTI_SEND = getAddress("0x0000000000000000000000000000000000005afe");
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

/**
 * The Safe service lists a proposal of `batch` that runs through `multiSend`, and the Safe app
 * answers a proposal with its hash, which this returns.
 */
function listBatchThrough(batch: ReturnType<typeof calls>, multiSend: Address): Hex {
  const encoded = batch.map((call) => ({
    to: call.address,
    value: call.value,
    data: encodeFunctionData({ abi: call.abi, functionName: call.functionName, args: call.args }),
  }));
  const record = { ...safeBatchProposalFor(encoded, 3), to: multiSend };
  const proposal = safeTransactionHash(8453, ACCOUNT, record);
  mocks.sendCalls.mockResolvedValue({ id: proposal });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) =>
      String(input).endsWith(`/multisig-transactions/${proposal}/`)
        ? new Response(JSON.stringify({ ...record, safe: ACCOUNT, isExecuted: false }))
        : new Response("Not found", { status: 404 }),
    ),
  );
  return proposal;
}

describe("one Safe proposal for a whole flow", () => {
  let seen: TransactionReviewRequest | null;
  let approve: boolean;
  beforeEach(() => {
    seen = null;
    approve = true;
    clearViewAs();
    mocks.account.address = ACCOUNT;
    mocks.account.chainId = 8453;
    mocks.account.connector = { id: "safe", name: "Safe" };
    mocks.switchChain.mockImplementation(async (_config, { chainId }) => {
      mocks.account.chainId = chainId;
    });
    mocks.getAccount.mockImplementation(() => mocks.account);
    mocks.sendCalls.mockReset().mockResolvedValue({ id: SAFE_TX_HASH });
    mocks.simulateContract.mockReset().mockResolvedValue({ request: {} });
    mocks.simulateCalls
      .mockReset()
      .mockResolvedValue({ results: [{ status: "success" }, { status: "success" }] });
    registerTransactionReviewHandler(async (request) => {
      seen = request;
      return approve;
    });
  });

  for (const stage of ["review", "switch"] as const) {
    it.each(["account", "disconnected", "connector", "wallet mode", "view-as", "chain"])(
      `refuses a changed %s after the deferred Safe batch ${stage}`,
      async (change) => {
        let release!: () => void;
        let entered = false;
        const wait = new Promise<void>((resolve) => {
          release = resolve;
        });
        const pause = async () => {
          entered = true;
          await wait;
        };
        if (stage === "review")
          registerTransactionReviewHandler(async () => {
            await pause();
            return true;
          });
        else {
          mocks.account.chainId = 1;
          mocks.switchChain.mockImplementation(async (_config, { chainId }) => {
            mocks.account.chainId = chainId;
            await pause();
          });
        }
        const pending = proposeSafeBatch(mocks.config as never, 8453, "Make the market", calls());
        const refused = expect(pending).rejects.toThrow();
        await vi.waitFor(() => expect(entered).toBe(true));
        if (change === "account") mocks.account.address = TOKEN;
        else if (change === "disconnected") mocks.account.address = undefined;
        else if (change === "connector") mocks.account.connector = { id: "safe", name: "Safe" };
        else if (change === "wallet mode") mocks.account.connector!.id = "injected";
        else if (change === "view-as") setViewAs(TOKEN);
        else {
          mocks.account.chainId = 10;
          // A chain change during review may be corrected by the requested switch.
          // Refuse a wallet that acknowledges that switch without applying it.
          mocks.switchChain.mockResolvedValue(undefined);
        }
        release();
        await refused;
        expect(mocks.sendCalls).not.toHaveBeenCalled();
      },
    );
  }

  it("wallet-action:safe-batch reviews every call in order, sends them as one batch, and tracks the proposal", async () => {
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
    // wallet_sendCalls carries no Safe gas; Safe{Wallet} picks it, so the review claims none.
    expect(seen!.calls.every((call) => call.from === ACCOUNT && call.safeTxGas === undefined)).toBe(
      true,
    );
    expect(seen!.description).toContain("one batch");
    expect(mocks.simulateCalls).toHaveBeenCalledWith({ account: ACCOUNT, calls: expected });
    expect(mocks.simulateContract).not.toHaveBeenCalled();
    expect(mocks.sendCalls).toHaveBeenCalledWith(mocks.config, { chainId: 8453, calls: expected });
    const activity = transactionActivitySnapshot().find((row) => row.hash === SAFE_TX_HASH);
    expect(activity?.status).toBe("safe-proposed");
    expect(activity?.kind).toBe("safe");
    // The journal keeps what the proposal must run, so only that batch can confirm it.
    expect(activity?.safeProposal).toEqual({
      safe: ACCOUNT,
      calls: expected.map((call) => ({ ...call, value: String(call.value ?? 0n) })),
      batch: true,
    });

    // The same batch again is the pending proposal, not a second one.
    await expect(
      proposeSafeBatch(mocks.config as never, 8453, "Make the market", CALLS),
    ).rejects.toBeInstanceOf(SafeProposalPendingError);
    expect(mocks.sendCalls).toHaveBeenCalledTimes(1);
  });

  it("refuses the same batch while a proposal it can't confirm is listed, and takes it once dismissed", async () => {
    const CALLS = calls();
    const proposal = listBatchThrough(CALLS, UNLISTED_MULTI_SEND);

    await proposeSafeBatch(mocks.config as never, 8453, "Make the market", CALLS);
    await waitFor(() =>
      expect(transactionActivityForHash(proposal)).toMatchObject({
        status: "safe-proposed",
        message:
          "This Safe transaction's result can't be confirmed here. Check it in Safe before retrying.",
        safeResultUnconfirmed: true,
      }),
    );

    const refused = await proposeSafeBatch(
      mocks.config as never,
      8453,
      "Make the market",
      CALLS,
    ).catch((cause: unknown) => cause);
    expect(refused).toBeInstanceOf(SafeProposalPendingError);
    expect((refused as Error).message).toContain(
      "Check it in Safe, then dismiss it in your account activity.",
    );
    expect(mocks.sendCalls).toHaveBeenCalledTimes(1);

    dismissTransactionActivity(transactionActivityForHash(proposal)!.id);
    mocks.sendCalls.mockResolvedValue({ id: SAFE_TX_HASH });
    await proposeSafeBatch(mocks.config as never, 8453, "Make the market", CALLS);
    expect(mocks.sendCalls).toHaveBeenCalledTimes(2);
  });

  it("follows a proposal that runs the batch through Safe 1.4.1's MultiSendCallOnly", async () => {
    const CALLS = calls();
    const proposal = listBatchThrough(CALLS, MULTI_SEND_CALL_ONLY_141);

    await proposeSafeBatch(mocks.config as never, 8453, "Make the market", CALLS);
    await waitFor(() =>
      expect(transactionActivityForHash(proposal)).toMatchObject({
        status: "safe-proposed",
        message: "Safe proposal is not executed. It remains asynchronous; do not submit it again.",
      }),
    );
    expect(transactionActivityForHash(proposal)?.safeResultUnconfirmed).toBeUndefined();
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

  it("simulates standalone calls one by one when the RPC lacks eth_simulateV1", async () => {
    mocks.simulateCalls.mockRejectedValue(
      Object.assign(new Error("JSON-RPC method is not allowed"), { code: -32601 }),
    );
    mocks.request.mockReset().mockResolvedValue("0x");
    const [first, second] = calls();
    await proposeSafeBatch(mocks.config as never, 8453, "Make the market", [
      first!,
      { ...second!, dependsOnPrior: true },
    ]);
    // Only the standalone approval runs alone; the dependent call is left to Safe.
    expect(mocks.request).toHaveBeenCalledTimes(1);
    expect(mocks.request.mock.calls[0]![0]).toMatchObject({
      method: "eth_call",
      params: [{ from: ACCOUNT, to: TOKEN }, "latest"],
    });
    expect(mocks.sendCalls).toHaveBeenCalledTimes(1);

    mocks.request.mockRejectedValueOnce(new Error("allowance"));
    await expect(
      proposeSafeBatch(mocks.config as never, 8453, "Make the market", calls()),
    ).rejects.toThrow("step 1");
    expect(mocks.sendCalls).toHaveBeenCalledTimes(1);
  });

  it("stops on a lagging node or a revert instead of skipping the dependent call's simulation", async () => {
    // viem's message quotes the request body, which names eth_simulateV1; only
    // the node's own details and the code say what failed.
    for (const failure of [
      Object.assign(new Error('header not found\n\nRequest body: {"method":"eth_simulateV1"}'), {
        code: -32000,
        details: "header not found",
      }),
      Object.assign(new Error("execution reverted: not allowed"), {
        code: 3,
        details: "execution reverted: not allowed",
      }),
    ]) {
      mocks.simulateCalls.mockRejectedValueOnce(failure);
      mocks.request.mockReset().mockResolvedValue("0x");
      await expect(
        proposeSafeBatch(mocks.config as never, 8453, "Make the market", calls()),
      ).rejects.toThrow("could not be simulated");
      expect(mocks.request).not.toHaveBeenCalled();
    }
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

  it("refuses a batch built for another account, such as a mint to the account that reviewed it", async () => {
    const other = "0x000000000000000000000000000000000000bEEF" as Address;
    await expect(
      proposeSafeBatch(mocks.config as never, 8453, "Make the market", calls(), other),
    ).rejects.toThrow("The connected account changed. Review again.");
    expect(mocks.simulateCalls).not.toHaveBeenCalled();
    expect(seen).toBeNull();
    expect(mocks.sendCalls).not.toHaveBeenCalled();

    await proposeSafeBatch(mocks.config as never, 8453, "Make the market", calls(), ACCOUNT);
    expect(mocks.sendCalls).toHaveBeenCalledTimes(1);
  });
});
