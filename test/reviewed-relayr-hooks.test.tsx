import type { ReviewedRelayrRequest } from "@/hooks/useReviewedRelayr";
import type { ChainPayment, RelayrPostBundleResponse } from "@/lib/nana/types";
import type { TransactionReviewRequest } from "@/lib/transaction-review";
import { SAFE_EXEC_ABI } from "@bananapus/nana-sdk-core/safe-service";
import { JB_PROJECT_PAYER_DEPLOYER, jbProjectPayerDeployerAbi } from "@bananapus/nana-sdk-core/v6";
import { act, renderHook } from "@testing-library/react";
import {
  encodeAbiParameters,
  encodeFunctionData,
  HttpRequestError,
  toFunctionSelector,
  zeroAddress,
  type Address,
  type Hex,
} from "viem";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ACCOUNT,
  BLOCK_HASH,
  BUNDLE_UUID,
  HASH,
  NOW,
  onchain,
  OTHER_BUNDLE_UUID,
  payment,
  PAYMENT_RUNTIME,
  PAYMENT_TARGET,
  relayrApi,
  TARGET,
  TX_UUIDS,
} from "./relayr-fixtures";

const mocks = vi.hoisted(() => ({
  config: { id: "relayr-test-config" },
  hookAddress: "0x000000000000000000000000000000000000dEaD" as Address | undefined,
  account: {
    address: "0x000000000000000000000000000000000000dEaD" as Address | undefined,
    chainId: 1 as number | undefined,
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
  getCode: vi.fn(),
  getTransaction: vi.fn(),
  getTransactionReceipt: vi.fn(),
  getBlock: vi.fn(),
}));

vi.mock("wagmi/actions", () => ({
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

vi.mock("@/lib/wagmiConfig", () => ({ wagmiConfig: mocks.config }));

const OTHER_ACCOUNT = "0x000000000000000000000000000000000000bEEF" as Address;
const SIGNATURE = `0x${"12".repeat(65)}` as Hex;

const REQUEST = {
  chainId: 1 as const,
  data: {
    from: ACCOUNT,
    to: TARGET,
    value: 3n,
    gas: 100_000n,
    data: "0x1234" as Hex,
  },
  review: { label: "Deploy revnet", contractName: "REVDeployer" },
};

function quote(row = payment()): RelayrPostBundleResponse {
  return { bundle_uuid: BUNDLE_UUID, payment_info: [row] };
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
    chainId: 1,
    connector: { id: "injected", name: "Injected" },
  };
  mocks.getAccount.mockImplementation(() => mocks.account);
  mocks.getPublicClient.mockReturnValue({
    call: mocks.clientCall,
    readContract: mocks.readContract,
    estimateGas: mocks.estimateGas,
    getCode: mocks.getCode,
    getTransaction: mocks.getTransaction,
    getTransactionReceipt: mocks.getTransactionReceipt,
    getBlock: mocks.getBlock,
  });
  mocks.switchChain.mockImplementation(async ({ chainId }: { chainId: number }) => {
    mocks.account.chainId = chainId;
  });
  mocks.clientCall.mockResolvedValue({ data: "0x" });
  mocks.readContract.mockImplementation(
    async ({ functionName, address }: { functionName: string; address: Address }) =>
      functionName === "isTrustedForwarder"
        ? true
        : functionName === "eip712Domain"
          ? ["0x0f", "Juicebox", "1", BigInt(mocks.account.chainId!), address, HASH, []]
          : 4n,
  );
  mocks.getCode.mockResolvedValue(PAYMENT_RUNTIME);
  mocks.getTransaction.mockResolvedValue(onchain(PAYMENT_TARGET, payment().calldata));
  mocks.getTransactionReceipt.mockResolvedValue(onchain(PAYMENT_TARGET, payment().calldata));
  mocks.getBlock.mockResolvedValue({ hash: BLOCK_HASH });
  mocks.estimateGas.mockResolvedValue(21_000n);
  mocks.signTypedData.mockResolvedValue(SIGNATURE);
  mocks.sendTransaction.mockResolvedValue(HASH);
  mocks.waitForTransactionReceipt.mockImplementation(
    async (_config: unknown, { hash }: { hash: Hex }) => ({
      status: "success",
      transactionHash: hash,
    }),
  );
});

const FINAL_BLOCK = 200n;
const FINAL_HASH = `0x${"fe".repeat(32)}` as Hex;

/**
 * The chain as the session rules read it: the finalized block's timestamp and
 * the forwarder's nonce for the signer there, and the latest nonce.
 */
function chainAt({
  timestamp,
  finalizedNonce,
  liveNonce = finalizedNonce,
}: {
  timestamp: number;
  finalizedNonce: bigint;
  liveNonce?: bigint;
}) {
  mocks.getBlock.mockImplementation(
    async ({ blockTag, blockNumber }: { blockTag?: string; blockNumber?: bigint }) =>
      blockTag === "finalized"
        ? { number: FINAL_BLOCK, hash: FINAL_HASH, timestamp: BigInt(timestamp) }
        : { hash: blockNumber === FINAL_BLOCK ? FINAL_HASH : BLOCK_HASH },
  );
  mocks.readContract.mockImplementation(
    async ({
      functionName,
      address,
      blockNumber,
    }: {
      functionName: string;
      address: Address;
      blockNumber?: bigint;
    }) =>
      functionName === "isTrustedForwarder"
        ? true
        : functionName === "eip712Domain"
          ? ["0x0f", "Juicebox", "1", BigInt(mocks.account.chainId!), address, HASH, []]
          : functionName === "nonces"
            ? blockNumber === undefined
              ? liveNonce
              : finalizedNonce
            : functionName === "verify"
              ? liveNonce === finalizedNonce
              : 4n,
  );
}

describe("reviewed Relayr authorization hook", () => {
  it("simulates, reviews, signs the exact forward request, and posts only after account rechecks", async () => {
    const events: string[] = [];
    const { review, hooks } = await freshHarness();
    review.registerTransactionReviewHandler(async (request) => {
      events.push("review");
      expect(request).toMatchObject({ kind: "authorization" });
      expect(request.calls[0]).toMatchObject({
        chainId: 1,
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
    mocks.readContract.mockImplementation(
      async ({ functionName, address }: { functionName: string; address: Address }) => {
        if (functionName === "isTrustedForwarder") return true;
        if (functionName === "eip712Domain")
          return ["0x0f", "Juicebox", "1", 1n, address, HASH, []];
        events.push("nonce");
        return 4n;
      },
    );
    mocks.signTypedData.mockImplementation(async (request) => {
      events.push("sign");
      expect(request.message).toMatchObject({ from: ACCOUNT, nonce: 4n });
      return SIGNATURE;
    });
    const relayr = relayrApi();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (init?.method !== "POST") {
          events.push("read");
          expect(init).toMatchObject({ cache: "no-store" });
          return relayr(url, init);
        }
        events.push("post");
        const body = JSON.parse(String(init?.body)) as {
          transactions: Array<{ chain: number; target: Address; data: Hex; value: string }>;
        };
        expect(body.transactions).toHaveLength(1);
        expect(body.transactions[0]).toMatchObject({ chain: 1, value: "3" });
        expect(body.transactions[0].data).toMatch(/^0x[0-9a-f]+$/);
        return relayr(url, init);
      }),
    );
    const { result } = renderHook(() => hooks.useGetRelayrTxQuote());

    let response: RelayrPostBundleResponse | undefined;
    await act(async () => {
      response = await result.current.getRelayrTxQuote([REQUEST]);
    });

    expect(response?.bundle_uuid).toBe(BUNDLE_UUID);
    // Relayr's records are read and bound before the quote, and its payment, are offered.
    expect(events).toEqual(["switch", "simulate", "nonce", "review", "sign", "post", "read"]);
  });

  it.each([
    ["the measured gas with headroom", 80_000n, 160_000n],
    ["the caller's larger gas", 21_000n, 100_000n],
  ])(
    "shows the gas the forward request signs (%s) as the reviewed gas limit",
    async (_, estimate, signed) => {
      const { review, hooks } = await freshHarness();
      mocks.estimateGas.mockResolvedValue(estimate);
      const reviewer = vi.fn(async (_request: TransactionReviewRequest) => true);
      review.registerTransactionReviewHandler(reviewer);
      vi.stubGlobal("fetch", relayrApi());
      const { result } = renderHook(() => hooks.useGetRelayrTxQuote());
      await act(async () => {
        await result.current.getRelayrTxQuote([REQUEST]);
      });
      const [request] = reviewer.mock.calls[0];
      expect(request.calls[0].gas).toBe(signed);
      expect(request.authorization).toMatchObject({ message: { gas: signed } });
      expect(mocks.signTypedData).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({ message: expect.objectContaining({ gas: signed }) }),
      );
    },
  );

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
      chainId: 1,
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
      chainId: 1,
      connector: { id: "injected", name: "Injected" },
    };
    const second = await freshHarness();
    second.review.registerTransactionReviewHandler(async () => true);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ bundle_uuid: "", payment_info: [], tx_uuids: [] }), {
          status: 200,
        }),
      ),
    );
    const incomplete = renderHook(() => second.hooks.useGetRelayrTxQuote());
    await expect(incomplete.result.current.getRelayrTxQuote([REQUEST])).rejects.toThrow(
      "Relayr returned no valid bundle ID. Nothing was paid.",
    );
    expect(mocks.signTypedData).toHaveBeenCalledOnce();
  });
  it("signs one authorization per destination and posts them in one bundle", async () => {
    const { review, hooks } = await freshHarness();
    review.registerTransactionReviewHandler(async () => true);
    vi.stubGlobal("fetch", relayrApi());
    const { result } = renderHook(() => hooks.useGetRelayrTxQuote());
    await act(async () => {
      await result.current.getRelayrTxQuote([REQUEST, { ...REQUEST, chainId: 10 }]);
    });
    expect(mocks.signTypedData.mock.calls.map(([request]) => request.domain.chainId)).toEqual([
      1, 10,
    ]);
    const posted = JSON.parse(String(vi.mocked(fetch).mock.calls[0][1]?.body));
    expect(posted.virtual_nonce_mode).toBe("ChainIndependent");
    expect(
      posted.transactions.map(
        ({ chain, virtual_nonce }: { chain: number; virtual_nonce: number }) => [
          chain,
          virtual_nonce,
        ],
      ),
    ).toEqual([
      [1, 0],
      [10, 0],
    ]);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(mocks.sendTransaction).not.toHaveBeenCalled();
  });

  it("binds each signed call to the record carrying its exact request when Relayr lists IDs out of order", async () => {
    const { review, activity, hooks } = await freshHarness();
    review.registerTransactionReviewHandler(async () => true);
    // Relayr gives chain 1 the first ID and chain 10 the second, but lists both
    // out of posted order, here under the legacy txn_uuids name.
    const relayr = relayrApi({
      quote: (quoted) => ({ txn_uuids: [...quoted].reverse() }),
      records: (echoed) => [...echoed].reverse(),
    });
    vi.stubGlobal("fetch", relayr);
    const { result } = renderHook(() => hooks.useGetRelayrTxQuote());
    await act(async () => {
      await result.current.getRelayrTxQuote([REQUEST, { ...REQUEST, chainId: 10 }]);
    });
    expect(
      activity
        .transactionActivitySnapshot()[0]
        .relayrExpectedTransactions?.map(({ chainId, transactionUuid }) => [
          chainId,
          transactionUuid,
        ]),
    ).toEqual([
      [1, TX_UUIDS[0]],
      [10, TX_UUIDS[1]],
    ]);
    expect(relayr).toHaveBeenLastCalledWith(
      `https://api.relayr.ba5ed.com/v1/bundle/${BUNDLE_UUID}`,
      expect.objectContaining({ cache: "no-store" }),
    );
  });

  const UNBOUND = "Relayr did not bind every quoted transaction to a unique ID. Nothing was paid.";
  const UNRETURNED = "Relayr did not return the quoted transactions. Nothing was paid.";
  it.each<[string, Parameters<typeof relayrApi>[0], string]>([
    [
      "an extra record",
      { records: (echoed) => [...echoed, { ...echoed[0], tx_uuid: TX_UUIDS[2] }] },
      UNBOUND,
    ],
    [
      "a repeated record ID",
      { records: (echoed) => echoed.map((record) => ({ ...record, tx_uuid: TX_UUIDS[0] })) },
      UNBOUND,
    ],
    [
      "a repeated quoted ID",
      { quote: ([first]) => ({ tx_uuids: [first, first], txn_uuids: [first, first] }) },
      UNBOUND,
    ],
    ["a foreign bundle_uuid", { bundle: { bundle_uuid: OTHER_BUNDLE_UUID } }, UNRETURNED],
    ["a missing signed call", { records: (echoed) => echoed.slice(0, 1) }, UNBOUND],
    [
      "a changed signed call",
      {
        records: (echoed) =>
          echoed.map((record, index) =>
            index ? { ...record, request: { ...record.request, data: "0x5678" } } : record,
          ),
      },
      UNBOUND,
    ],
  ])("offers no payment for a bundle with %s", async (_, api, message) => {
    const { review, activity, hooks } = await freshHarness();
    review.registerTransactionReviewHandler(async () => true);
    vi.stubGlobal("fetch", relayrApi(api));
    const { result } = renderHook(() => hooks.useGetRelayrTxQuote());
    await act(async () => {
      await expect(
        result.current.getRelayrTxQuote([REQUEST, { ...REQUEST, chainId: 10 }]),
      ).rejects.toThrow(message);
    });
    expect(result.current.data).toBeUndefined();
    // Only the publication lock for the signed calls remains: no payable quote.
    expect(activity.transactionActivitySnapshot()).toEqual([
      expect.objectContaining({
        title: "Relayr authorization publication",
        relayrPaymentStatus: "unfunded",
      }),
    ]);
    const payer = renderHook(() => hooks.useSendRelayrTx());
    await expect(payer.result.current.sendRelayrTx(payment())).rejects.toThrow(
      /does not belong to a reviewed Relayr quote/,
    );
    expect(mocks.sendTransaction).not.toHaveBeenCalled();
  });

  it("blocks unsupported networks and untrusted forwarders before authorizing", async () => {
    const { review, hooks } = await freshHarness();
    review.registerTransactionReviewHandler(async () => true);
    const { result } = renderHook(() => hooks.useGetRelayrTxQuote());
    await expect(
      result.current.getRelayrTxQuote([{ ...REQUEST, chainId: 56 as typeof REQUEST.chainId }]),
    ).rejects.toThrow(/direct transaction flow/);
    mocks.readContract.mockResolvedValue(false);
    await expect(result.current.getRelayrTxQuote([REQUEST])).rejects.toThrow(
      /does not trust this forwarder/,
    );
    expect(mocks.signTypedData).not.toHaveBeenCalled();
  });

  it("rejects mixed mainnet and testnet destinations before any authorization", async () => {
    const { review, hooks } = await freshHarness();
    const reviewer = vi.fn().mockResolvedValue(true);
    review.registerTransactionReviewHandler(reviewer);
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    const { result } = renderHook(() => hooks.useGetRelayrTxQuote());
    await expect(
      result.current.getRelayrTxQuote([REQUEST, { ...REQUEST, chainId: 11155111 }]),
    ).rejects.toThrow(/only mainnets or only testnets/);
    expect(reviewer).not.toHaveBeenCalled();
    expect(mocks.signTypedData).not.toHaveBeenCalled();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("refuses a domain from another deployment", async () => {
    const { review, hooks } = await freshHarness();
    review.registerTransactionReviewHandler(async () => true);
    mocks.readContract.mockImplementation(async ({ functionName }) =>
      functionName === "isTrustedForwarder"
        ? true
        : functionName === "nonces"
          ? 4n
          : ["0x0f", "Juicebox", "1", 1n, TARGET, HASH, []],
    );
    const { result } = renderHook(() => hooks.useGetRelayrTxQuote());
    await expect(result.current.getRelayrTxQuote([REQUEST])).rejects.toThrow(
      /domain does not match/,
    );
    expect(mocks.signTypedData).not.toHaveBeenCalled();
  });

  it("quotes the published signatures again when POST may have reached Relayr but its response is lost, and never signs a new copy while they can run", async () => {
    const { review, activity, hooks } = await freshHarness();
    review.registerTransactionReviewHandler(async () => true);
    const posts: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        expect(activity.transactionActivitySnapshot()[0]).toMatchObject({
          kind: "relayr-bundle",
          relayrPaymentStatus: "unfunded",
          relayrNonces: ["4"],
        });
        posts.push(String(init?.body));
        throw new Error("connection reset after POST");
      }),
    );
    const { result } = renderHook(() => hooks.useGetRelayrTxQuote());
    await expect(result.current.getRelayrTxQuote([REQUEST])).rejects.toThrow(/connection reset/);
    // The same calls go out again with the signatures already published.
    await expect(result.current.getRelayrTxQuote([REQUEST])).rejects.toThrow(/connection reset/);
    expect(mocks.signTypedData).toHaveBeenCalledOnce();
    expect(posts).toHaveLength(2);
    expect(posts[1]).toBe(posts[0]);
    // Another operation on the same forwarder nonce waits while they can run.
    await expect(
      result.current.getRelayrTxQuote([{ ...REQUEST, data: { ...REQUEST.data, data: "0x5678" } }]),
    ).rejects.toThrow(/already has published authorizations/);
    // A signed forward request stays executable for 47 hours. Past that deadline by
    // the device clock but not at a finalized block, it still holds.
    vi.setSystemTime(new Date((NOW + 48 * 3600) * 1_000));
    await expect(result.current.getRelayrTxQuote([REQUEST])).rejects.toThrow(
      /earlier signature (can|may) still run/,
    );
    expect(mocks.signTypedData).toHaveBeenCalledOnce();
    expect(posts).toHaveLength(2);
  });

  it("blocks a newly selected subset of calls from an unresolved bundle", async () => {
    const { review, hooks } = await freshHarness();
    review.registerTransactionReviewHandler(async () => true);
    vi.stubGlobal("fetch", relayrApi());
    const { result } = renderHook(() => hooks.useGetRelayrTxQuote());
    await act(async () => {
      await result.current.getRelayrTxQuote([REQUEST, { ...REQUEST, chainId: 10 }]);
    });
    await expect(result.current.getRelayrTxQuote([REQUEST])).rejects.toThrow(
      /earlier signature can still run until/,
    );
    expect(mocks.signTypedData).toHaveBeenCalledTimes(2);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it.each([false, true])(
    "blocks a different operation sharing an unresolved signer and forwarder nonce (legacy activity: %s)",
    async (legacyActivity) => {
      const { review, activity, hooks } = await freshHarness();
      review.registerTransactionReviewHandler(async () => true);
      vi.stubGlobal("fetch", relayrApi());
      const { result } = renderHook(() => hooks.useGetRelayrTxQuote());
      await act(async () => {
        await result.current.getRelayrTxQuote([{ ...REQUEST, recoveryScope: "metadata:1:4" }]);
      });
      const published = activity.transactionActivitySnapshot().find((item) => item.relayrQuote);
      expect(published?.relayrCallKeys?.some((key) => key.includes("forwarder-nonce:1:"))).toBe(
        true,
      );
      if (legacyActivity) {
        activity.updateTransactionActivity(published!.id, { relayrCallKeys: [] });
      }
      await expect(
        result.current.getRelayrTxQuote([
          { ...REQUEST, recoveryScope: "tokens:1:4", data: { ...REQUEST.data, data: "0x5678" } },
        ]),
      ).rejects.toThrow(/published authorizations/);
      expect(mocks.signTypedData).toHaveBeenCalledOnce();
      expect(fetch).toHaveBeenCalledTimes(2);
    },
  );

  it("does not publish signatures if browser recovery storage cannot persist them", async () => {
    const { review, hooks } = await freshHarness();
    review.registerTransactionReviewHandler(async () => true);
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota exceeded");
    });
    const { result } = renderHook(() => hooks.useGetRelayrTxQuote());
    await expect(result.current.getRelayrTxQuote([REQUEST])).rejects.toThrow(
      /recovery storage is unavailable/,
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each(["not json", "{}", "[null]"])(
    "blocks signing and direct fallback when the saved activity journal is invalid: %s",
    async (corrupt) => {
      const { review, hooks } = await freshHarness();
      review.registerTransactionReviewHandler(async () => true);
      window.localStorage.setItem("revnet:transaction-activities:v1", corrupt);
      const { result } = renderHook(() => hooks.useGetRelayrTxQuote());
      await expect(result.current.getRelayrTxQuote([REQUEST])).rejects.toThrow(
        /storage is unavailable/,
      );
      await expect(
        hooks.requireRelayrRecoveryScopeAvailable(ACCOUNT, "project-credits:1:4"),
      ).rejects.toThrow(/storage is unavailable/);
      expect(mocks.signTypedData).not.toHaveBeenCalled();
      expect(fetch).not.toHaveBeenCalled();
      expect(window.localStorage.getItem("revnet:transaction-activities:v1")).toBe(corrupt);
    },
  );

  it("retains a logical launch lock when a retry changes salt or calldata", async () => {
    const { review, hooks } = await freshHarness();
    review.registerTransactionReviewHandler(async () => true);
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("POST response lost")));
    const { result } = renderHook(() => hooks.useGetRelayrTxQuote());
    await expect(
      result.current.getRelayrTxQuote([{ ...REQUEST, recoveryScope: "revnet-launch" }]),
    ).rejects.toThrow(/POST response lost/);
    await expect(
      hooks.requireRelayrRecoveryScopeAvailable(ACCOUNT, "revnet-launch"),
    ).rejects.toThrow(/earlier signature can still run until/);
    await expect(
      result.current.getRelayrTxQuote([
        { ...REQUEST, recoveryScope: "revnet-launch", data: { ...REQUEST.data, data: "0x5678" } },
      ]),
    ).rejects.toThrow(/earlier signature can still run until/);
    expect(mocks.signTypedData).toHaveBeenCalledOnce();
  });

  it.each(["project-metadata:1:4", "project-splits:1:4:123:1"])(
    "keeps changed setter calldata blocked by an unresolved destination scope: %s",
    async (recoveryScope) => {
      const { review, hooks } = await freshHarness();
      review.registerTransactionReviewHandler(async () => true);
      vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("POST response lost")));
      const { result } = renderHook(() => hooks.useGetRelayrTxQuote());
      await expect(
        result.current.getRelayrTxQuote([{ ...REQUEST, recoveryScope }]),
      ).rejects.toThrow(/POST response lost/);
      await expect(
        result.current.getRelayrTxQuote([
          { ...REQUEST, recoveryScope, data: { ...REQUEST.data, data: "0x5678" } },
        ]),
      ).rejects.toThrow(/earlier signature can still run until/);
      expect(mocks.signTypedData).toHaveBeenCalledOnce();
      expect(fetch).toHaveBeenCalledOnce();
    },
  );

  it("resumes a persisted unpaid quote after reload without signing or publishing again", async () => {
    const first = await freshHarness();
    first.review.registerTransactionReviewHandler(async () => true);
    vi.stubGlobal("fetch", relayrApi());
    const initial = renderHook(() => first.hooks.useGetRelayrTxQuote());
    await act(async () => {
      await initial.result.current.getRelayrTxQuote([REQUEST]);
    });
    initial.unmount();
    const second = await freshHarness();
    const resumed = renderHook(() => second.hooks.useGetRelayrTxQuote());
    await act(async () => {
      await expect(resumed.result.current.getRelayrTxQuote([REQUEST])).resolves.toMatchObject({
        bundle_uuid: BUNDLE_UUID,
      });
    });
    expect(mocks.signTypedData).toHaveBeenCalledOnce();
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it.each([
    { target: TARGET },
    { token: TARGET },
    { chain: 11155111 as const },
    { calldata: "0x1234" as Hex },
    { payment_deadline: String(NOW + 601) },
  ])("does not expose an unauthenticated payment option: %j", async (override) => {
    const { review, hooks } = await freshHarness();
    review.registerTransactionReviewHandler(async () => true);
    vi.stubGlobal("fetch", relayrApi({ payments: [payment(override)] }));
    const { result } = renderHook(() => hooks.useGetRelayrTxQuote());
    await expect(result.current.getRelayrTxQuote([REQUEST])).rejects.toThrow(
      /Relayr|quote deadline/,
    );
    expect(mocks.sendTransaction).not.toHaveBeenCalled();
  });
});

describe("raw payer publication and durable source guards", () => {
  const deployment = {
    kind: "project-payer" as const,
    projectId: "4",
    beneficiary: ACCOUNT,
    owner: ACCOUNT,
    addToBalance: false,
    memo: "",
    metadata: "0x" as Hex,
    directory: TARGET,
  };
  const raw = {
    ...REQUEST,
    relayrMode: "raw" as const,
    recoveryScope: "payer:1:4",
    expectedDeployment: deployment,
    data: {
      ...REQUEST.data,
      to: JB_PROJECT_PAYER_DEPLOYER,
      value: 0n,
      data: encodeFunctionData({
        abi: jbProjectPayerDeployerAbi,
        functionName: "deployProjectPayer",
        args: [4n, ACCOUNT, "", "0x", false, ACCOUNT],
      }),
    },
  };
  it("reviews and publishes exact canonical payer calldata without a forwarder signature", async () => {
    const { hooks, review, activity } = await freshHarness();
    review.registerTransactionReviewHandler(async () => true);
    vi.stubGlobal("fetch", relayrApi());
    const { result } = renderHook(() => hooks.useGetRelayrTxQuote());
    await act(async () => {
      await result.current.getRelayrTxQuote([raw]);
    });
    expect(mocks.signTypedData).not.toHaveBeenCalled();
    expect(
      mocks.readContract.mock.calls.some(([call]) => call.functionName === "isTrustedForwarder"),
    ).toBe(false);
    const posted = JSON.parse((vi.mocked(fetch).mock.calls[0][1] as RequestInit).body as string);
    expect(posted.transactions[0]).toMatchObject({
      chain: 1,
      target: JB_PROJECT_PAYER_DEPLOYER,
      data: raw.data.data,
      value: "0",
    });
    expect(
      activity.transactionActivitySnapshot()[0].relayrExpectedTransactions?.[0].expectedDeployment,
    ).toEqual(deployment);
  });
  it.each([
    ["raw call's duplicate review", () => ({ ...raw, reviewedInParent: true }), 0],
    ["forwarded call's signature review", () => ({ ...REQUEST, reviewedInParent: true }), 1],
  ] as const)("a parent review skips only a %s", async (_, request, reviews) => {
    const { hooks, review } = await freshHarness();
    const reviewer = vi.fn(async (_request: TransactionReviewRequest) => true);
    review.registerTransactionReviewHandler(reviewer);
    vi.stubGlobal("fetch", relayrApi());
    const { result } = renderHook(() => hooks.useGetRelayrTxQuote());
    await act(async () => {
      await result.current.getRelayrTxQuote([request()]);
    });
    expect(reviewer).toHaveBeenCalledTimes(reviews);
    if (reviews) {
      expect(reviewer).toHaveBeenCalledWith(expect.objectContaining({ kind: "authorization" }));
    } else {
      expect(mocks.clientCall).toHaveBeenCalledWith(
        expect.objectContaining({ to: JB_PROJECT_PAYER_DEPLOYER, data: raw.data.data }),
      );
    }
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it("retains a raw deployment publication after response loss and rejects changed intent", async () => {
    const { hooks, review } = await freshHarness();
    review.registerTransactionReviewHandler(async () => true);
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("POST response lost")));
    const { result } = renderHook(() => hooks.useGetRelayrTxQuote());
    await expect(result.current.getRelayrTxQuote([raw])).rejects.toThrow(/POST response lost/);
    await expect(
      result.current.getRelayrTxQuote([{ ...raw, data: { ...raw.data, data: "0x1234" } }]),
    ).rejects.toThrow(/published authorizations/);
    expect(fetch).toHaveBeenCalledOnce();
  });
  it("persists raw source guards and refuses funding when they change after quote review", async () => {
    const { hooks, review, activity } = await freshHarness();
    review.registerTransactionReviewHandler(async () => true);
    vi.stubGlobal("fetch", relayrApi());
    mocks.clientCall.mockResolvedValue({ data: "0x01" });
    const source = { address: TARGET, data: "0xabcd" as Hex, expected: "0x01" as Hex };
    const authorizer = renderHook(() => hooks.useGetRelayrTxQuote());
    await act(async () => {
      await authorizer.result.current.getRelayrTxQuote([{ ...raw, preconditions: [source] }]);
    });
    expect(
      activity.transactionActivitySnapshot()[0].relayrExpectedTransactions?.[0].preconditions,
    ).toEqual([source]);
    mocks.clientCall.mockResolvedValue({ data: "0x02" });
    const payer = renderHook(() => hooks.useSendRelayrTx());
    await expect(payer.result.current.sendRelayrTx(payment())).rejects.toThrow(
      /reviewed state changed/,
    );
    expect(mocks.sendTransaction).not.toHaveBeenCalled();
  });
});

describe("metadata source guards in Relayr", () => {
  const source = {
    chainId: 1,
    projectId: "4",
    directory: PAYMENT_TARGET,
    projects: PAYMENT_TARGET,
    permissions: PAYMENT_TARGET,
    controller: TARGET,
    uri: "ipfs://original",
  };

  it("does not sign when the source URI changes during authorization review", async () => {
    const { hooks, review } = await freshHarness();
    let uri = source.uri;
    const originalRead = mocks.readContract.getMockImplementation()!;
    mocks.readContract.mockImplementation(async (request) =>
      request.functionName === "ownerOf"
        ? ACCOUNT
        : request.functionName === "controllerOf"
          ? TARGET
          : request.functionName === "uriOf"
            ? uri
            : originalRead(request),
    );
    review.registerTransactionReviewHandler(async () => {
      uri = "ipfs://changed";
      return true;
    });
    const { result } = renderHook(() => hooks.useGetRelayrTxQuote());
    await expect(
      result.current.getRelayrTxQuote([{ ...REQUEST, metadataSource: source }]),
    ).rejects.toThrow(/source metadata changed/);
    expect(mocks.signTypedData).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("persists and rechecks the source URI before funding an already signed metadata bundle", async () => {
    const { hooks, review, activity } = await freshHarness();
    let uri = source.uri;
    const originalRead = mocks.readContract.getMockImplementation()!;
    mocks.readContract.mockImplementation(async (request) =>
      request.functionName === "ownerOf"
        ? ACCOUNT
        : request.functionName === "controllerOf"
          ? TARGET
          : request.functionName === "uriOf"
            ? uri
            : originalRead(request),
    );
    review.registerTransactionReviewHandler(async () => true);
    vi.stubGlobal("fetch", relayrApi());
    const authorizer = renderHook(() => hooks.useGetRelayrTxQuote());
    await act(async () => {
      await authorizer.result.current.getRelayrTxQuote([{ ...REQUEST, metadataSource: source }]);
    });
    expect(
      activity.transactionActivitySnapshot()[0].relayrExpectedTransactions?.[0].metadataSource,
    ).toEqual(source);
    review.registerTransactionReviewHandler(async () => {
      uri = "ipfs://changed";
      return true;
    });
    const payer = renderHook(() => hooks.useSendRelayrTx());
    await expect(payer.result.current.sendRelayrTx(payment())).rejects.toThrow(
      /source metadata changed/,
    );
    expect(mocks.sendTransaction).not.toHaveBeenCalled();
  });
});

async function quotedPayment(
  requests: ReviewedRelayrRequest[] = [REQUEST],
  payments: ChainPayment[] = [payment()],
) {
  const harness = await freshHarness();
  harness.review.registerTransactionReviewHandler(async () => true);
  vi.stubGlobal("fetch", relayrApi({ payments }));
  const authorization = renderHook(() => harness.hooks.useGetRelayrTxQuote());
  await act(async () => {
    await authorization.result.current.getRelayrTxQuote(requests);
  });
  const send = renderHook(() => harness.hooks.useSendRelayrTx());
  // Stop the automatic destination watcher without entering a timer loop.
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockImplementation(
        async () =>
          new Response(JSON.stringify({ bundle_uuid: "wrong", transactions: [] }), { status: 200 }),
      ),
  );
  return { ...harness, quote: authorization.result.current.data, result: send.result };
}

describe("reviewed Relayr payment hook", () => {
  it("signs all four testnets once and funds them with one explicitly selected testnet payment", async () => {
    const chainIds = [11155111, 11155420, 84532, 421614] as const;
    const selectedPayment = payment({ chain: 84532 });
    const harness = await quotedPayment(
      chainIds.map((chainId) => ({ ...REQUEST, chainId })),
      [payment(), payment({ chain: 11155111 }), selectedPayment],
    );
    expect(mocks.signTypedData.mock.calls.map(([request]) => request.domain.chainId)).toEqual(
      chainIds,
    );
    expect(harness.quote?.payment_info.map((option) => option.chain)).toEqual([11155111, 84532]);
    expect(mocks.sendTransaction).not.toHaveBeenCalled();
    // The payment is mined on the chain it was sent on.
    const funding = onchain(PAYMENT_TARGET, selectedPayment.calldata, 16n, 84532);
    mocks.getTransaction.mockResolvedValue(funding);
    mocks.getTransactionReceipt.mockResolvedValue(funding);
    await expect(harness.result.current.sendRelayrTx(payment())).rejects.toThrow(/does not belong/);
    await act(async () => {
      await expect(harness.result.current.sendRelayrTx(selectedPayment)).resolves.toBe(HASH);
    });
    expect(mocks.sendTransaction).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ account: ACCOUNT, chainId: 84532, to: PAYMENT_TARGET, value: 16n }),
    );
    expect(mocks.getCode).toHaveBeenCalledWith({ address: PAYMENT_TARGET });
    expect(
      harness.activity
        .transactionActivityForHash(HASH)
        ?.relayrExpectedTransactions?.map((transaction) => transaction.chainId),
    ).toEqual(chainIds);
  });

  it("retains an unusable publication when the service offers only mainnet funding for testnets", async () => {
    const { review, hooks, activity } = await freshHarness();
    review.registerTransactionReviewHandler(async () => true);
    vi.stubGlobal("fetch", relayrApi());
    const authorizer = renderHook(() => hooks.useGetRelayrTxQuote());
    await expect(
      authorizer.result.current.getRelayrTxQuote([{ ...REQUEST, chainId: 11155111 }]),
    ).rejects.toThrow(/no funding option/);
    expect(activity.transactionActivitySnapshot()).toEqual([
      expect.objectContaining({ relayrPaymentStatus: "unfunded" }),
    ]);
    // The same calls are quoted again with the published signatures, never signed again.
    await expect(
      authorizer.result.current.getRelayrTxQuote([{ ...REQUEST, chainId: 11155111 }]),
    ).rejects.toThrow(/no funding option/);
    expect(activity.transactionActivitySnapshot()).toEqual([
      expect.objectContaining({ relayrPaymentStatus: "unfunded" }),
    ]);
    expect(mocks.signTypedData).toHaveBeenCalledOnce();
    expect(mocks.sendTransaction).not.toHaveBeenCalled();
  });

  it("filters legacy saved testnet quote funding without signing or publishing again", async () => {
    const request = { ...REQUEST, chainId: 11155111 as const };
    const offeredQuote = {
      ...quote(),
      payment_info: [payment(), payment({ chain: 84532 })],
    };
    const initial = await quotedPayment([request], offeredQuote.payment_info);
    initial.activity.updateTransactionActivity(`relayr:${BUNDLE_UUID}`, {
      relayrQuote: offeredQuote,
    });
    const resumed = await freshHarness();
    const authorizer = renderHook(() => resumed.hooks.useGetRelayrTxQuote());
    await act(async () => {
      await expect(authorizer.result.current.getRelayrTxQuote([request])).resolves.toMatchObject({
        payment_info: [payment({ chain: 84532 })],
      });
    });
    expect(mocks.signTypedData).toHaveBeenCalledOnce();
    expect(fetch).not.toHaveBeenCalled();
    const payer = renderHook(() => resumed.hooks.useSendRelayrTx());
    await expect(payer.result.current.sendRelayrTx(payment())).rejects.toThrow(/does not belong/);
    expect(mocks.sendTransaction).not.toHaveBeenCalled();
  });

  it("isolates persisted testnet fees from returned quote mutations before and after recovery", async () => {
    const request = { ...REQUEST, chainId: 11155111 as const };
    const offeredPayment = payment({ chain: 84532 });
    const initial = await quotedPayment([request], [offeredPayment]);
    initial.quote!.payment_info[0].amount = "0x100";
    initial.activity.updateTransactionActivity(`relayr:${BUNDLE_UUID}`, {
      message: "Still awaiting the original reviewed payment.",
    });
    expect(initial.activity.transactionActivitySnapshot()[0].relayrQuote?.payment_info).toEqual([
      offeredPayment,
    ]);

    const resumed = await freshHarness();
    const authorizer = renderHook(() => resumed.hooks.useGetRelayrTxQuote());
    await act(async () => {
      const restored = await authorizer.result.current.getRelayrTxQuote([request]);
      expect(restored.payment_info).toEqual([offeredPayment]);
      restored.payment_info[0].amount = "0x200";
    });
    resumed.activity.updateTransactionActivity(`relayr:${BUNDLE_UUID}`, {
      message: "The restored fee remains unchanged.",
    });
    expect(resumed.activity.transactionActivitySnapshot()[0].relayrQuote?.payment_info).toEqual([
      offeredPayment,
    ]);
    const payer = renderHook(() => resumed.hooks.useSendRelayrTx());
    await expect(
      payer.result.current.sendRelayrTx({ ...offeredPayment, amount: "0x200" }),
    ).rejects.toThrow(/does not belong/);
    expect(mocks.signTypedData).toHaveBeenCalledOnce();
    expect(fetch).not.toHaveBeenCalled();
    expect(mocks.sendTransaction).not.toHaveBeenCalled();
  });

  it("reviews the exact selected funding chain and persists its signed destination calls", async () => {
    const { review, activity, result } = await quotedPayment();
    review.registerTransactionReviewHandler(async (request) => {
      expect(request).toMatchObject({ kind: "transaction", title: "Review Relayr payment" });
      expect(request.calls[0]).toMatchObject({
        chainId: 1,
        from: ACCOUNT,
        to: PAYMENT_TARGET,
        value: 16n,
        gas: 150_000n,
        data: payment().calldata,
      });
      return true;
    });
    await act(async () => {
      await expect(result.current.sendRelayrTx(payment())).resolves.toBe(HASH);
    });
    expect(mocks.sendTransaction).toHaveBeenCalledWith(
      expect.objectContaining({
        account: ACCOUNT,
        chainId: 1,
        to: PAYMENT_TARGET,
        value: 16n,
        gas: 150_000n,
      }),
    );
    expect(activity.transactionActivityForHash(HASH)).toMatchObject({
      kind: "relayr-bundle",
      relayrPaymentStatus: "confirmed",
      relayrExpectedTransactions: [
        expect.objectContaining({ chainId: 1, transactionUuid: TX_UUIDS[0] }),
      ],
    });
  });

  it("switches a wallet parked on another chain to the funding chain before it pays", async () => {
    const { result } = await quotedPayment();
    // The wallet moved after the quote was signed. The payment names chain 1.
    mocks.account.chainId = 8453;
    mocks.switchChain.mockClear();
    await act(async () => {
      await expect(result.current.sendRelayrTx(payment())).resolves.toBe(HASH);
    });
    expect(mocks.switchChain).toHaveBeenCalledExactlyOnceWith({ chainId: 1 });
    expect(mocks.switchChain.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.sendTransaction.mock.invocationCallOrder[0],
    );
    expect(mocks.sendTransaction).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ chainId: 1, to: PAYMENT_TARGET }),
    );
  });

  it("simulates the payment at its reviewed gas and sends exactly that gas", async () => {
    const { result } = await quotedPayment();
    mocks.estimateGas.mockClear();
    await act(async () => {
      await expect(result.current.sendRelayrTx(payment())).resolves.toBe(HASH);
    });
    expect(mocks.clientCall).toHaveBeenCalledWith({
      account: ACCOUNT,
      to: PAYMENT_TARGET,
      value: 16n,
      data: payment().calldata,
      gas: 150_000n,
    });
    expect(mocks.clientCall.mock.invocationCallOrder.at(-1)).toBeLessThan(
      mocks.sendTransaction.mock.invocationCallOrder[0],
    );
    expect(mocks.estimateGas).not.toHaveBeenCalled();
    expect(mocks.sendTransaction).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ to: PAYMENT_TARGET, gas: 150_000n }),
    );
  });

  it.each([
    ["reverts", () => Promise.reject(new Error("payment reverted: out of gas")), /out of gas/],
    ["returns data", () => Promise.resolve({ data: "0x01" }), /unexpected result/],
  ])("sends nothing when the payment %s at its reviewed gas", async (_, simulate, error) => {
    const { activity, result } = await quotedPayment();
    mocks.clientCall.mockImplementation(async ({ to }: { to: Address }) =>
      to === PAYMENT_TARGET ? simulate() : { data: "0x" },
    );
    await expect(result.current.sendRelayrTx(payment())).rejects.toThrow(error);
    expect(mocks.sendTransaction).not.toHaveBeenCalled();
    expect(activity.transactionActivitySnapshot()[0].relayrPaymentStatus).toBe("unfunded");
  });

  it("rejects payments that were not returned by an authorized quote", async () => {
    const { hooks } = await freshHarness();
    const { result } = renderHook(() => hooks.useSendRelayrTx());
    await expect(result.current.sendRelayrTx(payment())).rejects.toThrow(
      /does not belong to a reviewed Relayr quote/,
    );
    expect(mocks.sendTransaction).not.toHaveBeenCalled();
  });

  it.each([1, 11155111] as const)(
    "rejects edited quote fields and unrecognized runtime on %s",
    async (chainId) => {
      const { result } = await quotedPayment(
        [{ ...REQUEST, chainId }],
        [payment({ chain: chainId })],
      );
      await expect(
        result.current.sendRelayrTx(payment({ chain: chainId, amount: "0x100" })),
      ).rejects.toThrow(/does not belong/);
      mocks.getCode.mockResolvedValue("0x00");
      await expect(result.current.sendRelayrTx(payment({ chain: chainId }))).rejects.toThrow(
        /code is not recognized/,
      );
      expect(mocks.sendTransaction).not.toHaveBeenCalled();
    },
  );

  it("rejects account or chain changes before funding submission", async () => {
    const { review, result } = await quotedPayment();
    review.registerTransactionReviewHandler(async () => {
      mocks.account.address = OTHER_ACCOUNT;
      return true;
    });
    await expect(result.current.sendRelayrTx(payment())).rejects.toThrow(
      /account or chain changed/,
    );
    expect(mocks.sendTransaction).not.toHaveBeenCalled();
  });

  it("revalidates the exact signed destination after funding review and never pays a consumed nonce or changed destination", async () => {
    const { review, result, activity } = await quotedPayment();
    review.registerTransactionReviewHandler(async () => {
      mocks.clientCall.mockRejectedValueOnce(
        new Error("signed forwarder request reverted: nonce consumed"),
      );
      return true;
    });
    await expect(result.current.sendRelayrTx(payment())).rejects.toThrow(/nonce consumed/);
    const expected = activity.transactionActivitySnapshot()[0].relayrExpectedTransactions![0];
    expect(mocks.clientCall).toHaveBeenLastCalledWith(
      expect.objectContaining({
        account: ACCOUNT,
        to: expected.target,
        data: expected.data,
        value: 3n,
        gas: BigInt(expected.gas!),
        stateOverride: [expect.objectContaining({ address: ACCOUNT })],
      }),
    );
    expect(mocks.sendTransaction).not.toHaveBeenCalled();
    expect(activity.transactionActivitySnapshot()[0].relayrPaymentStatus).toBe("unfunded");
  });

  it("rejects a quote that expires while the review sits open", async () => {
    const { review, result } = await quotedPayment();
    review.registerTransactionReviewHandler(async () => {
      vi.setSystemTime(new Date((NOW + 700) * 1_000));
      return true;
    });
    await expect(result.current.sendRelayrTx(payment())).rejects.toThrow(/expired/);
    expect(mocks.sendTransaction).not.toHaveBeenCalled();
  });

  it("routes a switched Safe connector back to its proposal flow", async () => {
    const { result } = await quotedPayment();
    mocks.account.connector = { id: "safe", name: "Safe" };
    await expect(result.current.sendRelayrTx(payment())).rejects.toThrow(/Safe proposal flow/);
    expect(mocks.sendTransaction).not.toHaveBeenCalled();
  });

  it("retains uncertain funding and blocks duplicate funding and newly signed copies", async () => {
    const { activity, hooks, result } = await quotedPayment();
    mocks.waitForTransactionReceipt.mockRejectedValue(new Error("RPC unavailable"));
    await expect(result.current.sendRelayrTx(payment())).rejects.toThrow(
      /confirmation is uncertain/,
    );
    expect(activity.transactionActivityForHash(HASH)).toMatchObject({
      status: "pending",
      relayrPaymentStatus: "submitted",
    });
    await expect(result.current.sendRelayrTx(payment())).rejects.toThrow(
      /already has a submitted payment/,
    );
    const authorizer = renderHook(() => hooks.useGetRelayrTxQuote());
    await expect(authorizer.result.current.getRelayrTxQuote([REQUEST])).rejects.toThrow(
      /already has a submitted payment/,
    );
    expect(mocks.sendTransaction).toHaveBeenCalledOnce();
  });

  it("blocks a second funding option after the first has been paid", async () => {
    const harness = await freshHarness();
    harness.review.registerTransactionReviewHandler(async () => true);
    vi.stubGlobal("fetch", relayrApi({ payments: [payment(), payment({ chain: 10 })] }));
    const authorizer = renderHook(() => harness.hooks.useGetRelayrTxQuote());
    await act(async () => {
      await authorizer.result.current.getRelayrTxQuote([REQUEST]);
    });
    const payer = renderHook(() => harness.hooks.useSendRelayrTx());
    mocks.waitForTransactionReceipt.mockRejectedValue(new Error("RPC unavailable"));
    await expect(payer.result.current.sendRelayrTx(payment())).rejects.toThrow(/uncertain/);
    await expect(payer.result.current.sendRelayrTx(payment({ chain: 10 }))).rejects.toThrow(
      /already has a submitted payment/,
    );
    expect(mocks.sendTransaction).toHaveBeenCalledOnce();
  });

  it("retains a lock when wallet broadcast fails ambiguously, but permits explicit rejection retry", async () => {
    const { activity, result } = await quotedPayment();
    mocks.sendTransaction.mockRejectedValueOnce({ code: 4001 });
    await expect(result.current.sendRelayrTx(payment())).rejects.toEqual({ code: 4001 });
    expect(activity.transactionActivitySnapshot()[0]).toMatchObject({
      relayrPaymentStatus: "unfunded",
    });
    mocks.sendTransaction.mockRejectedValueOnce(new Error("connection lost"));
    await expect(result.current.sendRelayrTx(payment())).rejects.toThrow("connection lost");
    await expect(result.current.sendRelayrTx(payment())).rejects.toThrow(/uncertain wallet result/);
    expect(mocks.sendTransaction).toHaveBeenCalledTimes(2);
  });

  it("proves a sped-up payment on the hash it was mined under", async () => {
    const SPED_UP = `0x${"5e".repeat(32)}` as Hex;
    const { activity, result } = await quotedPayment();
    // The wallet replaced the payment it returned; only the replacement was mined.
    mocks.waitForTransactionReceipt.mockResolvedValue({
      ...onchain(PAYMENT_TARGET, payment().calldata),
      hash: SPED_UP,
      transactionHash: SPED_UP,
    });
    const minedOnly =
      (read: (hash: Hex) => unknown) =>
      async ({ hash }: { hash: Hex }) => {
        if (hash !== SPED_UP) throw new Error(`Transaction ${hash} could not be found.`);
        return read(hash);
      };
    mocks.getTransaction.mockImplementation(
      minedOnly((hash) => ({ ...onchain(PAYMENT_TARGET, payment().calldata), hash })),
    );
    mocks.getTransactionReceipt.mockImplementation(
      minedOnly((hash) => ({
        ...onchain(PAYMENT_TARGET, payment().calldata),
        hash,
        transactionHash: hash,
      })),
    );
    await act(async () => {
      await expect(result.current.sendRelayrTx(payment())).resolves.toBe(SPED_UP);
    });
    expect(activity.transactionActivitySnapshot()[0]).toMatchObject({
      hash: SPED_UP,
      relayrPaymentStatus: "confirmed",
      relayrPayments: [expect.objectContaining({ hash: SPED_UP })],
    });
    expect(mocks.sendTransaction).toHaveBeenCalledOnce();
  });

  it("does not accept a funding receipt for another payment", async () => {
    const { result } = await quotedPayment();
    mocks.getTransaction.mockResolvedValue(onchain(TARGET, "0x"));
    await expect(result.current.sendRelayrTx(payment())).rejects.toThrow(
      /confirmation is uncertain/,
    );
    await expect(result.current.sendRelayrTx(payment())).rejects.toThrow(
      /already has a submitted payment/,
    );
  });
});

describe("Safe execution bundles", () => {
  const SAFE = "0x0000000000000000000000000000000000005afe" as Address;
  const SAFE_TX_HASH = `0x${"ef".repeat(32)}` as Hex;
  const NONCE = toFunctionSelector("function nonce()");
  const TX_HASH = toFunctionSelector(
    "function getTransactionHash(address,uint256,bytes,uint8,uint256,uint256,uint256,address,address,uint256)",
  );
  let liveNonce = 7n;
  const exec = encodeFunctionData({
    abi: SAFE_EXEC_ABI,
    functionName: "execTransaction",
    args: [TARGET, 0n, "0x1234", 0, 0n, 0n, 0n, zeroAddress, zeroAddress, SIGNATURE],
  });
  const safeExec = (chainId: 1 | 10) => ({
    chainId,
    version: 6 as const,
    relayrMode: "safe-exec" as const,
    expectedSafeExecution: { safe: SAFE, safeTxHash: SAFE_TX_HASH, nonce: 7 },
    data: { from: ACCOUNT, to: SAFE, value: 0n, gas: 200_000n, data: exec },
    review: { label: `Execute Safe transaction #7 on ${chainId}` },
  });

  beforeEach(() => {
    liveNonce = 7n;
    mocks.clientCall.mockImplementation(async ({ data }: { data?: Hex }) => ({
      data: data?.startsWith(NONCE)
        ? encodeAbiParameters([{ type: "uint256" }], [liveNonce])
        : data?.startsWith(TX_HASH)
          ? SAFE_TX_HASH
          : "0x",
    }));
  });

  it("reviews every Safe execution once, pins nonce and hash, and never switches chains", async () => {
    const { hooks, review, activity } = await freshHarness();
    const reviews: unknown[] = [];
    review.registerTransactionReviewHandler(async (request) => {
      reviews.push(request);
      return true;
    });
    vi.stubGlobal("fetch", relayrApi());
    const { result } = renderHook(() => hooks.useGetRelayrTxQuote());
    await act(async () => {
      await result.current.getRelayrTxQuote([safeExec(1), safeExec(10)]);
    });
    expect(reviews).toHaveLength(1);
    expect(reviews[0]).toMatchObject({
      kind: "transaction",
      calls: [
        { chainId: 1, to: SAFE, data: exec },
        { chainId: 10, to: SAFE, data: exec },
      ],
    });
    expect(mocks.switchChain).not.toHaveBeenCalled();
    expect(mocks.signTypedData).not.toHaveBeenCalled();
    const posted = JSON.parse((vi.mocked(fetch).mock.calls[0][1] as RequestInit).body as string);
    expect(posted.transactions.map((row: { target: Address }) => row.target)).toEqual([SAFE, SAFE]);
    const [expected] = activity.transactionActivitySnapshot()[0].relayrExpectedTransactions!;
    expect(expected.expectedSafeExecution).toEqual({
      safe: SAFE,
      safeTxHash: SAFE_TX_HASH,
      nonce: 7,
    });
    expect(expected.preconditions).toHaveLength(2);
  });

  it("refuses the payment when a Safe nonce moved after the quote", async () => {
    const { hooks, review } = await freshHarness();
    review.registerTransactionReviewHandler(async () => true);
    vi.stubGlobal("fetch", relayrApi());
    const quoter = renderHook(() => hooks.useGetRelayrTxQuote());
    await act(async () => {
      await quoter.result.current.getRelayrTxQuote([safeExec(1), safeExec(10)]);
    });
    liveNonce = 8n;
    const payer = renderHook(() => hooks.useSendRelayrTx());
    await expect(payer.result.current.sendRelayrTx(payment())).rejects.toThrow(
      /reviewed state changed/,
    );
    expect(mocks.sendTransaction).not.toHaveBeenCalled();
  });

  it("rejects a Safe call that is not execTransaction, and mixed bundles", async () => {
    const { hooks, review } = await freshHarness();
    review.registerTransactionReviewHandler(async () => true);
    vi.stubGlobal("fetch", vi.fn());
    const { result } = renderHook(() => hooks.useGetRelayrTxQuote());
    await expect(
      result.current.getRelayrTxQuote([
        { ...safeExec(1), data: { ...safeExec(1).data, data: "0x1234" } },
      ]),
    ).rejects.toThrow(/not execTransaction/);
    await expect(
      result.current.getRelayrTxQuote([safeExec(1), { ...REQUEST, chainId: 10 as const }]),
    ).rejects.toThrow(/bundle of their own/);
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("paying a reverted Relayr payment again", () => {
  const SECOND_HASH = `0x${"ef".repeat(32)}` as Hex;

  /** The funding chain's receipt status for each payment hash. */
  function fundingChain(statuses: Record<Hex, "success" | "reverted">) {
    mocks.getTransaction.mockImplementation(async ({ hash }: { hash: Hex }) => ({
      ...onchain(PAYMENT_TARGET, payment().calldata),
      hash,
    }));
    mocks.getTransactionReceipt.mockImplementation(async ({ hash }: { hash: Hex }) => ({
      ...onchain(PAYMENT_TARGET, payment().calldata),
      hash,
      transactionHash: hash,
      status: statuses[hash],
    }));
  }

  /** Relayr's bundle as a read of `GET /v1/bundle/{uuid}` returns it. */
  function relayrReports(bundle: Record<string, unknown> = {}) {
    const read = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            bundle_uuid: BUNDLE_UUID,
            payment_received: false,
            transactions: [{ tx_uuid: TX_UUIDS[0], status: { state: "Pending" } }],
            ...bundle,
          }),
          { status: 200 },
        ),
    );
    vi.stubGlobal("fetch", read);
    return read;
  }

  async function revertedPayment() {
    const harness = await quotedPayment();
    fundingChain({ [HASH]: "reverted" });
    await expect(harness.result.current.sendRelayrTx(payment())).rejects.toThrow(
      /confirmation is uncertain/,
    );
    expect(harness.activity.transactionActivitySnapshot()[0]).toMatchObject({
      relayrPaymentStatus: "reverted",
    });
    return harness;
  }

  it("pays again only after proving each sent payment reverted and reading Relayr's bundle unpaid and unrun", async () => {
    const { activity, result } = await revertedPayment();
    const read = relayrReports();
    fundingChain({ [HASH]: "reverted", [SECOND_HASH]: "success" });
    mocks.sendTransaction.mockResolvedValueOnce(SECOND_HASH);
    await act(async () => {
      await expect(result.current.sendRelayrTx(payment())).resolves.toBe(SECOND_HASH);
    });
    expect(mocks.sendTransaction).toHaveBeenCalledTimes(2);
    expect(read).toHaveBeenCalledWith(
      `https://api.relayr.ba5ed.com/v1/bundle/${BUNDLE_UUID}`,
      expect.objectContaining({ cache: "no-store" }),
    );
    expect(read.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.sendTransaction.mock.invocationCallOrder[1],
    );
    expect(
      activity.transactionActivityForHash(SECOND_HASH)?.relayrPayments?.map(({ hash }) => hash),
    ).toEqual([HASH, SECOND_HASH]);
  });

  it("does not pay again when Relayr reports a payment from another device", async () => {
    const { result } = await revertedPayment();
    relayrReports({ payment_received: true });
    await expect(result.current.sendRelayrTx(payment())).rejects.toThrow(
      "Relayr already reports a payment for this bundle. Do not pay again.",
    );
    expect(mocks.sendTransaction).toHaveBeenCalledOnce();
  });

  it.each<[string, Record<string, unknown>, RegExp]>([
    [
      "a call is running",
      { transactions: [{ tx_uuid: TX_UUIDS[0], status: { state: "Included" } }] },
      /running or run/,
    ],
    [
      "a call names a destination hash",
      {
        transactions: [
          { tx_uuid: TX_UUIDS[0], status: { state: "Pending", data: { hash: SECOND_HASH } } },
        ],
      },
      /running or run/,
    ],
    ["Relayr does not say whether it was paid", { payment_received: null }, /has not said/],
    ["the read names another bundle", { bundle_uuid: OTHER_BUNDLE_UUID }, /has not said/],
  ])("does not pay again when %s", async (_, bundle, message) => {
    const { result } = await revertedPayment();
    relayrReports(bundle);
    await expect(result.current.sendRelayrTx(payment())).rejects.toThrow(message);
    expect(mocks.sendTransaction).toHaveBeenCalledOnce();
  });

  it("does not pay again while Relayr is unreachable", async () => {
    const { result } = await revertedPayment();
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("network down")));
    await expect(result.current.sendRelayrTx(payment())).rejects.toThrow(/has not said/);
    expect(mocks.sendTransaction).toHaveBeenCalledOnce();
  });

  it("does not pay again once the quote expires", async () => {
    const { result } = await revertedPayment();
    relayrReports();
    vi.setSystemTime(new Date((NOW + 590) * 1_000));
    await expect(result.current.sendRelayrTx(payment())).rejects.toThrow(
      "This Relayr quote expired. Review the action again for a new quote.",
    );
    expect(mocks.sendTransaction).toHaveBeenCalledOnce();
  });

  it("proves every payment the session sent, including one before a declined retry", async () => {
    const { activity, result } = await revertedPayment();
    relayrReports();
    fundingChain({ [HASH]: "reverted", [SECOND_HASH]: "reverted" });
    mocks.sendTransaction.mockResolvedValueOnce(SECOND_HASH);
    await expect(result.current.sendRelayrTx(payment())).rejects.toThrow(
      /confirmation is uncertain/,
    );
    mocks.sendTransaction.mockRejectedValueOnce({ code: 4001 });
    await expect(result.current.sendRelayrTx(payment())).rejects.toEqual({ code: 4001 });
    // A quote paid before stays on the retry rule when the wallet declines to pay it again.
    expect(activity.transactionActivitySnapshot()[0]).toMatchObject({
      relayrPaymentStatus: "reverted",
      relayrPayments: [
        expect.objectContaining({ hash: HASH }),
        expect.objectContaining({ hash: SECOND_HASH }),
      ],
    });
    // The first payment now reads as successful: a later one reverting proves nothing.
    fundingChain({ [HASH]: "success", [SECOND_HASH]: "reverted" });
    await expect(result.current.sendRelayrTx(payment())).rejects.toThrow(
      "This Relayr payment succeeded onchain, so its bundle is paid. Do not pay again.",
    );
    expect(mocks.sendTransaction).toHaveBeenCalledTimes(3);
  });
});

describe("unpaid Relayr quotes", () => {
  // `payment()` is payable until NOW + 600, so a quote is dead from NOW + 585.
  const LAST_PAYABLE = new Date((NOW + 584) * 1_000);
  const EXPIRED = new Date((NOW + 585) * 1_000);
  const nextQuote = (deadline = NOW + 1_800) =>
    relayrApi({
      bundleUuid: OTHER_BUNDLE_UUID,
      payments: [payment({}, { bundleUuid: OTHER_BUNDLE_UUID, deadline })],
    });
  const PAST_DEADLINE = NOW + 48 * 3600;

  async function unpaidQuote(request: ReviewedRelayrRequest = REQUEST) {
    const harness = await freshHarness();
    harness.review.registerTransactionReviewHandler(async () => true);
    vi.stubGlobal("fetch", relayrApi());
    const authorizer = renderHook(() => harness.hooks.useGetRelayrTxQuote());
    await act(async () => {
      await authorizer.result.current.getRelayrTxQuote([request]);
    });
    return { ...harness, result: authorizer.result };
  }

  const changedIn = (recoveryScope: string) => ({
    ...REQUEST,
    recoveryScope,
    data: { ...REQUEST.data, data: "0x5678" as Hex },
  });
  const row = (
    activity: Awaited<ReturnType<typeof freshHarness>>["activity"],
    bundleUuid: string,
  ) => activity.transactionActivitySnapshot().find((item) => item.bundleUuid === bundleUuid);

  it.each(["revnet-launch", "project-metadata:1:4", "project-splits:1:4:123:1"])(
    "keep reserving the %s scope while a request can run, saying until when, and let a changed call sign at the live nonce once every request is dead",
    async (recoveryScope) => {
      const { activity, hooks, result } = await unpaidQuote({ ...REQUEST, recoveryScope });
      const changed = changedIn(recoveryScope);
      vi.setSystemTime(LAST_PAYABLE);
      await expect(
        hooks.requireRelayrRecoveryScopeAvailable(ACCOUNT, recoveryScope),
      ).rejects.toThrow(/earlier signature can still run until/);
      await expect(result.current.getRelayrTxQuote([changed])).rejects.toThrow(
        /earlier signature can still run until/,
      );
      // The quote can no longer be paid by the clock, and its signature provably
      // can still run: nothing is signed for the changed call.
      vi.setSystemTime(EXPIRED);
      chainAt({ timestamp: NOW + 700, finalizedNonce: 4n });
      await expect(
        hooks.requireRelayrRecoveryScopeAvailable(ACCOUNT, recoveryScope),
      ).rejects.toThrow(/earlier signature can still run until/);
      await expect(result.current.getRelayrTxQuote([changed])).rejects.toThrow(
        /earlier signature can still run until/,
      );
      expect(mocks.signTypedData).toHaveBeenCalledOnce();
      expect(row(activity, BUNDLE_UUID)).toMatchObject({ relayrPaymentStatus: "unfunded" });
      // Every request is dead and unused at a finalized block: the changed call goes ahead.
      vi.setSystemTime(new Date(PAST_DEADLINE * 1_000));
      chainAt({ timestamp: PAST_DEADLINE, finalizedNonce: 4n });
      vi.stubGlobal("fetch", nextQuote(PAST_DEADLINE + 1_800));
      await act(async () => {
        await expect(result.current.getRelayrTxQuote([changed])).resolves.toMatchObject({
          bundle_uuid: OTHER_BUNDLE_UUID,
        });
      });
      expect(mocks.signTypedData).toHaveBeenCalledTimes(2);
      expect(row(activity, BUNDLE_UUID)).toMatchObject({ relayrDiscardable: "expired" });
    },
  );

  it("never signs a changed call at the old nonce while the old request provably can still run", async () => {
    const scoped = { ...REQUEST, recoveryScope: "payout:1:4:0xabc:0xdef" };
    const { activity, result } = await unpaidQuote(scoped);
    // The quote's payment deadline passed on the device clock; the finalized block
    // is far before the signature's deadline.
    vi.setSystemTime(new Date((NOW + 700) * 1_000));
    chainAt({ timestamp: NOW + 700, finalizedNonce: 4n });
    vi.stubGlobal("fetch", nextQuote(NOW + 2_400));
    await expect(
      result.current.getRelayrTxQuote([
        { ...scoped, data: { ...scoped.data, value: 9n, data: "0x5678" as Hex } },
      ]),
    ).rejects.toThrow(/earlier signature can still run until/);
    expect(mocks.signTypedData).toHaveBeenCalledOnce();
    expect(fetch).not.toHaveBeenCalled();
    expect(row(activity, BUNDLE_UUID)).toMatchObject({ relayrPaymentStatus: "unfunded" });
  });

  it("quote the same signed calls again once the saved quote can no longer be paid", async () => {
    const { activity, result } = await unpaidQuote();
    const signed = row(activity, BUNDLE_UUID)!.relayrExpectedTransactions![0].data;
    vi.setSystemTime(EXPIRED);
    const relayr = nextQuote();
    vi.stubGlobal("fetch", relayr);
    await act(async () => {
      await expect(result.current.getRelayrTxQuote([REQUEST])).resolves.toMatchObject({
        bundle_uuid: OTHER_BUNDLE_UUID,
      });
    });
    expect(mocks.signTypedData).toHaveBeenCalledOnce();
    const [, init] = relayr.mock.calls.find(([url]) => String(url).endsWith("/prepaid"))!;
    expect(JSON.parse(String(init?.body)).transactions[0].data).toBe(signed);
    expect(row(activity, BUNDLE_UUID)).toMatchObject({ relayrPaymentStatus: "expired" });
    expect(row(activity, OTHER_BUNDLE_UUID)).toMatchObject({
      relayrPaymentStatus: "unfunded",
      relayrNonces: ["4"],
    });
  });

  it("stay pending when the app resumes past their quote's deadline", async () => {
    const { activity, hooks } = await unpaidQuote();
    vi.setSystemTime(EXPIRED);
    vi.stubGlobal("fetch", vi.fn());
    hooks.resumePendingRelayrBundles();
    expect(activity.transactionActivitySnapshot()[0]).toMatchObject({
      status: "pending",
      relayrPaymentStatus: "unfunded",
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("are never paid once another tab marks them expired", async () => {
    const { activity, hooks } = await unpaidQuote();
    activity.updateTransactionActivity(`relayr:${BUNDLE_UUID}`, {
      status: "failed",
      relayrPaymentStatus: "expired",
    });
    const payer = renderHook(() => hooks.useSendRelayrTx());
    await expect(payer.result.current.sendRelayrTx(payment())).rejects.toThrow(
      "This Relayr quote expired. Review the action again for a new quote.",
    );
    expect(mocks.sendTransaction).not.toHaveBeenCalled();
  });

  it("keep reserving their scope once a payment was sent", async () => {
    const { hooks, result } = await unpaidQuote({ ...REQUEST, recoveryScope: "revnet-launch" });
    mocks.getTransactionReceipt.mockResolvedValue({
      ...onchain(PAYMENT_TARGET, payment().calldata),
      status: "reverted",
    });
    const payer = renderHook(() => hooks.useSendRelayrTx());
    await expect(payer.result.current.sendRelayrTx(payment())).rejects.toThrow(/uncertain/);
    await expect(result.current.getRelayrTxQuote([changedIn("revnet-launch")])).rejects.toThrow(
      /earlier signature can still run until/,
    );
    await expect(
      hooks.requireRelayrRecoveryScopeAvailable(ACCOUNT, "revnet-launch"),
    ).rejects.toThrow(/earlier signature can still run until/);
    expect(mocks.signTypedData).toHaveBeenCalledOnce();
  });
});

describe("Relayr sessions decided from the chain", () => {
  // A forward request signed at NOW stays executable for 47 hours.
  const SIGNED_DEADLINE = NOW + 47 * 3600;
  const PAST_DEADLINE = NOW + 48 * 3600;
  const GUARD = "0x0000000000000000000000000000000000004444" as Address;
  const GUARD_DATA = "0xabcdef01" as Hex;
  const GUARD_VALUE = `0x${"00".repeat(31)}01` as Hex;
  const GUARDED = {
    ...REQUEST,
    preconditions: [{ address: GUARD, data: GUARD_DATA, expected: GUARD_VALUE }],
  };
  const nextQuote = () =>
    relayrApi({
      bundleUuid: OTHER_BUNDLE_UUID,
      payments: [payment({}, { bundleUuid: OTHER_BUNDLE_UUID, deadline: PAST_DEADLINE + 1_800 })],
    });

  /** Relayr's read of the first bundle, and the next quote for anything else. */
  function relayrReads(first: Record<string, unknown> = {}) {
    const next = nextQuote();
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) =>
      String(input).endsWith(`/v1/bundle/${BUNDLE_UUID}`)
        ? new Response(
            JSON.stringify({
              bundle_uuid: BUNDLE_UUID,
              payment_received: false,
              transactions: [{ tx_uuid: TX_UUIDS[0], status: { state: "Pending" } }],
              ...first,
            }),
            { status: 200 },
          )
        : next(input, init),
    );
    vi.stubGlobal("fetch", fetcher);
    return fetcher;
  }

  /** The destination reads the recheck makes: its reviewed precondition. */
  function guardReads(answer: () => Promise<{ data: Hex }>) {
    mocks.clientCall.mockImplementation(async ({ to }: { to: Address }) =>
      to === GUARD ? answer() : { data: "0x" },
    );
  }

  /** An unpaid quote for `request`, signed at the forwarder nonce 4. */
  async function signedSession(request: ReviewedRelayrRequest = GUARDED) {
    const harness = await freshHarness();
    harness.review.registerTransactionReviewHandler(async () => true);
    guardReads(async () => ({ data: GUARD_VALUE }));
    vi.stubGlobal("fetch", relayrApi());
    const authorizer = renderHook(() => harness.hooks.useGetRelayrTxQuote());
    await act(async () => {
      await authorizer.result.current.getRelayrTxQuote([request]);
    });
    expect(mocks.signTypedData).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ message: expect.objectContaining({ nonce: 4n }) }),
    );
    const session = () =>
      harness.activity.transactionActivitySnapshot().find((row) => row.bundleUuid === BUNDLE_UUID);
    return { ...harness, result: authorizer.result, session };
  }

  it("never signs at the live nonce once the device clock passes the deadline but the chain has not", async () => {
    const { result, session } = await signedSession();
    // The device clock is past the request's deadline; the finalized block is not, and the
    // old request ran since, so the latest nonce moved on.
    vi.setSystemTime(new Date(PAST_DEADLINE * 1_000));
    chainAt({ timestamp: SIGNED_DEADLINE - 3600, finalizedNonce: 4n, liveNonce: 5n });
    vi.stubGlobal("fetch", nextQuote());
    await expect(result.current.getRelayrTxQuote([GUARDED])).rejects.toThrow(
      /earlier signature (can|may) still run/,
    );
    expect(mocks.signTypedData).toHaveBeenCalledOnce();
    expect(session()).not.toHaveProperty("relayrDiscardable");
  });

  it("gives a request that ran the 'ran' Discard and never a new signature", async () => {
    const { result, session } = await signedSession();
    vi.setSystemTime(new Date(PAST_DEADLINE * 1_000));
    chainAt({ timestamp: PAST_DEADLINE, finalizedNonce: 5n });
    vi.stubGlobal("fetch", nextQuote());
    await expect(result.current.getRelayrTxQuote([GUARDED])).rejects.toThrow(
      /may already have run/,
    );
    expect(mocks.signTypedData).toHaveBeenCalledOnce();
    expect(fetch).not.toHaveBeenCalled();
    expect(session()).toMatchObject({ relayrDiscardable: "ran" });
  });

  it("runs the recheck once every request is dead and unused, then signs again at the saved nonces", async () => {
    const { activity, result } = await signedSession();
    vi.setSystemTime(new Date(PAST_DEADLINE * 1_000));
    chainAt({ timestamp: PAST_DEADLINE, finalizedNonce: 4n });
    mocks.getBlock.mockClear();
    mocks.clientCall.mockClear();
    vi.stubGlobal("fetch", nextQuote());
    await act(async () => {
      await expect(result.current.getRelayrTxQuote([GUARDED])).resolves.toMatchObject({
        bundle_uuid: OTHER_BUNDLE_UUID,
      });
    });
    expect(mocks.signTypedData).toHaveBeenCalledTimes(2);
    expect(mocks.signTypedData.mock.calls[1][0].message.nonce).toBe(4n);
    // The requests were classified at the finalized block before the recheck read the
    // reviewed precondition, and both came before the new signature.
    const finalized = mocks.getBlock.mock.calls.findIndex(
      ([args]) => args.blockTag === "finalized",
    );
    const recheck = mocks.clientCall.mock.calls.findIndex(([args]) => args.to === GUARD);
    expect(finalized).toBeGreaterThanOrEqual(0);
    expect(mocks.getBlock.mock.invocationCallOrder[finalized]).toBeLessThan(
      mocks.clientCall.mock.invocationCallOrder[recheck],
    );
    expect(mocks.clientCall.mock.invocationCallOrder[recheck]).toBeLessThan(
      mocks.signTypedData.mock.invocationCallOrder[1],
    );
    const rows = activity.transactionActivitySnapshot();
    expect(rows.find((row) => row.bundleUuid === OTHER_BUNDLE_UUID)).toMatchObject({
      relayrPaymentStatus: "unfunded",
      relayrNonces: ["4"],
    });
    expect(rows.find((row) => row.bundleUuid === BUNDLE_UUID)).toMatchObject({
      relayrPaymentStatus: "expired",
    });
  });

  it("holds when the recheck can't reach the node", async () => {
    const { result, session } = await signedSession();
    vi.setSystemTime(new Date(PAST_DEADLINE * 1_000));
    chainAt({ timestamp: PAST_DEADLINE, finalizedNonce: 4n });
    guardReads(async () => {
      throw new HttpRequestError({ url: "https://rpc.example", status: 503 });
    });
    vi.stubGlobal("fetch", nextQuote());
    await expect(result.current.getRelayrTxQuote([GUARDED])).rejects.toThrow(
      "Couldn't check the revnet. Try again.",
    );
    expect(mocks.signTypedData).toHaveBeenCalledOnce();
    expect(fetch).not.toHaveBeenCalled();
    expect(session()).not.toHaveProperty("relayrDiscardable");
  });
  it("never signs again at the live nonce for the calls of a quote the device clock expired before sessions saved their nonces", async () => {
    const { activity, result, session } = await signedSession();
    activity.updateTransactionActivity(session()!.id, {
      status: "failed",
      relayrPaymentStatus: "expired",
      relayrNonces: undefined,
    });
    vi.stubGlobal("fetch", nextQuote());
    await expect(result.current.getRelayrTxQuote([GUARDED])).rejects.toThrow(
      /earlier signature can still run until/,
    );
    // With no saved nonce, a dead request may have run.
    vi.setSystemTime(new Date(PAST_DEADLINE * 1_000));
    chainAt({ timestamp: PAST_DEADLINE, finalizedNonce: 4n });
    await expect(result.current.getRelayrTxQuote([GUARDED])).rejects.toThrow(
      /may already have run/,
    );
    expect(mocks.signTypedData).toHaveBeenCalledOnce();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("gives a recheck that refuses the calls the 'changed' Discard and no signature", async () => {
    const { result, session } = await signedSession();
    vi.setSystemTime(new Date(PAST_DEADLINE * 1_000));
    chainAt({ timestamp: PAST_DEADLINE, finalizedNonce: 4n });
    guardReads(async () => ({ data: `0x${"00".repeat(32)}` }));
    await expect(result.current.getRelayrTxQuote([GUARDED])).rejects.toThrow(
      "The revnet changed since this review.",
    );
    expect(mocks.signTypedData).toHaveBeenCalledOnce();
    expect(session()).toMatchObject({ relayrDiscardable: "changed" });
  });

  it("refuses another call in the recovery scope of a session that may have run, but not one that shares only its forwarder nonce", async () => {
    const scoped = { ...GUARDED, recoveryScope: "project-metadata:1:4" };
    const { result, session } = await signedSession(scoped);
    vi.setSystemTime(new Date(PAST_DEADLINE * 1_000));
    chainAt({ timestamp: PAST_DEADLINE, finalizedNonce: 5n });
    await expect(
      result.current.getRelayrTxQuote([
        { ...scoped, data: { ...scoped.data, data: "0x5678" as Hex } },
      ]),
    ).rejects.toThrow(/may already have run/);
    expect(session()).toMatchObject({ relayrDiscardable: "ran" });
    // Marked for Discard, it refuses every other call in its scope until it is discarded.
    await expect(
      result.current.getRelayrTxQuote([
        { ...scoped, data: { ...scoped.data, data: "0x6789" as Hex } },
      ]),
    ).rejects.toThrow(/may already have run/);
    // Every request of the old session is dead, so it reserves no forwarder nonce (R117).
    vi.stubGlobal("fetch", nextQuote());
    await act(async () => {
      await expect(
        result.current.getRelayrTxQuote([
          {
            ...GUARDED,
            recoveryScope: "project-splits:1:4:123:1",
            data: { ...GUARDED.data, data: "0x9999" as Hex },
          },
        ]),
      ).resolves.toMatchObject({ bundle_uuid: OTHER_BUNDLE_UUID });
    });
    expect(mocks.signTypedData).toHaveBeenCalledTimes(2);
    expect(mocks.signTypedData.mock.calls[1][0].message.nonce).toBe(5n);
  });

  describe("a quote whose payment reverted (ruling R104)", () => {
    /** The session's payment reverted, and the device clock is past its quote's deadline unless `open`. */
    async function revertedPayment({ open = false } = {}) {
      const harness = await signedSession();
      mocks.getTransactionReceipt.mockResolvedValue({
        ...onchain(PAYMENT_TARGET, payment().calldata),
        status: "reverted",
      });
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => new Response(JSON.stringify({ bundle_uuid: "wrong" }), { status: 200 })),
      );
      const payer = renderHook(() => harness.hooks.useSendRelayrTx());
      await expect(payer.result.current.sendRelayrTx(payment())).rejects.toThrow(/uncertain/);
      expect(harness.session()).toMatchObject({ relayrPaymentStatus: "reverted" });
      if (!open) vi.setSystemTime(new Date((NOW + 700) * 1_000));
      return harness;
    }

    it("is paid again from its saved quote while that quote is open, with no new signature or quote", async () => {
      const { result } = await revertedPayment({ open: true });
      const reads = relayrReads();
      await act(async () => {
        await expect(result.current.getRelayrTxQuote([GUARDED])).resolves.toMatchObject({
          bundle_uuid: BUNDLE_UUID,
        });
      });
      expect(mocks.signTypedData).toHaveBeenCalledOnce();
      expect(reads.mock.calls.some(([url]) => String(url).endsWith("/v1/bundle/prepaid"))).toBe(
        false,
      );
    });

    it("is released once its deadline is final and Relayr reads it unpaid, and the same signatures are quoted again", async () => {
      const { result, session } = await revertedPayment();
      chainAt({ timestamp: NOW + 700, finalizedNonce: 4n });
      const reads = relayrReads();
      await act(async () => {
        await expect(result.current.getRelayrTxQuote([GUARDED])).resolves.toMatchObject({
          bundle_uuid: OTHER_BUNDLE_UUID,
        });
      });
      expect(mocks.signTypedData).toHaveBeenCalledOnce();
      // Relayr was read once for another payer and once more right before the release.
      expect(
        reads.mock.calls.filter(([url]) => String(url).endsWith(`/v1/bundle/${BUNDLE_UUID}`)),
      ).toHaveLength(2);
      expect(session()).toMatchObject({ relayrPaymentStatus: "expired" });
    });

    it("holds, and is never paid or quoted again, while Relayr reports another payment", async () => {
      const { result } = await revertedPayment();
      chainAt({ timestamp: NOW + 700, finalizedNonce: 4n });
      relayrReads({ payment_received: true });
      await expect(result.current.getRelayrTxQuote([GUARDED])).rejects.toThrow(
        "Another payment funded this Relayr quote. Check again once its calls have run; do not pay again.",
      );
      expect(mocks.signTypedData).toHaveBeenCalledOnce();
      expect(mocks.sendTransaction).toHaveBeenCalledOnce();
    });

    it("proves the calls another payment funded, and is never paid or quoted again", async () => {
      const { hooks, result, session } = await revertedPayment();
      const [signed] = session()!.relayrExpectedTransactions!;
      const DESTINATION = `0x${"de".repeat(32)}` as Hex;
      // The destination's run moved the latest nonce; no finalized block shows it yet.
      chainAt({ timestamp: NOW + 700, finalizedNonce: 4n, liveNonce: 5n });
      relayrReads({
        payment_received: true,
        transactions: [
          {
            tx_uuid: signed.transactionUuid,
            request: {
              chain: signed.chainId,
              target: signed.target,
              data: signed.data,
              value: signed.value,
            },
            status: { state: "Success", data: { hash: DESTINATION } },
          },
        ],
      });
      // The destination ran on its chain; the session's own payment reverted.
      const destination = {
        ...onchain(signed.target, signed.data, 3n),
        hash: DESTINATION,
        transactionHash: DESTINATION,
        logs: [],
      };
      mocks.getTransaction.mockImplementation(async ({ hash }: { hash: Hex }) =>
        hash === DESTINATION ? destination : onchain(PAYMENT_TARGET, payment().calldata),
      );
      mocks.getTransactionReceipt.mockImplementation(async ({ hash }: { hash: Hex }) =>
        hash === DESTINATION
          ? destination
          : { ...onchain(PAYMENT_TARGET, payment().calldata), status: "reverted" },
      );
      await expect(result.current.getRelayrTxQuote([GUARDED])).rejects.toThrow(
        "Another payment funded this Relayr quote. Check again once its calls have run; do not pay again.",
      );
      await expect(hooks.waitForRelayrBundle(BUNDLE_UUID)).resolves.toMatchObject({
        payment_received: true,
      });
      expect(session()).toMatchObject({ status: "success", manualVerificationRequired: false });
      expect(mocks.signTypedData).toHaveBeenCalledOnce();
      expect(mocks.sendTransaction).toHaveBeenCalledOnce();
    });

    it("is never proven from Relayr's records while no other payment funded it", async () => {
      const { hooks, session } = await revertedPayment();
      const [signed] = session()!.relayrExpectedTransactions!;
      relayrReads({
        transactions: [
          {
            tx_uuid: signed.transactionUuid,
            request: {
              chain: signed.chainId,
              target: signed.target,
              data: signed.data,
              value: signed.value,
            },
            status: { state: "Pending" },
          },
        ],
      });
      await expect(hooks.waitForRelayrBundle(BUNDLE_UUID)).rejects.toThrow(
        /funding transaction reverted/,
      );
      expect(session()).toMatchObject({ relayrPaymentStatus: "reverted" });
    });

    it("holds while its deadline is not final, saying until when its signature can run", async () => {
      const { result } = await revertedPayment();
      chainAt({ timestamp: NOW + 500, finalizedNonce: 4n });
      relayrReads();
      await expect(result.current.getRelayrTxQuote([GUARDED])).rejects.toThrow(
        /earlier signature can still run until/,
      );
      expect(mocks.signTypedData).toHaveBeenCalledOnce();
    });
  });

  it("holds a paid bundle whose calls reverted while they can run, then marks it for Discard and signs again at the saved nonces once they are dead and unused", async () => {
    const { activity, hooks, result, session } = await signedSession();
    const [signed] = session()!.relayrExpectedTransactions!;
    // Relayr ran the paid bundle and its destination reverted.
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              bundle_uuid: BUNDLE_UUID,
              payment_received: true,
              transactions: [
                {
                  tx_uuid: signed.transactionUuid,
                  request: {
                    chain: signed.chainId,
                    target: signed.target,
                    data: signed.data,
                    value: signed.value,
                  },
                  status: { state: "Failed" },
                },
              ],
            }),
            { status: 200 },
          ),
      ),
    );
    const payer = renderHook(() => hooks.useSendRelayrTx());
    await act(async () => {
      await expect(payer.result.current.sendRelayrTx(payment())).resolves.toBe(HASH);
    });
    await expect(hooks.waitForRelayrBundle(BUNDLE_UUID)).rejects.toThrow(/failed/);
    expect(session()).toMatchObject({ status: "failed", manualVerificationRequired: true });
    expect(session()).not.toHaveProperty("relayrDiscardable");
    await expect(result.current.getRelayrTxQuote([GUARDED])).rejects.toThrow(
      /earlier signature can still run until/,
    );
    // A forwarder execute that reverts leaves its nonce unused.
    vi.setSystemTime(new Date(PAST_DEADLINE * 1_000));
    chainAt({ timestamp: PAST_DEADLINE, finalizedNonce: 4n });
    await expect(hooks.waitForRelayrBundle(BUNDLE_UUID)).rejects.toThrow(/failed/);
    expect(session()).toMatchObject({
      relayrDiscardable: "expired",
      message: "This action's earlier signatures expired without running.",
    });
    vi.stubGlobal("fetch", nextQuote());
    await act(async () => {
      await expect(result.current.getRelayrTxQuote([GUARDED])).resolves.toMatchObject({
        bundle_uuid: OTHER_BUNDLE_UUID,
      });
    });
    expect(mocks.signTypedData).toHaveBeenCalledTimes(2);
    expect(mocks.signTypedData.mock.calls[1][0].message.nonce).toBe(4n);
    expect(
      activity.transactionActivitySnapshot().find((row) => row.bundleUuid === BUNDLE_UUID),
    ).toMatchObject({ relayrPaymentStatus: "expired", manualVerificationRequired: false });
  });

  it("checks an unpaid session from the account view, and discards it only once every request is dead", async () => {
    const { hooks, session } = await signedSession();
    const id = session()!.id;
    await hooks.checkRelayrSession(id);
    expect(session()?.message).toMatch(/earlier signature can still run until/);
    expect(() => hooks.discardRelayrSession(id)).toThrow(/can no longer run/);
    vi.setSystemTime(new Date(PAST_DEADLINE * 1_000));
    chainAt({ timestamp: PAST_DEADLINE, finalizedNonce: 4n });
    await hooks.checkRelayrSession(id);
    expect(session()).toMatchObject({
      relayrDiscardable: "expired",
      message: "This action's earlier signatures expired without running.",
    });
    hooks.discardRelayrSession(id);
    expect(session()).toBeUndefined();
  });

  it.each([
    ["ran", 5n],
    ["expired", 4n],
  ] as const)(
    "after a %s Discard, abandons a pending batch with the session or quotes its round again (R114 (f))",
    async (reason, finalizedNonce) => {
      const { activity, hooks, session } = await signedSession();
      const batches = await import("@/lib/multichain-batch");
      batches.saveMultichainBatch({
        id: "multichain:batch",
        scope: "payouts",
        label: "Send payouts",
        account: ACCOUNT,
        key: "0x",
        route: "relayr",
        calls: [],
        rounds: [{ indices: [0], bundleUuid: BUNDLE_UUID, state: "funding" }],
        status: "pending",
        createdAt: NOW,
      });
      activity.recordTransactionActivity({
        id: "multichain:batch",
        kind: "direct",
        title: "Send payouts",
        status: "pending",
        manualVerificationRequired: true,
        account: ACCOUNT,
        message: "The exact selected calls are saved. Resume this batch to continue safely.",
      });
      vi.setSystemTime(new Date(PAST_DEADLINE * 1_000));
      chainAt({ timestamp: PAST_DEADLINE, finalizedNonce });
      await hooks.checkRelayrSession(session()!.id);
      expect(session()).toMatchObject({ relayrDiscardable: reason });
      hooks.discardRelayrSession(session()!.id);
      expect(session()).toBeUndefined();
      const batch = activity
        .transactionActivitySnapshot()
        .find((row) => row.id === "multichain:batch");
      if (reason === "ran") {
        expect(batches.readMultichainBatches()).toEqual([]);
        expect(batch).toMatchObject({ status: "failed", manualVerificationRequired: false });
      } else {
        expect(batches.readMultichainBatches()[0].rounds[0].state).toBe("quoted");
        expect(batch).toMatchObject({ status: "pending", manualVerificationRequired: true });
      }
    },
  );
  it("holds after a reorg left the finalized nonce below a saved one, for its own calls and a changed one", async () => {
    const scoped = { ...GUARDED, recoveryScope: "project-metadata:1:4" };
    const { result, session } = await signedSession(scoped);
    vi.setSystemTime(new Date(PAST_DEADLINE * 1_000));
    chainAt({ timestamp: PAST_DEADLINE, finalizedNonce: 3n });
    await expect(result.current.getRelayrTxQuote([scoped])).rejects.toThrow(
      "This action's earlier signature may still run. Try again in a few minutes.",
    );
    await expect(
      result.current.getRelayrTxQuote([
        { ...scoped, data: { ...scoped.data, data: "0x5678" as Hex } },
      ]),
    ).rejects.toThrow("This action's earlier signature may still run. Try again in a few minutes.");
    expect(mocks.signTypedData).toHaveBeenCalledOnce();
    expect(session()).not.toHaveProperty("relayrDiscardable");
  });

  it("holds while one request can still run and another may already have run", async () => {
    const harness = await freshHarness();
    harness.review.registerTransactionReviewHandler(async () => true);
    guardReads(async () => ({ data: GUARD_VALUE }));
    vi.stubGlobal("fetch", relayrApi());
    const quoter = renderHook(() => harness.hooks.useGetRelayrTxQuote());
    const requests = [GUARDED, { ...GUARDED, chainId: 10 as const }];
    await act(async () => {
      await quoter.result.current.getRelayrTxQuote(requests);
    });
    // On chain 1 the nonce moved; on chain 10 the request is unused and before its deadline.
    chainAt({ timestamp: NOW + 700, finalizedNonce: 5n });
    const moved = mocks.readContract.getMockImplementation()!;
    const client = mocks.getPublicClient();
    mocks.getPublicClient.mockImplementation(
      (_config: unknown, { chainId }: { chainId: number }) =>
        chainId === 10
          ? {
              ...client,
              readContract: async (args: { functionName: string }) =>
                args.functionName === "nonces" ? 4n : moved(args),
            }
          : client,
    );
    vi.stubGlobal("fetch", nextQuote());
    await expect(quoter.result.current.getRelayrTxQuote(requests)).rejects.toThrow(
      /earlier signature can still run until/,
    );
    expect(mocks.signTypedData).toHaveBeenCalledTimes(2);
    expect(
      harness.activity.transactionActivitySnapshot().find((row) => row.bundleUuid === BUNDLE_UUID)
        ?.relayrDiscardable,
    ).toBeUndefined();
  });

  it("stops reserving the forwarder nonce of another action once every request is dead (R117)", async () => {
    const { activity, result, session } = await signedSession({
      ...GUARDED,
      recoveryScope: "project-metadata:1:4",
    });
    const other = {
      ...GUARDED,
      recoveryScope: "project-splits:1:4:123:1",
      data: { ...GUARDED.data, data: "0x9999" as Hex },
    };
    await expect(result.current.getRelayrTxQuote([other])).rejects.toThrow(
      /published authorizations/,
    );
    vi.setSystemTime(new Date(PAST_DEADLINE * 1_000));
    chainAt({ timestamp: PAST_DEADLINE, finalizedNonce: 4n });
    vi.stubGlobal("fetch", nextQuote());
    await act(async () => {
      await expect(result.current.getRelayrTxQuote([other])).resolves.toMatchObject({
        bundle_uuid: OTHER_BUNDLE_UUID,
      });
    });
    expect(mocks.signTypedData).toHaveBeenCalledTimes(2);
    expect(mocks.signTypedData.mock.calls[1][0].message.nonce).toBe(4n);
    expect(session()).toMatchObject({ relayrPaymentStatus: "unfunded" });
    expect(session()).not.toHaveProperty("relayrDiscardable");
    expect(activity.transactionActivitySnapshot()).toHaveLength(2);
  });

  describe("a raw bundle, which has no forwarder nonce", () => {
    const raw = {
      ...REQUEST,
      relayrMode: "raw" as const,
      recoveryScope: "project-payer:1:4",
      expectedDeployment: {
        kind: "project-payer" as const,
        projectId: "4",
        beneficiary: ACCOUNT,
        owner: ACCOUNT,
        addToBalance: false,
        memo: "",
        metadata: "0x" as Hex,
        directory: TARGET,
      },
      data: {
        ...REQUEST.data,
        to: JB_PROJECT_PAYER_DEPLOYER,
        value: 0n,
        data: encodeFunctionData({
          abi: jbProjectPayerDeployerAbi,
          functionName: "deployProjectPayer",
          args: [4n, ACCOUNT, "", "0x", false, ACCOUNT],
        }),
      },
    };

    /** An unpaid raw quote whose payment deadline (NOW + 600) is final onchain. */
    async function rawQuote() {
      const harness = await freshHarness();
      harness.review.registerTransactionReviewHandler(async () => true);
      vi.stubGlobal("fetch", relayrApi());
      const quoter = renderHook(() => harness.hooks.useGetRelayrTxQuote());
      await act(async () => {
        await quoter.result.current.getRelayrTxQuote([raw]);
      });
      vi.setSystemTime(new Date((NOW + 700) * 1_000));
      chainAt({ timestamp: NOW + 700, finalizedNonce: 4n });
      const row = () =>
        harness.activity
          .transactionActivitySnapshot()
          .find((item) => item.bundleUuid === BUNDLE_UUID);
      return { ...harness, result: quoter.result, row };
    }

    it("is never quoted again while Relayr reports it paid from another device", async () => {
      const { hooks, result, row } = await rawQuote();
      const reads = relayrReads({
        payment_received: true,
        transactions: [{ tx_uuid: TX_UUIDS[0], status: { state: "Success" } }],
      });
      await expect(
        hooks.requireRelayrRecoveryScopeAvailable(ACCOUNT, "project-payer:1:4"),
      ).rejects.toThrow(/still requires reconciliation/);
      await expect(result.current.getRelayrTxQuote([raw])).rejects.toThrow(
        /published authorizations/,
      );
      expect(reads.mock.calls.some(([url]) => String(url).endsWith("/v1/bundle/prepaid"))).toBe(
        false,
      );
      expect(
        reads.mock.calls.some(([url]) => String(url).endsWith(`/v1/bundle/${BUNDLE_UUID}`)),
      ).toBe(true);
      expect(row()).toMatchObject({ relayrPaymentStatus: "unfunded" });
    });

    it("is released once its deadline is final and Relayr reads it unpaid, and the same call is quoted anew", async () => {
      const { result, row } = await rawQuote();
      const reads = relayrReads();
      await act(async () => {
        await expect(result.current.getRelayrTxQuote([raw])).resolves.toMatchObject({
          bundle_uuid: OTHER_BUNDLE_UUID,
        });
      });
      expect(
        reads.mock.calls.filter(([url]) => String(url).endsWith("/v1/bundle/prepaid")),
      ).toHaveLength(1);
      expect(row()).toMatchObject({ relayrPaymentStatus: "expired" });
      expect(mocks.signTypedData).not.toHaveBeenCalled();
    });
  });

  it("abandons a pending batch by its round's scope after a 'ran' Discard of a session Relayr never named (R114 (f))", async () => {
    const { activity, hooks, review } = await freshHarness();
    review.registerTransactionReviewHandler(async () => true);
    const batches = await import("@/lib/multichain-batch");
    const call = {
      chainId: 1,
      address: TARGET,
      abi: [],
      functionName: "setUriOf",
      args: [],
      value: 3n,
      data: "0x1234" as Hex,
      state: "ready" as const,
    };
    const batch = {
      id: "multichain:batch",
      scope: "payouts",
      label: "Send payouts",
      account: ACCOUNT,
      key: "0x",
      route: "relayr" as const,
      calls: [call],
      rounds: [{ indices: [0], state: "ready" as const }],
      status: "pending" as const,
      createdAt: NOW,
    };
    batches.saveMultichainBatch(batch);
    activity.recordTransactionActivity({
      id: batch.id,
      kind: "direct",
      title: "Send payouts",
      status: "pending",
      manualVerificationRequired: true,
      account: ACCOUNT,
      message: "The exact selected calls are saved. Resume this batch to continue safely.",
    });
    // The round's quote reached Relayr, but its response was lost.
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("POST response lost")));
    const quoter = renderHook(() => hooks.useGetRelayrTxQuote());
    await expect(
      quoter.result.current.getRelayrTxQuote([
        { ...REQUEST, recoveryScope: batches.batchCallScope(batch, call, 0) },
      ]),
    ).rejects.toThrow(/POST response lost/);
    const publication = activity
      .transactionActivitySnapshot()
      .find((row) => row.kind === "relayr-bundle")!;
    expect(publication.bundleUuid).toBeUndefined();
    // Another action used the forwarder nonce: the session may have run.
    vi.setSystemTime(new Date(PAST_DEADLINE * 1_000));
    chainAt({ timestamp: PAST_DEADLINE, finalizedNonce: 5n });
    await hooks.checkRelayrSession(publication.id);
    expect(
      activity.transactionActivitySnapshot().find((row) => row.id === publication.id),
    ).toMatchObject({ relayrDiscardable: "ran" });
    hooks.discardRelayrSession(publication.id);
    // Nothing is left to resume, so its calls go out again only after a fresh review.
    expect(batches.findPendingBatch(ACCOUNT, "payouts")).toBeUndefined();
    expect(activity.transactionActivitySnapshot().find((row) => row.id === batch.id)).toMatchObject(
      { status: "failed", manualVerificationRequired: false },
    );
  });

  describe("a paid bundle that Relayr leaves pending", () => {
    const scoped = { ...GUARDED, recoveryScope: "project-metadata:1:4" };

    /** The session paid, its payment proven, and Relayr still running it. */
    async function paidSession() {
      const harness = await signedSession(scoped);
      harness.activity.updateTransactionActivity(harness.session()!.id, {
        status: "pending",
        relayrPaymentStatus: "confirmed",
        hash: HASH,
        chainId: 1,
        relayrPayment: { target: PAYMENT_TARGET, data: payment().calldata, value: "16" },
        relayrPayments: [
          { hash: HASH, chainId: 1, target: PAYMENT_TARGET, data: payment().calldata, value: "16" },
        ],
        message: "Relayr payment confirmed; destination transactions are still executing.",
      });
      return harness;
    }

    it("reserves its scope while a request can run, and is classified once every request is dead", async () => {
      const { hooks, result, session } = await paidSession();
      await expect(
        hooks.requireRelayrRecoveryScopeAvailable(ACCOUNT, "project-metadata:1:4"),
      ).rejects.toThrow(/still requires reconciliation/);
      await hooks.checkRelayrSession(session()!.id);
      expect(session()).not.toHaveProperty("relayrDiscardable");
      vi.setSystemTime(new Date(PAST_DEADLINE * 1_000));
      chainAt({ timestamp: PAST_DEADLINE, finalizedNonce: 4n });
      await hooks.checkRelayrSession(session()!.id);
      expect(session()).toMatchObject({ relayrDiscardable: "expired" });
      await expect(
        hooks.requireRelayrRecoveryScopeAvailable(ACCOUNT, "project-metadata:1:4"),
      ).resolves.toBeUndefined();
      vi.stubGlobal("fetch", nextQuote());
      await act(async () => {
        await expect(result.current.getRelayrTxQuote([scoped])).resolves.toMatchObject({
          bundle_uuid: OTHER_BUNDLE_UUID,
        });
      });
      expect(mocks.signTypedData).toHaveBeenCalledTimes(2);
      expect(mocks.signTypedData.mock.calls[1][0].message.nonce).toBe(4n);
    });

    it("is signed again at the saved nonces by its own action once every request is dead and unused", async () => {
      const { result } = await paidSession();
      await expect(result.current.getRelayrTxQuote([scoped])).rejects.toThrow(/submitted payment/);
      vi.setSystemTime(new Date(PAST_DEADLINE * 1_000));
      chainAt({ timestamp: PAST_DEADLINE, finalizedNonce: 4n });
      vi.stubGlobal("fetch", nextQuote());
      await act(async () => {
        await expect(result.current.getRelayrTxQuote([scoped])).resolves.toMatchObject({
          bundle_uuid: OTHER_BUNDLE_UUID,
        });
      });
      expect(mocks.signTypedData.mock.calls.map(([request]) => request.message.nonce)).toEqual([
        4n,
        4n,
      ]);
    });

    it("is marked for Discard when its check gives up after every request is dead", async () => {
      const { hooks, session } = await paidSession();
      const [signed] = session()!.relayrExpectedTransactions!;
      vi.stubGlobal(
        "fetch",
        vi.fn(
          async () =>
            new Response(
              JSON.stringify({
                bundle_uuid: BUNDLE_UUID,
                payment_received: true,
                transactions: [
                  {
                    tx_uuid: signed.transactionUuid,
                    request: {
                      chain: signed.chainId,
                      target: signed.target,
                      data: signed.data,
                      value: signed.value,
                    },
                    status: { state: "Pending" },
                  },
                ],
              }),
              { status: 200 },
            ),
        ),
      );
      vi.setSystemTime(new Date(PAST_DEADLINE * 1_000));
      chainAt({ timestamp: PAST_DEADLINE, finalizedNonce: 4n });
      vi.useFakeTimers({ toFake: ["setTimeout"] });
      try {
        const waiting = hooks.waitForRelayrBundle(BUNDLE_UUID);
        const gaveUp = expect(waiting).rejects.toThrow(/still pending after the status timeout/);
        await vi.advanceTimersByTimeAsync(2_000 * 180);
        await gaveUp;
      } finally {
        vi.useRealTimers();
      }
      expect(session()).toMatchObject({ relayrDiscardable: "expired" });
    });
  });
});
