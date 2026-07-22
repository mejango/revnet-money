import type { ChainPayment, RelayrPostBundleResponse } from "@bananapus/nana-sdk-react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { type Address, type Hex } from "viem";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  config: { id: "relayr-test-config" },
  hookAddress: "0x000000000000000000000000000000000000dEaD" as Address | undefined,
  account: {
    address: "0x000000000000000000000000000000000000dEaD" as Address | undefined,
    chainId: 11155111 as number | undefined,
    connector: { id: "injected", name: "Injected" } as { id: string; name: string } | undefined,
  },
  getAccount: vi.fn(),
  getPublicClient: vi.fn(),
  waitForTransactionReceipt: vi.fn(),
  switchChain: vi.fn(),
  signTypedData: vi.fn(),
  sendTransaction: vi.fn(),
  resumeSafeProposalTracking: vi.fn(),
  clientCall: vi.fn(),
  readContract: vi.fn(),
  estimateGas: vi.fn(),
}));

vi.mock("@wagmi/core", () => ({
  getAccount: mocks.getAccount,
  getPublicClient: mocks.getPublicClient,
  waitForTransactionReceipt: mocks.waitForTransactionReceipt,
}));

vi.mock("wagmi", () => ({
  useAccount: () => ({ address: mocks.hookAddress }),
  useConfig: () => mocks.config,
  useSendTransaction: () => ({
    data: undefined,
    error: null,
    isPending: false,
    isSuccess: false,
    sendTransactionAsync: mocks.sendTransaction,
  }),
  useSignTypedData: () => ({ signTypedDataAsync: mocks.signTypedData }),
  useSwitchChain: () => ({ switchChainAsync: mocks.switchChain }),
}));

vi.mock("@/hooks/useReviewedWriteContract", () => ({
  resumeSafeProposalTracking: mocks.resumeSafeProposalTracking,
}));

const ACCOUNT = "0x000000000000000000000000000000000000dEaD" as Address;
const OTHER_ACCOUNT = "0x000000000000000000000000000000000000bEEF" as Address;
const TARGET = "0x0000000000000000000000000000000000001000" as Address;
const PAYMENT_TARGET = "0x0000000000000000000000000000000000003000" as Address;
const HASH = `0x${"ab".repeat(32)}` as Hex;
const SIGNATURE = `0x${"12".repeat(65)}` as Hex;
const NOW = 1_750_000_000;

const REQUEST = {
  chainId: 11155111 as const,
  data: {
    from: ACCOUNT,
    to: TARGET,
    value: 3n,
    gas: 100_000n,
    data: "0x1234" as Hex,
  },
  review: { label: "Deploy revnet", contractName: "REVDeployer" },
};

function payment(overrides: Partial<ChainPayment> = {}): ChainPayment {
  return {
    amount: "0x10",
    calldata: "0x1234",
    chain: 11155111,
    payment_deadline: String(NOW + 600),
    target: PAYMENT_TARGET,
    token: "0x0000000000000000000000000000000000000000",
    ...overrides,
  };
}

function quote(row = payment()): RelayrPostBundleResponse {
  return {
    bundle_uuid: "bundle-reviewed",
    payment_info: [row],
    per_txn: [],
    txn_uuids: ["tx-reviewed"],
  };
}

async function freshHarness() {
  vi.resetModules();
  const [review, activity, hooks] = await Promise.all([
    import("@/lib/transaction-review"),
    import("@/lib/transaction-activity"),
    import("@/hooks/useReviewedRelayr"),
  ]);
  return { review, activity, hooks };
}

beforeEach(() => {
  window.localStorage.clear();
  vi.setSystemTime(new Date(NOW * 1_000));
  mocks.hookAddress = ACCOUNT;
  mocks.account = {
    address: ACCOUNT,
    chainId: 11155111,
    connector: { id: "injected", name: "Injected" },
  };
  mocks.getAccount.mockImplementation(() => mocks.account);
  mocks.getPublicClient.mockReturnValue({
    call: mocks.clientCall,
    readContract: mocks.readContract,
    estimateGas: mocks.estimateGas,
  });
  mocks.switchChain.mockResolvedValue(undefined);
  mocks.clientCall.mockResolvedValue({ data: "0x" });
  mocks.readContract.mockResolvedValue(4n);
  mocks.estimateGas.mockResolvedValue(21_000n);
  mocks.signTypedData.mockResolvedValue(SIGNATURE);
  mocks.sendTransaction.mockResolvedValue(HASH);
  mocks.waitForTransactionReceipt.mockResolvedValue({ status: "success" });
});

describe("reviewed Relayr authorization hook", () => {
  it("simulates, reviews, signs the exact forward request, and posts only after account rechecks", async () => {
    const events: string[] = [];
    const { review, hooks } = await freshHarness();
    review.registerTransactionReviewHandler(async (request) => {
      events.push("review");
      expect(request).toMatchObject({ kind: "authorization" });
      expect(request.calls[0]).toMatchObject({
        chainId: 11155111,
        from: ACCOUNT,
        to: TARGET,
        value: 3n,
        data: "0x1234",
      });
      expect(request.authorization).toMatchObject({
        primaryType: "ForwardRequest",
        message: { from: ACCOUNT, to: TARGET, nonce: 4n },
      });
      return true;
    });
    mocks.switchChain.mockImplementation(async () => events.push("switch"));
    mocks.clientCall.mockImplementation(async () => events.push("simulate"));
    mocks.readContract.mockImplementation(async () => {
      events.push("nonce");
      return 4n;
    });
    mocks.signTypedData.mockImplementation(async (request) => {
      events.push("sign");
      expect(request.message).toMatchObject({ from: ACCOUNT, nonce: 4n });
      return SIGNATURE;
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        events.push("post");
        const body = JSON.parse(String(init?.body)) as {
          transactions: Array<{ chain: number; target: Address; data: Hex; value: string }>;
        };
        expect(body.transactions).toHaveLength(1);
        expect(body.transactions[0]).toMatchObject({ chain: 11155111, value: "3" });
        expect(body.transactions[0].data).toMatch(/^0x[0-9a-f]+$/);
        return new Response(JSON.stringify(quote()), { status: 200 });
      }),
    );
    const { result } = renderHook(() => hooks.useGetRelayrTxQuote());

    let response: RelayrPostBundleResponse | undefined;
    await act(async () => {
      response = await result.current.getRelayrTxQuote([REQUEST]);
    });

    expect(response?.bundle_uuid).toBe("bundle-reviewed");
    expect(events).toEqual(["switch", "simulate", "nonce", "review", "sign", "post"]);
  });

  it("rejects mismatched senders and same-chain nonce collisions before signing", async () => {
    const { review, hooks } = await freshHarness();
    const reviewer = vi.fn().mockResolvedValue(true);
    review.registerTransactionReviewHandler(reviewer);
    const { result } = renderHook(() => hooks.useGetRelayrTxQuote());

    await expect(
      result.current.getRelayrTxQuote([
        { ...REQUEST, data: { ...REQUEST.data, from: OTHER_ACCOUNT } },
      ]),
    ).rejects.toThrow(/sender does not match/i);
    await expect(
      result.current.getRelayrTxQuote([
        REQUEST,
        { ...REQUEST, data: { ...REQUEST.data, to: PAYMENT_TARGET } },
      ]),
    ).rejects.toThrow(/same onchain nonce/i);
    expect(reviewer).not.toHaveBeenCalled();
    expect(mocks.signTypedData).not.toHaveBeenCalled();
  });

  it("does not sign when the account changes during review", async () => {
    const { review, hooks } = await freshHarness();
    review.registerTransactionReviewHandler(async () => {
      mocks.account = { ...mocks.account, address: OTHER_ACCOUNT };
      return true;
    });
    const { result } = renderHook(() => hooks.useGetRelayrTxQuote());

    await expect(result.current.getRelayrTxQuote([REQUEST])).rejects.toThrow(
      "Connected account changed",
    );
    expect(mocks.signTypedData).not.toHaveBeenCalled();
  });

  it("rejects Safe connectors and incomplete Relayr quotes", async () => {
    mocks.account = {
      address: ACCOUNT,
      chainId: 11155111,
      connector: { id: "safe", name: "Safe" },
    };
    const first = await freshHarness();
    const safe = renderHook(() => first.hooks.useGetRelayrTxQuote());
    await expect(safe.result.current.getRelayrTxQuote([REQUEST])).rejects.toThrow(
      /Safe cannot authorize/i,
    );
    safe.unmount();

    mocks.account = {
      address: ACCOUNT,
      chainId: 11155111,
      connector: { id: "injected", name: "Injected" },
    };
    const second = await freshHarness();
    second.review.registerTransactionReviewHandler(async () => true);
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(
            JSON.stringify({ bundle_uuid: "", payment_info: [], per_txn: [], txn_uuids: [] }),
            { status: 200 },
          ),
        ),
    );
    const incomplete = renderHook(() => second.hooks.useGetRelayrTxQuote());
    await expect(incomplete.result.current.getRelayrTxQuote([REQUEST])).rejects.toThrow(
      /incomplete quote/i,
    );
    expect(mocks.signTypedData).toHaveBeenCalledOnce();
  });
});

describe("reviewed Relayr payment hook", () => {
  it("reviews, estimates, sends, and records a confirmed payment", async () => {
    const { review, activity, hooks } = await freshHarness();
    review.registerTransactionReviewHandler(async (request) => {
      expect(request).toMatchObject({ kind: "transaction", title: "Review Relayr payment" });
      expect(request.calls).toEqual([
        expect.objectContaining({
          chainId: 11155111,
          from: ACCOUNT,
          to: PAYMENT_TARGET,
          value: 16n,
          data: "0x1234",
        }),
      ]);
      return true;
    });
    const { result } = renderHook(() => hooks.useSendRelayrTx());

    let hash: Hex | undefined;
    await act(async () => {
      hash = await result.current.sendRelayrTx(payment());
    });

    expect(hash).toBe(HASH);
    expect(mocks.estimateGas).toHaveBeenCalledWith(
      expect.objectContaining({ account: ACCOUNT, to: PAYMENT_TARGET, value: 16n }),
    );
    expect(mocks.sendTransaction).toHaveBeenCalledWith(
      expect.objectContaining({ chainId: 11155111, to: PAYMENT_TARGET, value: 16n }),
    );
    expect(activity.transactionActivityForHash(HASH)).toMatchObject({
      kind: "relayr-payment",
      status: "success",
    });
  });

  it("rejects invalid deadlines and account changes before payment submission", async () => {
    const { review, hooks } = await freshHarness();
    const reviewer = vi.fn(async () => {
      mocks.account = { ...mocks.account, address: OTHER_ACCOUNT };
      return true;
    });
    review.registerTransactionReviewHandler(reviewer);
    const { result } = renderHook(() => hooks.useSendRelayrTx());

    await expect(
      result.current.sendRelayrTx(payment({ payment_deadline: "not-a-timestamp" })),
    ).rejects.toThrow(/expired/i);
    await expect(result.current.sendRelayrTx(payment())).rejects.toThrow(
      "Connected account changed",
    );
    expect(reviewer).toHaveBeenCalledOnce();
    expect(mocks.estimateGas).not.toHaveBeenCalled();
    expect(mocks.sendTransaction).not.toHaveBeenCalled();
  });

  it("records Safe payments as proposals and never waits for an onchain receipt", async () => {
    mocks.account = {
      address: ACCOUNT,
      chainId: 11155111,
      connector: { id: "safe", name: "Safe" },
    };
    const { review, activity, hooks } = await freshHarness();
    review.registerTransactionReviewHandler(async (request) => {
      expect(request.confirmLabel).toMatch(/propose payment to Safe/i);
      return true;
    });
    const { result } = renderHook(() => hooks.useSendRelayrTx());

    await act(async () => {
      await result.current.sendRelayrTx(payment());
    });

    expect(activity.transactionActivityForHash(HASH)).toMatchObject({
      kind: "safe",
      status: "safe-proposed",
      safeProposalHash: HASH,
    });
    expect(mocks.resumeSafeProposalTracking).toHaveBeenCalledOnce();
    expect(mocks.waitForTransactionReceipt).not.toHaveBeenCalled();
  });

  it("retains a submitted payment as uncertain when receipt lookup fails", async () => {
    const { review, activity, hooks } = await freshHarness();
    review.registerTransactionReviewHandler(async () => true);
    mocks.waitForTransactionReceipt.mockRejectedValue(new Error("RPC unavailable"));
    const { result } = renderHook(() => hooks.useSendRelayrTx());

    await expect(result.current.sendRelayrTx(payment())).rejects.toThrow(
      /confirmation is uncertain/i,
    );
    await waitFor(() =>
      expect(activity.transactionActivityForHash(HASH)).toMatchObject({ status: "pending" }),
    );
  });
});
