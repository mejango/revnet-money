import type { ReviewedRelayrRequest } from "@/hooks/useReviewedRelayr";
import type { ChainPayment, RelayrPostBundleResponse } from "@/lib/nana/types";
import { pendingRouterCommitment } from "@/lib/pending-router-calls";
import { routerGatewayAbi } from "@/lib/router-gateway-abi";
import type { TransactionReviewRequest } from "@/lib/transaction-review";
import {
  RELAYR_PAYMENT_EVENT,
  RelayrPaymentNotSentError,
} from "@bananapus/nana-sdk-core/review/relayr";
import { canonicalSafeTxHash, SAFE_EXEC_ABI } from "@bananapus/nana-sdk-core/safe-service";
import { JB_PROJECT_PAYER_DEPLOYER, jbProjectPayerDeployerAbi } from "@bananapus/nana-sdk-core/v6";
import { act, renderHook } from "@testing-library/react";
import {
  decodeFunctionData,
  encodeAbiParameters,
  encodeEventTopics,
  encodeFunctionData,
  encodeFunctionResult,
  HttpRequestError,
  keccak256,
  parseAbi,
  parseAbiParameters,
  toFunctionSelector,
  zeroAddress,
  zeroHash,
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
  rawRequest: vi.fn(),
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
const CONTEXT_CHANGES = [
  "account",
  "disconnected",
  "chain",
  "connector",
  "wallet mode",
  "view-as",
] as const;
function changeContext(
  change: (typeof CONTEXT_CHANGES)[number],
  viewAs: (account: Address) => void,
) {
  if (change === "account") mocks.account.address = OTHER_ACCOUNT;
  else if (change === "disconnected") mocks.account.address = undefined;
  else if (change === "chain") mocks.account.chainId = 10;
  else if (change === "connector") mocks.account.connector = { id: "injected", name: "Injected" };
  else if (change === "wallet mode") mocks.account.connector!.id = "safe";
  else viewAs(OTHER_ACCOUNT);
}

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

describe("saved unpaid quote release evidence", () => {
  it("requires a retained released session and rejects any payment evidence", async () => {
    const { activity, hooks } = await freshHarness();
    expect(hooks.isReleasedUnpaidRelayrBundle(ACCOUNT, BUNDLE_UUID)).toBe(false);
    activity.recordTransactionActivity({
      id: "released-quote",
      kind: "relayr-bundle",
      title: "Routing",
      status: "failed",
      account: ACCOUNT,
      bundleUuid: BUNDLE_UUID,
      message: "Expired unpaid quote",
      relayrPaymentStatus: "expired",
    });
    expect(hooks.isReleasedUnpaidRelayrBundle(ACCOUNT, BUNDLE_UUID)).toBe(true);
    activity.updateTransactionActivity("released-quote", { hash: HASH });
    expect(hooks.isReleasedUnpaidRelayrBundle(ACCOUNT, BUNDLE_UUID)).toBe(false);
  });
  it.each(["unfunded", "submitted", "confirmed"] as const)(
    "keeps %s quotes reserved without canonical release evidence",
    async (relayrPaymentStatus) => {
      const { activity, hooks } = await freshHarness();
      activity.recordTransactionActivity({
        id: "live-quote",
        kind: "relayr-bundle",
        title: "Routing",
        status: "pending",
        account: ACCOUNT,
        bundleUuid: BUNDLE_UUID,
        message: "Saved quote",
        relayrPaymentStatus,
      });
      expect(hooks.isReleasedUnpaidRelayrBundle(ACCOUNT, BUNDLE_UUID)).toBe(false);
    },
  );
});

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
    request: mocks.rawRequest,
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
  mocks.rawRequest.mockResolvedValue("0x");
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
  for (const stage of ["switch", "review", "preconditions"] as const) {
    it.each(CONTEXT_CHANGES)(
      `does not authorize after %s changes during deferred ${stage}`,
      async (change) => {
        const { review, hooks, activity } = await freshHarness();
        const { setViewAs } = await import("@/lib/view-as");
        let release!: () => void;
        let entered = false;
        let reviewed = false;
        const waiting = new Promise<void>((resolve) => {
          release = resolve;
        });
        const pause = async () => {
          entered = true;
          await waiting;
        };
        review.registerTransactionReviewHandler(async () => {
          if (stage === "review") await pause();
          reviewed = true;
          return true;
        });
        if (stage === "switch")
          mocks.switchChain.mockImplementation(async () => {
            await pause();
          });
        const guard = { address: TARGET, data: "0xabcdef" as Hex, expected: "0x" as Hex };
        mocks.clientCall.mockImplementation(async ({ data }: { data: Hex }) => {
          if (stage === "preconditions" && reviewed && data === guard.data) await pause();
          return { data: "0x" };
        });
        const api = relayrApi();
        vi.stubGlobal("fetch", api);
        const { result } = renderHook(() => hooks.useGetRelayrTxQuote());
        await act(async () => {
          const pending = result.current.getRelayrTxQuote([{ ...REQUEST, preconditions: [guard] }]);
          const refused = expect(pending).rejects.toThrow();
          await vi.waitFor(() => expect(entered).toBe(true));
          changeContext(change, setViewAs);
          release();
          await refused;
        });
        expect(mocks.signTypedData).not.toHaveBeenCalled();
        expect(api).not.toHaveBeenCalled();
        expect(activity.transactionActivitySnapshot()).toEqual([]);
      },
    );
  }
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
        title: "Authorization publication",
        relayrPaymentStatus: "unfunded",
      }),
    ]);
    const payer = renderHook(() => hooks.useSendRelayrTx());
    await expect(payer.result.current.sendRelayrTx(payment())).rejects.toThrow(
      /does not belong to a reviewed quote/,
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
      /Relayr|quote deadline|No funding option/,
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
    const preconditions = [source, { ...source, data: "0xABCD" as Hex }];
    const authorizer = renderHook(() => hooks.useGetRelayrTxQuote());
    await act(async () => {
      await authorizer.result.current.getRelayrTxQuote([{ ...raw, preconditions }]);
    });
    expect(
      activity.transactionActivitySnapshot()[0].relayrExpectedTransactions?.[0].preconditions,
    ).toEqual(preconditions);
    // The source is checked before and after the review, once in each pass.
    const sourceReads = () =>
      mocks.clientCall.mock.calls.filter(([{ data }]) => data?.toLowerCase() === source.data);
    expect(sourceReads()).toHaveLength(2);
    mocks.clientCall.mockResolvedValue({ data: "0x02" });
    const payer = renderHook(() => hooks.useSendRelayrTx());
    await expect(payer.result.current.sendRelayrTx(payment())).rejects.toThrow(
      /reviewed state changed/,
    );
    expect(sourceReads()).toHaveLength(3);
    expect(mocks.sendTransaction).not.toHaveBeenCalled();
  });
});

describe("raw pending-payment publication and funding", () => {
  const gateway = "0x4a56aef5b6a5b9742abb02ca67c5a85ba183d901" as Address;
  function pendingRequest(id: Hex): ReviewedRelayrRequest {
    const call = {
      amount: 100n,
      preferAddToBalance: false,
      shouldReturnHeldFees: false,
      beneficiary: ACCOUNT,
      projectId: 1n,
      refundTo: ACCOUNT,
      sourceProjectId: 6n,
      token: zeroAddress,
    };
    return {
      chainId: 1,
      relayrMode: "raw",
      recoveryScope: `pending:1:${id}`,
      expectedRouterPending: {
        gateway,
        pendingCallId: id,
        callHash: keccak256(
          encodeAbiParameters(
            parseAbiParameters(
              "(uint256 amount,bool preferAddToBalance,bool shouldReturnHeldFees,address beneficiary,uint256 projectId,address refundTo,uint256 sourceProjectId,address token)",
            ),
            [call],
          ),
        ),
      },
      preconditions: [
        {
          address: gateway,
          data: encodeFunctionData({
            abi: routerGatewayAbi,
            functionName: "pendingCallCommitmentOf",
            args: [id],
          }),
          expected: pendingRouterCommitment(call, "", "0x"),
        },
        {
          address: gateway,
          data: encodeFunctionData({
            abi: routerGatewayAbi,
            functionName: "pendingCallFailureOf",
            args: [id],
          }),
          expected: encodeFunctionResult({
            abi: routerGatewayAbi,
            functionName: "pendingCallFailureOf",
            result: { errorHash: zeroHash, count: 0, lastFailureAt: 0, highestGasLimit: 0n },
          }),
        },
      ],
      data: {
        from: ACCOUNT,
        to: gateway,
        value: 0n,
        gas: 6_600_000n,
        data: encodeFunctionData({
          abi: routerGatewayAbi,
          functionName: "processPendingCall",
          args: [id, call, "", "0x"],
        }),
      },
    };
  }
  function sources(requests: ReviewedRelayrRequest[]) {
    mocks.clientCall.mockImplementation(async ({ data }: { data: Hex }) => ({
      data:
        requests
          .flatMap((request) => request.preconditions ?? [])
          .find((guard) => guard.data === data)?.expected ?? "0x",
    }));
  }
  it("publishes repeated-chain pending calls as distinct raw transactions without forwarder signatures", async () => {
    const requests = [pendingRequest(HASH), pendingRequest(BLOCK_HASH)];
    sources(requests);
    const { hooks, review, activity } = await freshHarness();
    review.registerTransactionReviewHandler(async () => true);
    vi.stubGlobal("fetch", relayrApi());
    const quoter = renderHook(() => hooks.useGetRelayrTxQuote());
    await act(async () => {
      await quoter.result.current.getRelayrTxQuote(requests);
    });
    expect(mocks.signTypedData).not.toHaveBeenCalled();
    const posted = JSON.parse((vi.mocked(fetch).mock.calls[0][1] as RequestInit).body as string);
    expect(
      posted.transactions.map((row: { chain: number; data: Hex }) => [row.chain, row.data]),
    ).toEqual(requests.map((request) => [1, request.data.data]));
    expect(
      activity
        .transactionActivitySnapshot()[0]
        .relayrExpectedTransactions?.map((row) => [
          row.transactionUuid,
          row.expectedRouterPending?.pendingCallId,
        ]),
    ).toEqual([
      [TX_UUIDS[0], HASH],
      [TX_UUIDS[1], BLOCK_HASH],
    ]);
    expect(mocks.rawRequest).toHaveBeenCalledTimes(2);
  });
  it("refuses funding if a pending payment advances after quote publication", async () => {
    const request = pendingRequest(HASH);
    sources([request]);
    const { hooks, review } = await freshHarness();
    review.registerTransactionReviewHandler(async () => true);
    vi.stubGlobal("fetch", relayrApi());
    const quoter = renderHook(() => hooks.useGetRelayrTxQuote());
    await act(async () => {
      await quoter.result.current.getRelayrTxQuote([request]);
    });
    mocks.clientCall.mockResolvedValue({ data: zeroHash });
    const payer = renderHook(() => hooks.useSendRelayrTx());
    await expect(payer.result.current.sendRelayrTx(payment())).rejects.toThrow(
      /reviewed state changed/,
    );
    expect(mocks.sendTransaction).not.toHaveBeenCalled();
  });
  it("reconciles every canonical receipt in a partially reverted paid batch without paying again", async () => {
    const requests = [pendingRequest(HASH), pendingRequest(BLOCK_HASH)];
    sources(requests);
    const { hooks, review, activity } = await freshHarness();
    review.registerTransactionReviewHandler(async () => true);
    let completed = false;
    vi.stubGlobal(
      "fetch",
      relayrApi({
        bundle: { payment_received: true },
        records: (records) =>
          completed
            ? records
                .map((record, index) => ({
                  ...record,
                  status: {
                    state: index ? "Failed" : "Success",
                    data: { hash: index ? BLOCK_HASH : HASH },
                  },
                }))
                .reverse()
            : records,
      }),
    );
    const quoter = renderHook(() => hooks.useGetRelayrTxQuote());
    await act(async () => {
      await quoter.result.current.getRelayrTxQuote(requests);
    });
    // Relayr funded the original entry elsewhere: no wallet payment should be offered.
    activity.updateTransactionActivity(`relayr:${BUNDLE_UUID}`, {
      relayrPaymentStatus: "reverted",
    });
    mocks.getTransaction.mockImplementation(async ({ hash }: { hash: Hex }) => ({
      ...onchain(gateway, requests[hash === HASH ? 0 : 1].data.data, 0n),
      hash,
    }));
    mocks.getTransactionReceipt.mockImplementation(async ({ hash }: { hash: Hex }) => ({
      ...onchain(gateway, requests[hash === HASH ? 0 : 1].data.data, 0n),
      transactionHash: hash,
      status: hash === HASH ? "success" : "reverted",
      logs:
        hash === HASH
          ? [
              {
                address: gateway,
                topics: encodeEventTopics({
                  abi: routerGatewayAbi,
                  eventName: "JBRouterTerminalGateway_RecordTerminalCallFailure",
                  args: { id: HASH, errorHash: zeroHash },
                }),
                data: encodeAbiParameters(parseAbiParameters("uint32,uint256,address"), [
                  1,
                  200_000n,
                  ACCOUNT,
                ]),
              },
            ]
          : [],
    }));
    completed = true;
    await hooks.waitForRelayrBundle(BUNDLE_UUID);
    const saved = activity.transactionActivitySnapshot()[0];
    expect(saved.status).toBe("success");
    expect(saved.relayrExpectedTransactions?.map((row) => row.receiptStatus)).toEqual([
      "success",
      "reverted",
    ]);
    expect(mocks.getTransactionReceipt).toHaveBeenCalledTimes(2);
    expect(mocks.sendTransaction).not.toHaveBeenCalled();
  });
  it("never publishes a pending retry when its raw RPC preflight fails", async () => {
    const request = pendingRequest(HASH);
    sources([request]);
    mocks.rawRequest.mockRejectedValue(new Error("OffchainLookup: https://attacker.invalid"));
    const { hooks, review } = await freshHarness();
    review.registerTransactionReviewHandler(async () => true);
    vi.stubGlobal("fetch", relayrApi());
    const quoter = renderHook(() => hooks.useGetRelayrTxQuote());
    await expect(quoter.result.current.getRelayrTxQuote([request])).rejects.toThrow(
      /OffchainLookup/,
    );
    expect(fetch).not.toHaveBeenCalled();
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
  for (const stage of ["switch", "review", "simulation", "persistence"] as const) {
    it.each(CONTEXT_CHANGES)(
      `keeps the quote unpaid after %s changes during ${stage}`,
      async (change) => {
        const { review, activity, result } = await quotedPayment();
        const original = structuredClone(activity.transactionActivitySnapshot());
        const { setViewAs } = await import("@/lib/view-as");
        let release!: () => void;
        let entered = false;
        const waiting = new Promise<void>((resolve) => {
          release = resolve;
        });
        const pause = async () => {
          entered = true;
          await waiting;
        };
        if (stage === "switch")
          mocks.switchChain.mockImplementation(async () => {
            await pause();
          });
        if (stage === "review")
          review.registerTransactionReviewHandler(async () => {
            await pause();
            return true;
          });
        if (stage === "simulation")
          mocks.clientCall.mockImplementation(async ({ to }: { to: Address }) => {
            if (to === PAYMENT_TARGET) await pause();
            return { data: "0x" };
          });
        let unsubscribe = () => {};
        if (stage === "persistence")
          unsubscribe = activity.subscribeTransactionActivities(() => {
            if (
              activity
                .transactionActivitySnapshot()
                .some((row) => row.relayrPaymentStatus === "submitted")
            ) {
              unsubscribe();
              changeContext(change, setViewAs);
            }
          });
        try {
          await act(async () => {
            const pending = result.current.sendRelayrTx(payment());
            const refused = expect(pending).rejects.toThrow();
            if (stage !== "persistence") {
              await vi.waitFor(() => expect(entered).toBe(true));
              changeContext(change, setViewAs);
              release();
            }
            await refused;
          });
        } finally {
          unsubscribe();
        }
        expect(mocks.sendTransaction).not.toHaveBeenCalled();
        expect(activity.transactionActivitySnapshot()[0]).toMatchObject({
          relayrPaymentStatus: "unfunded",
        });
        expect(activity.transactionActivitySnapshot()[0].hash).toBeUndefined();
        expect(activity.transactionActivitySnapshot()).toEqual(original);
      },
    );
  }

  it.each(["hash", "call", "payment history"])(
    "does not clear a changed %s after a prewallet refusal",
    async (change) => {
      const { activity, result } = await quotedPayment();
      let unsubscribe = () => {};
      unsubscribe = activity.subscribeTransactionActivities(() => {
        const current = activity.transactionActivitySnapshot()[0];
        if (current?.relayrPaymentStatus !== "submitted") return;
        unsubscribe();
        mocks.account.chainId = 10;
        activity.updateTransactionActivity(
          current.id,
          change === "hash"
            ? { hash: HASH }
            : change === "call"
              ? {
                  relayrExpectedTransactions: current.relayrExpectedTransactions!.map((row) => ({
                    ...row,
                    value: "100",
                  })),
                }
              : {
                  relayrPayments: [
                    {
                      hash: HASH,
                      chainId: 1,
                      target: PAYMENT_TARGET,
                      data: payment().calldata,
                      value: "16",
                    },
                  ],
                },
        );
      });
      try {
        await expect(result.current.sendRelayrTx(payment())).rejects.toThrow(
          /saved submission changed/,
        );
      } finally {
        unsubscribe();
      }
      expect(mocks.sendTransaction).not.toHaveBeenCalled();
      const saved = activity.transactionActivitySnapshot()[0];
      expect(saved.relayrPaymentStatus).toBe("submitted");
      if (change === "hash") expect(saved.hash).toBe(HASH);
      else if (change === "call") expect(saved.relayrExpectedTransactions![0].value).toBe("100");
      else expect(saved.relayrPayments![0].hash).toBe(HASH);
    },
  );
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
    ).rejects.toThrow(/No funding option/);
    expect(activity.transactionActivitySnapshot()).toEqual([
      expect.objectContaining({ relayrPaymentStatus: "unfunded" }),
    ]);
    // The same calls are quoted again with the published signatures, never signed again.
    await expect(
      authorizer.result.current.getRelayrTxQuote([{ ...REQUEST, chainId: 11155111 }]),
    ).rejects.toThrow(/No funding option/);
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
      expect(request).toMatchObject({
        kind: "transaction",
        title: "Review payment",
        confirmLabel: "Pay",
      });
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
      /does not belong to a reviewed quote/,
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

  it.each([false, true])(
    "keeps a wallet-thrown not-sent error uncertain after invoking the raw payment wallet (nested rejection: %s)",
    async (nestedRejection) => {
      const { activity, result } = await quotedPayment();
      mocks.sendTransaction.mockRejectedValue(
        new RelayrPaymentNotSentError(
          new Error("wallet result lost", nestedRejection ? { cause: { code: 4001 } } : undefined),
        ),
      );
      await expect(result.current.sendRelayrTx(payment())).rejects.toThrow("wallet result lost");
      expect(mocks.sendTransaction).toHaveBeenCalledOnce();
      expect(activity.transactionActivitySnapshot()[0].relayrPaymentStatus).toBe("submitted");
    },
  );

  it("restores the exact unpaid quote if it expires while saving the raw payment marker", async () => {
    const { activity, result } = await quotedPayment();
    const before = structuredClone(activity.transactionActivitySnapshot());
    const unsubscribe = activity.subscribeTransactionActivities(() => {
      if (activity.transactionActivitySnapshot()[0]?.relayrPaymentStatus === "submitted")
        vi.setSystemTime(new Date((NOW + 601) * 1_000));
    });
    try {
      await expect(result.current.sendRelayrTx(payment())).rejects.toThrow(/expired/);
    } finally {
      unsubscribe();
    }
    expect(mocks.sendTransaction).not.toHaveBeenCalled();
    expect(activity.transactionActivitySnapshot()).toEqual(before);
  });

  describe("reads a declined payment as the SDK does", () => {
    /** An error whose cause chain holds the wallet's rejection `links` causes down. */
    function rejectedBelow(links: number): unknown {
      let error: unknown = { code: 4001 };
      for (let link = 0; link < links; link += 1) error = { cause: error };
      return error;
    }

    it.each<[string, () => unknown, "unfunded" | "submitted"]>([
      [
        "viem's UserRejectedRequestError by name",
        () =>
          Object.assign(new Error("User rejected the request."), {
            name: "UserRejectedRequestError",
          }),
        "unfunded",
      ],
      ["a rejection seven causes down", () => rejectedBelow(7), "unfunded"],
      ["a rejection eight causes down", () => rejectedBelow(8), "submitted"],
    ])("as no payment sent for %s", async (_, error, status) => {
      const { activity, result } = await quotedPayment();
      mocks.sendTransaction.mockRejectedValueOnce(error());
      await expect(result.current.sendRelayrTx(payment())).rejects.toBeTruthy();
      expect(activity.transactionActivitySnapshot()[0]).toMatchObject({
        relayrPaymentStatus: status,
      });
    });
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
  const safeHash = (chainId: number, nonce = 7, data: Hex = "0x1234") =>
    canonicalSafeTxHash(chainId, SAFE, {
      to: TARGET,
      value: 0n,
      data,
      operation: 0,
      safeTxGas: 0n,
      baseGas: 0n,
      gasPrice: 0n,
      gasToken: zeroAddress,
      refundReceiver: zeroAddress,
      nonce,
    });
  const SAFE_TX_HASH = safeHash(1);
  const HASH_ABI = parseAbi([
    "function getTransactionHash(address,uint256,bytes,uint8,uint256,uint256,uint256,address,address,uint256) view returns (bytes32)",
  ]);
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
  const safeExec = (chainId: 1 | 10 | 8453 | 42161) => ({
    chainId,
    version: 6 as const,
    relayrMode: "safe-exec" as const,
    expectedSafeExecution: { safe: SAFE, safeTxHash: safeHash(chainId), nonce: 7 },
    data: { from: ACCOUNT, to: SAFE, value: 0n, gas: 200_000n, data: exec },
    review: { label: `Execute Safe transaction #7 on ${chainId}` },
  });

  function refreshingQuotes() {
    const first = relayrApi();
    const fresh = relayrApi({ bundleUuid: OTHER_BUNDLE_UUID });
    let posts = 0;
    return vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const api =
        init?.method === "POST"
          ? ++posts === 1
            ? first
            : fresh
          : String(input).endsWith(`/${BUNDLE_UUID}`)
            ? first
            : fresh;
      return api(input, init);
    });
  }

  beforeEach(() => {
    liveNonce = 7n;
    const client = mocks.getPublicClient();
    mocks.getPublicClient.mockImplementation((_config, { chainId }) => ({
      ...client,
      call: (args: object) => mocks.clientCall({ ...args, chainId }),
    }));
    mocks.rawRequest.mockImplementation(async ({ params }: { params?: [{ data?: Hex }] }) =>
      params?.[0]?.data?.startsWith(exec.slice(0, 10))
        ? encodeFunctionResult({
            abi: SAFE_EXEC_ABI,
            functionName: "execTransaction",
            result: true,
          })
        : "0x",
    );
    mocks.clientCall.mockImplementation(
      async ({ data, chainId = 1 }: { data?: Hex; chainId?: number }) => {
        if (data?.startsWith(NONCE))
          return { data: encodeAbiParameters([{ type: "uint256" }], [liveNonce]) };
        if (data?.startsWith(TX_HASH)) {
          const { args } = decodeFunctionData({ abi: HASH_ABI, data });
          return { data: safeHash(chainId, Number(args[9]), args[2]) };
        }
        return { data: "0x" };
      },
    );
  });

  it("reports the shared quoting phase after consent while the quote response is pending", async () => {
    const { hooks, review } = await freshHarness();
    let accept!: (accepted: boolean) => void;
    const reviewed = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          accept = resolve;
        }),
    );
    review.registerTransactionReviewHandler(reviewed);
    let releasePost!: () => void;
    const posted = new Promise<void>((resolve) => {
      releasePost = resolve;
    });
    const api = relayrApi();
    const progress = vi.fn();
    const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(progress).toHaveBeenCalledWith(
        expect.objectContaining({ type: "phase", phase: "quoting" }),
      );
      await posted;
      return api(input, init);
    });
    vi.stubGlobal("fetch", fetch);
    const { result } = renderHook(() => hooks.useGetRelayrTxQuote());
    await act(async () => {
      const quote = result.current.getRelayrTxQuote([safeExec(1)], { onProgress: progress });
      await vi.waitFor(() => expect(reviewed).toHaveBeenCalledOnce());
      expect(progress).not.toHaveBeenCalledWith(
        expect.objectContaining({ type: "phase", phase: "quoting" }),
      );
      expect(fetch).not.toHaveBeenCalled();
      accept(true);
      await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
      expect(progress).toHaveBeenCalledWith(
        expect.objectContaining({ type: "phase", phase: "quoting" }),
      );
      expect(mocks.sendTransaction).not.toHaveBeenCalled();
      releasePost();
      await quote;
    });
  });

  it("simulates exact Safe calldata from a neutral executor before publishing", async () => {
    const { hooks, review } = await freshHarness();
    review.registerTransactionReviewHandler(async () => true);
    vi.stubGlobal("fetch", relayrApi());
    const { result } = renderHook(() => hooks.useGetRelayrTxQuote());
    await act(async () => {
      await result.current.getRelayrTxQuote([safeExec(1)]);
    });
    expect(mocks.rawRequest).toHaveBeenCalledWith({
      method: "eth_call",
      params: [{ from: zeroAddress, to: SAFE, data: exec, value: "0x0", gas: "0x927c0" }, "latest"],
    });
  });

  it.each([false, "empty", "oversized"])(
    "refuses %s Safe execution simulation before publishing",
    async (response) => {
      const { hooks, review } = await freshHarness();
      const reviewed = vi.fn(async () => true);
      review.registerTransactionReviewHandler(reviewed);
      mocks.rawRequest.mockResolvedValue(
        response === false
          ? encodeFunctionResult({
              abi: SAFE_EXEC_ABI,
              functionName: "execTransaction",
              result: false,
            })
          : response === "empty"
            ? "0x"
            : `0x${"01".repeat(33)}`,
      );
      vi.stubGlobal("fetch", vi.fn());
      const { result } = renderHook(() => hooks.useGetRelayrTxQuote());
      await expect(result.current.getRelayrTxQuote([safeExec(1)])).rejects.toThrow();
      expect(reviewed).not.toHaveBeenCalled();
      expect(fetch).not.toHaveBeenCalled();
      expect(mocks.sendTransaction).not.toHaveBeenCalled();
    },
  );

  it("refuses a Safe execution that returns false when rechecked before payment", async () => {
    const { hooks, review } = await freshHarness();
    review.registerTransactionReviewHandler(async () => true);
    vi.stubGlobal("fetch", relayrApi());
    const quoter = renderHook(() => hooks.useGetRelayrTxQuote());
    await act(async () => {
      await quoter.result.current.getRelayrTxQuote([safeExec(1)]);
    });
    mocks.rawRequest.mockImplementation(async ({ params }: { params?: [{ data?: Hex }] }) =>
      params?.[0]?.data === exec
        ? encodeFunctionResult({
            abi: SAFE_EXEC_ABI,
            functionName: "execTransaction",
            result: false,
          })
        : "0x",
    );
    const payer = renderHook(() => hooks.useSendRelayrTx());
    await expect(payer.result.current.sendRelayrTx(payment())).rejects.toThrow(
      "The Safe execution simulation did not succeed.",
    );
    expect(mocks.sendTransaction).not.toHaveBeenCalled();
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
    const reads = (chainId: number, selector: Hex) =>
      mocks.clientCall.mock.calls.filter(
        ([read]) => read.chainId === chainId && read.data?.startsWith(selector),
      );
    for (const chainId of [1, 10]) {
      expect(reads(chainId, NONCE)).toHaveLength(1);
      expect(reads(chainId, TX_HASH)).toHaveLength(1);
    }
    const payer = renderHook(() => hooks.useSendRelayrTx());
    await act(async () => {
      await payer.result.current.sendRelayrTx(payment());
    });
    // Funding still runs a fresh validation after its own payment review.
    for (const chainId of [1, 10]) {
      expect(reads(chainId, NONCE)).toHaveLength(2);
      expect(reads(chainId, TX_HASH)).toHaveLength(2);
    }
    expect(mocks.sendTransaction).toHaveBeenCalledOnce();
  });

  it("reviews fresh Safe calldata after another owner signs and archives the old unfunded quote", async () => {
    const { hooks, review, activity } = await freshHarness();
    const reviews: TransactionReviewRequest[] = [];
    review.registerTransactionReviewHandler(async (request) => {
      reviews.push(request);
      return true;
    });
    const api = refreshingQuotes();
    vi.stubGlobal("fetch", api);
    const requests = [1, 10, 8453, 42161].map((chainId) => ({
      ...safeExec(chainId as 1),
      recoveryScope: `safe:${chainId}:7`,
    }));
    const quoter = renderHook(() => hooks.useGetRelayrTxQuote());
    await act(async () => {
      await quoter.result.current.getRelayrTxQuote(requests);
    });
    const original = activity.transactionActivitySnapshot()[0].relayrExpectedTransactions;
    const changed = requests.map((request, index) =>
      index
        ? request
        : {
            ...request,
            data: {
              ...request.data,
              gas: 300_000n,
              data: encodeFunctionData({
                abi: SAFE_EXEC_ABI,
                functionName: "execTransaction",
                args: [
                  TARGET,
                  0n,
                  "0x1234",
                  0,
                  0n,
                  0n,
                  0n,
                  zeroAddress,
                  zeroAddress,
                  `${SIGNATURE}${SIGNATURE.slice(2)}` as Hex,
                ],
              }),
            },
          },
    );
    await act(async () => {
      await expect(quoter.result.current.getRelayrTxQuote(changed)).resolves.toMatchObject({
        bundle_uuid: OTHER_BUNDLE_UUID,
      });
    });
    expect(api.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(2);
    expect(mocks.signTypedData).not.toHaveBeenCalled();
    expect(mocks.sendTransaction).not.toHaveBeenCalled();
    expect(
      activity.transactionActivitySnapshot().find((row) => row.bundleUuid === BUNDLE_UUID),
    ).toMatchObject({
      relayrExpectedTransactions: original,
      relayrSafeState: "released",
      relayrSafeReleaseReason: "quote-replaced",
    });
    expect(reviews.at(-1)).toMatchObject({
      title: "Review 4 Safe executions",
      calls: changed.map((request) => ({
        chainId: request.chainId,
        data: request.data.data,
        contractName: "Safe",
        functionName: "execTransaction",
        calls: [expect.objectContaining({ to: TARGET, data: "0x1234", value: 0n })],
      })),
    });
    expect(
      mocks.rawRequest.mock.calls.some(([call]) => call.params?.[0]?.data === changed[0].data.data),
    ).toBe(true);
  });

  it("replaces a legacy unfunded Safe quote after reload without a new wallet signature", async () => {
    const first = await freshHarness();
    first.review.registerTransactionReviewHandler(async () => true);
    const api = refreshingQuotes();
    vi.stubGlobal("fetch", api);
    const initial = renderHook(() => first.hooks.useGetRelayrTxQuote());
    await act(async () => {
      await initial.result.current.getRelayrTxQuote([safeExec(1), safeExec(10)]);
    });
    const saved = first.activity.transactionActivitySnapshot()[0];
    first.activity.updateTransactionActivity(saved.id, {
      relayrSafeSessionId: undefined,
      relayrSafeFundingUnknown: undefined,
    });
    initial.unmount();
    const restored = await freshHarness();
    restored.review.registerTransactionReviewHandler(async () => true);
    const resumed = renderHook(() => restored.hooks.useGetRelayrTxQuote());
    await act(async () => {
      await expect(
        resumed.result.current.getRelayrTxQuote([safeExec(10), safeExec(1)]),
      ).resolves.toMatchObject({ bundle_uuid: OTHER_BUNDLE_UUID });
    });
    expect(api.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(2);
    expect(
      restored.activity.transactionActivitySnapshot().find((row) => row.id === saved.id)
        ?.relayrExpectedTransactions,
    ).toEqual(saved.relayrExpectedTransactions);
    expect(mocks.sendTransaction).not.toHaveBeenCalled();
  });

  it("retains another account's unresolved Safe funding reservation", async () => {
    const { hooks, review, activity } = await freshHarness();
    review.registerTransactionReviewHandler(async () => true);
    const api = relayrApi();
    vi.stubGlobal("fetch", api);
    const initial = renderHook(() => hooks.useGetRelayrTxQuote());
    await act(async () => {
      await initial.result.current.getRelayrTxQuote([safeExec(1)]);
    });
    activity.updateTransactionActivity(`relayr:${BUNDLE_UUID}`, {
      relayrPaymentStatus: "submitted",
      relayrSafeFundingUnknown: true,
    });
    mocks.hookAddress = OTHER_ACCOUNT;
    mocks.account.address = OTHER_ACCOUNT;
    const other = renderHook(() => hooks.useGetRelayrTxQuote());
    const request = safeExec(1);
    await expect(
      other.result.current.getRelayrTxQuote([
        { ...request, data: { ...request.data, from: OTHER_ACCOUNT } },
      ]),
    ).rejects.toBeInstanceOf(hooks.RelayrRecoveryError);
    expect(api.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1);
    expect(mocks.sendTransaction).not.toHaveBeenCalled();
  });

  it("keeps a pre-publication cancellation released after persisting and reloading it", async () => {
    const first = await freshHarness();
    first.review.registerTransactionReviewHandler(async () => true);
    const api = relayrApi();
    vi.stubGlobal("fetch", api);
    const abort = new AbortController();
    const save = Storage.prototype.setItem;
    const persistence = vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (
      this: Storage,
      key: string,
      value: string,
    ) {
      save.call(this, key, value);
      if (
        key === "revnet:transaction-activities:v1" &&
        JSON.parse(value).some(
          (row: { relayrSafeState?: string }) => row.relayrSafeState === "publishing",
        )
      )
        abort.abort();
    });
    const initial = renderHook(() => first.hooks.useGetRelayrTxQuote());
    try {
      await act(async () => {
        await expect(
          initial.result.current.getRelayrTxQuote([safeExec(1)], { signal: abort.signal }),
        ).rejects.toThrow();
      });
    } finally {
      persistence.mockRestore();
    }
    const canceled = first.activity.transactionActivitySnapshot()[0];
    expect(canceled).toMatchObject({
      relayrSafeState: "released",
      relayrPaymentStatus: "unfunded",
      status: "failed",
    });
    expect(canceled.bundleUuid).toBeUndefined();
    expect(api).not.toHaveBeenCalled();
    initial.unmount();
    const restored = await freshHarness();
    restored.review.registerTransactionReviewHandler(async () => true);
    const resumed = renderHook(() => restored.hooks.useGetRelayrTxQuote());
    await act(async () => {
      await expect(resumed.result.current.getRelayrTxQuote([safeExec(1)])).resolves.toMatchObject({
        bundle_uuid: BUNDLE_UUID,
      });
    });
    expect(api.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1);
    expect(mocks.sendTransaction).not.toHaveBeenCalled();
  });

  it("replaces a lost four-call quote with the three current calls and funds the fresh bundle once", async () => {
    const { hooks, review, activity } = await freshHarness();
    const reviews: TransactionReviewRequest[] = [];
    review.registerTransactionReviewHandler(async (request) => {
      reviews.push(request);
      return true;
    });
    const lost = vi.fn(async () => {
      throw new Error("Quote response lost");
    });
    vi.stubGlobal("fetch", lost);
    const quoter = renderHook(() => hooks.useGetRelayrTxQuote());
    const previous = [1, 10, 8453, 42161].map((chainId) => safeExec(chainId as 1));
    const current = previous.slice(1);
    await act(async () => {
      await expect(quoter.result.current.getRelayrTxQuote(previous)).rejects.toThrow(
        /Quote response lost/,
      );
    });
    const saved = activity.transactionActivitySnapshot()[0];
    expect(saved).toMatchObject({
      relayrSafeState: "publishing",
      relayrPaymentStatus: "unfunded",
      status: "pending",
    });
    expect(saved.bundleUuid).toBeUndefined();
    const fresh = relayrApi();
    vi.stubGlobal("fetch", fresh);
    await act(async () => {
      await expect(quoter.result.current.getRelayrTxQuote(current)).resolves.toMatchObject({
        bundle_uuid: BUNDLE_UUID,
      });
    });
    expect(activity.transactionActivitySnapshot().find((row) => row.id === saved.id)).toMatchObject(
      {
        relayrSafeState: "released",
        relayrSafeReleaseReason: "quote-replaced",
        relayrPaymentStatus: "unfunded",
      },
    );
    expect(lost).toHaveBeenCalledOnce();
    const posts = fresh.mock.calls.filter(([, init]) => init?.method === "POST");
    expect(posts).toHaveLength(1);
    expect(
      JSON.parse(String(posts[0][1]?.body)).transactions.map((row: { chain: number }) => row.chain),
    ).toEqual([10, 8453, 42161]);
    expect(reviews.at(-1)).toMatchObject({
      title: "Review 3 Safe executions",
      calls: current.map((request) => ({ chainId: request.chainId, data: exec })),
    });
    expect(mocks.sendTransaction).not.toHaveBeenCalled();
    const payer = renderHook(() => hooks.useSendRelayrTx());
    await act(async () => {
      await payer.result.current.sendRelayrTx(payment());
    });
    expect(reviews.at(-1)).toMatchObject({
      kind: "transaction",
      title: "Review payment",
      confirmLabel: "Pay",
    });
    expect(mocks.sendTransaction).toHaveBeenCalledOnce();
  });

  it("checks a lost quote's finalized Safe nonce and preserves the obsolete release across reloads", async () => {
    const first = await freshHarness();
    first.review.registerTransactionReviewHandler(async () => true);
    const lost = vi.fn(async () => {
      throw new Error("Quote response lost");
    });
    vi.stubGlobal("fetch", lost);
    const quoter = renderHook(() => first.hooks.useGetRelayrTxQuote());
    await act(async () => {
      await expect(quoter.result.current.getRelayrTxQuote([safeExec(1)])).rejects.toThrow(
        /Quote response lost/,
      );
    });
    const saved = first.activity.transactionActivitySnapshot()[0];
    mocks.getBlock.mockResolvedValue({
      number: FINAL_BLOCK,
      hash: FINAL_HASH,
      timestamp: BigInt(NOW),
    });
    mocks.rawRequest.mockResolvedValue(encodeAbiParameters([{ type: "uint256" }], [7n]));
    const pending = await first.hooks.checkRelayrSession(saved.id);
    expect(pending).toMatchObject({
      state: "pending",
      recovery: {
        reason: "safe-nonces-live",
        checks: [{ chainId: 1, safe: SAFE, nonce: 7, currentNonce: "7", state: "live" }],
      },
    });
    expect(first.activity.transactionActivitySnapshot()[0].message).toBe(
      pending?.recovery?.message,
    );
    quoter.unmount();
    const restored = await freshHarness();
    mocks.rawRequest.mockResolvedValue(encodeAbiParameters([{ type: "uint256" }], [8n]));
    const released = await restored.hooks.checkRelayrSession(saved.id);
    expect(released).toMatchObject({
      state: "released",
      session: { releaseReason: "safe-nonces-consumed", paymentStatus: "unfunded" },
      recovery: { checks: [{ currentNonce: "8", state: "consumed" }] },
    });
    expect(restored.activity.transactionActivitySnapshot()[0]).toMatchObject({
      relayrSafeState: "released",
      relayrSafeReleaseReason: "safe-nonces-consumed",
      relayrPaymentStatus: "unfunded",
    });
    const again = await freshHarness();
    const adapter = await import("@/lib/safe-relayr");
    expect(
      adapter.safeRelayrSession(again.activity.transactionActivitySnapshot()[0]),
    ).toMatchObject({ state: "released", releaseReason: "safe-nonces-consumed" });
    expect(lost).toHaveBeenCalledOnce();
    expect(mocks.sendTransaction).not.toHaveBeenCalled();
  });

  it("keeps unknown funding reserved even if a lost quote's saved Safe nonce has advanced", async () => {
    const { hooks, review, activity } = await freshHarness();
    review.registerTransactionReviewHandler(async () => true);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("Quote response lost");
      }),
    );
    const quoter = renderHook(() => hooks.useGetRelayrTxQuote());
    await act(async () => {
      await expect(quoter.result.current.getRelayrTxQuote([safeExec(1)])).rejects.toThrow(
        /Quote response lost/,
      );
    });
    const saved = activity.transactionActivitySnapshot()[0];
    activity.updateTransactionActivity(saved.id, { hash: HASH });
    mocks.getBlock.mockResolvedValue({
      number: FINAL_BLOCK,
      hash: FINAL_HASH,
      timestamp: BigInt(NOW),
    });
    mocks.rawRequest.mockResolvedValue(encodeAbiParameters([{ type: "uint256" }], [8n]));
    const checked = await hooks.checkRelayrSession(saved.id);
    expect(checked).toMatchObject({ state: "pending", recovery: { reason: "funding-unresolved" } });
    expect(activity.transactionActivitySnapshot()[0].relayrSafeState).toBe("publishing");
    expect(activity.transactionActivitySnapshot()[0].hash).toBe(HASH);
    expect(mocks.sendTransaction).not.toHaveBeenCalled();
  });

  it("preserves malformed saved payment history and refuses nonce-based release", async () => {
    const { hooks, review, activity } = await freshHarness();
    review.registerTransactionReviewHandler(async () => true);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("Quote response lost");
      }),
    );
    const quoter = renderHook(() => hooks.useGetRelayrTxQuote());
    await act(async () => {
      await expect(quoter.result.current.getRelayrTxQuote([safeExec(1)])).rejects.toThrow(
        /Quote response lost/,
      );
    });
    const saved = activity.transactionActivitySnapshot()[0];
    const malformed = { hash: HASH } as unknown as NonNullable<typeof saved.relayrPayments>;
    activity.updateTransactionActivity(saved.id, { relayrPayments: malformed });
    mocks.getBlock.mockResolvedValue({
      number: FINAL_BLOCK,
      hash: FINAL_HASH,
      timestamp: BigInt(NOW),
    });
    mocks.rawRequest.mockResolvedValue(encodeAbiParameters([{ type: "uint256" }], [8n]));
    mocks.rawRequest.mockClear();
    await expect(hooks.checkRelayrSession(saved.id)).rejects.toThrow(/malformed recovery history/);
    expect(activity.transactionActivitySnapshot()[0]).toMatchObject({
      relayrSafeState: "publishing",
      relayrPayments: malformed,
    });
    expect(mocks.rawRequest).not.toHaveBeenCalled();
    expect(mocks.sendTransaction).not.toHaveBeenCalled();
  });

  it("aborts before publishing when the outer Safe review closes during its final checks", async () => {
    const { hooks, review } = await freshHarness();
    review.registerTransactionReviewHandler(async () => true);
    const api = relayrApi();
    vi.stubGlobal("fetch", api);
    const original = mocks.rawRequest.getMockImplementation()!;
    let release: (() => void) | undefined;
    mocks.rawRequest.mockImplementation(async (args) => {
      if (args.params?.[0]?.data === exec)
        await new Promise<void>((resolve) => {
          release = resolve;
        });
      return original(args);
    });
    const quoter = renderHook(() => hooks.useGetRelayrTxQuote());
    const abort = new AbortController();
    await act(async () => {
      const pending = quoter.result.current.getRelayrTxQuote([safeExec(1)], {
        signal: abort.signal,
      });
      const stopped = expect(pending).rejects.toThrow();
      await vi.waitFor(() => expect(release).toBeTypeOf("function"));
      abort.abort();
      release!();
      await stopped;
    });
    expect(api).not.toHaveBeenCalled();
    expect(mocks.sendTransaction).not.toHaveBeenCalled();
  });

  it("reviews three currently ready calls instead of an old four-call quote and funds only the new bundle once", async () => {
    const { hooks, review, activity } = await freshHarness();
    const reviews: TransactionReviewRequest[] = [];
    review.registerTransactionReviewHandler(async (request) => {
      reviews.push(request);
      return true;
    });
    const api = refreshingQuotes();
    vi.stubGlobal("fetch", api);
    const quoter = renderHook(() => hooks.useGetRelayrTxQuote());
    const previous = [1, 10, 8453, 42161].map((chainId) => safeExec(chainId as 1));
    const current = previous.slice(1);
    await act(async () => {
      await quoter.result.current.getRelayrTxQuote(previous);
    });
    await act(async () => {
      await expect(quoter.result.current.getRelayrTxQuote(current)).resolves.toMatchObject({
        bundle_uuid: OTHER_BUNDLE_UUID,
      });
    });
    const posts = api.mock.calls.filter(([, init]) => init?.method === "POST");
    expect(posts).toHaveLength(2);
    expect(
      JSON.parse(String(posts[1][1]?.body)).transactions.map((row: { chain: number }) => row.chain),
    ).toEqual([10, 8453, 42161]);
    expect(reviews.at(-1)).toMatchObject({
      title: "Review 3 Safe executions",
      calls: current.map((request) => ({ chainId: request.chainId, to: SAFE, data: exec })),
    });
    const archived = activity
      .transactionActivitySnapshot()
      .find((row) => row.bundleUuid === BUNDLE_UUID)!;
    expect(archived).toMatchObject({
      relayrSafeState: "released",
      relayrSafeReleaseReason: "quote-replaced",
      relayrPaymentStatus: "unfunded",
    });
    expect(archived.relayrExpectedTransactions).toHaveLength(4);
    expect(archived.message).toMatch(/unfunded quote was replaced/);
    expect(mocks.sendTransaction).not.toHaveBeenCalled();
    const currentPayment = payment({}, { bundleUuid: OTHER_BUNDLE_UUID });
    mocks.getTransaction.mockResolvedValue(onchain(PAYMENT_TARGET, currentPayment.calldata));
    mocks.getTransactionReceipt.mockResolvedValue(onchain(PAYMENT_TARGET, currentPayment.calldata));
    const payer = renderHook(() => hooks.useSendRelayrTx());
    await expect(payer.result.current.sendRelayrTx(payment())).rejects.toThrow();
    expect(mocks.sendTransaction).not.toHaveBeenCalled();
    await act(async () => {
      await payer.result.current.sendRelayrTx(currentPayment);
    });
    expect(mocks.sendTransaction).toHaveBeenCalledOnce();
    expect(mocks.sendTransaction).toHaveBeenCalledWith(
      expect.objectContaining({ data: currentPayment.calldata }),
    );
    expect(
      activity.transactionActivitySnapshot().find((row) => row.bundleUuid === BUNDLE_UUID)?.hash,
    ).toBeUndefined();
    expect(
      activity.transactionActivitySnapshot().find((row) => row.bundleUuid === OTHER_BUNDLE_UUID)
        ?.hash,
    ).toBe(HASH);
  });

  it("does not reuse a Safe quote when its expected nonce or transaction hash changed", async () => {
    const { hooks, review } = await freshHarness();
    review.registerTransactionReviewHandler(async () => true);
    vi.stubGlobal("fetch", relayrApi());
    const quoter = renderHook(() => hooks.useGetRelayrTxQuote());
    await act(async () => {
      await quoter.result.current.getRelayrTxQuote([safeExec(1)]);
    });
    for (const guard of [
      { ...safeExec(1).expectedSafeExecution, nonce: 8 },
      { ...safeExec(1).expectedSafeExecution, safeTxHash: HASH },
    ]) {
      await expect(
        quoter.result.current.getRelayrTxQuote([{ ...safeExec(1), expectedSafeExecution: guard }]),
      ).rejects.toThrow(/reviewed transaction hash/);
    }
  });

  it("checks a saved raw Safe quote without silently dropping its live reservation", async () => {
    const { hooks, review, activity } = await freshHarness();
    review.registerTransactionReviewHandler(async () => true);
    vi.stubGlobal("fetch", relayrApi());
    const quoter = renderHook(() => hooks.useGetRelayrTxQuote());
    await act(async () => {
      await quoter.result.current.getRelayrTxQuote([safeExec(1)]);
    });
    chainAt({ timestamp: NOW, finalizedNonce: 0n });
    await hooks.checkRelayrSession(`relayr:${BUNDLE_UUID}`);
    expect(activity.transactionActivitySnapshot()[0]).toMatchObject({
      relayrPaymentStatus: "unfunded",
      message: expect.stringMatching(/Safe execution quote is ready|unpaid and reserved/),
    });
    chainAt({ timestamp: NOW + 601, finalizedNonce: 0n });
    vi.setSystemTime(new Date((NOW + 601) * 1_000));
    await hooks.checkRelayrSession(`relayr:${BUNDLE_UUID}`);
    expect(activity.transactionActivitySnapshot()[0]).toMatchObject({
      relayrPaymentStatus: "expired",
      message: expect.stringMatching(/unpaid Relayr quote expired/),
    });
  });

  it("keeps a paid saved Safe quote in recovery when all signature payloads change", async () => {
    const { hooks, review, activity } = await freshHarness();
    review.registerTransactionReviewHandler(async () => true);
    const api = relayrApi();
    vi.stubGlobal("fetch", api);
    const quoter = renderHook(() => hooks.useGetRelayrTxQuote());
    await act(async () => {
      await quoter.result.current.getRelayrTxQuote([safeExec(1), safeExec(10)]);
    });
    activity.updateTransactionActivity(`relayr:${BUNDLE_UUID}`, {
      relayrPaymentStatus: "submitted",
      hash: HASH,
    });
    const data = encodeFunctionData({
      abi: SAFE_EXEC_ABI,
      functionName: "execTransaction",
      args: [
        TARGET,
        0n,
        "0x1234",
        0,
        0n,
        0n,
        0n,
        zeroAddress,
        zeroAddress,
        `${SIGNATURE}${SIGNATURE.slice(2)}` as Hex,
      ],
    });
    await expect(
      quoter.result.current.getRelayrTxQuote(
        [safeExec(1), safeExec(10)].map((request) => ({
          ...request,
          data: { ...request.data, data },
        })),
      ),
    ).rejects.toMatchObject({
      name: "RelayrRecoveryError",
      bundleUuid: BUNDLE_UUID,
      paymentStatus: "submitted",
    });
    expect(api.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1);
    expect(mocks.sendTransaction).not.toHaveBeenCalled();
  });

  it("does not release a canonically expired Safe quote funded on another device", async () => {
    const { hooks, review, activity } = await freshHarness();
    review.registerTransactionReviewHandler(async () => true);
    const bundle = { payment_received: false };
    vi.stubGlobal("fetch", relayrApi({ bundle }));
    const quoter = renderHook(() => hooks.useGetRelayrTxQuote());
    await act(async () => {
      await quoter.result.current.getRelayrTxQuote([safeExec(1)]);
    });
    bundle.payment_received = true;
    chainAt({ timestamp: NOW + 601, finalizedNonce: 0n });
    vi.setSystemTime(new Date((NOW + 601) * 1_000));
    const checked = await hooks.checkRelayrSession(`relayr:${BUNDLE_UUID}`);
    expect(checked).toMatchObject({ state: "pending", recovery: { reason: "funding-unresolved" } });
    expect(activity.transactionActivitySnapshot()[0]).toMatchObject({
      relayrPaymentStatus: "unfunded",
      relayrSafeFundingObserved: true,
      message: checked?.recovery?.message,
    });
    await expect(quoter.result.current.getRelayrTxQuote([safeExec(1)])).rejects.toBeInstanceOf(
      hooks.RelayrRecoveryError,
    );
    expect(mocks.sendTransaction).not.toHaveBeenCalled();
  });

  it("retains legacy remote activity across reloads even if a later Relayr response reports Pending", async () => {
    const first = await freshHarness();
    first.review.registerTransactionReviewHandler(async () => true);
    const api = relayrApi();
    vi.stubGlobal("fetch", api);
    const quoter = renderHook(() => first.hooks.useGetRelayrTxQuote());
    await act(async () => {
      await quoter.result.current.getRelayrTxQuote([safeExec(1), safeExec(10)]);
    });
    first.activity.updateTransactionActivity(`relayr:${BUNDLE_UUID}`, {
      chainStates: [{ chainId: 1, status: "Running" }],
    });
    await expect(quoter.result.current.getRelayrTxQuote([safeExec(1)])).rejects.toBeInstanceOf(
      first.hooks.RelayrRecoveryError,
    );
    expect(
      first.activity.transactionActivitySnapshot().find((row) => row.bundleUuid === BUNDLE_UUID)
        ?.relayrSafeFundingObserved,
    ).toBe(true);
    quoter.unmount();
    const reloaded = await freshHarness();
    reloaded.review.registerTransactionReviewHandler(async () => true);
    const retry = renderHook(() => reloaded.hooks.useGetRelayrTxQuote());
    await expect(retry.result.current.getRelayrTxQuote([safeExec(1)])).rejects.toBeInstanceOf(
      reloaded.hooks.RelayrRecoveryError,
    );
    expect(api.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1);
    expect(mocks.sendTransaction).not.toHaveBeenCalled();
  });

  it("keeps the old unfunded quote intact when the current selection's review is canceled", async () => {
    const { hooks, review, activity } = await freshHarness();
    review.registerTransactionReviewHandler(async () => true);
    const api = refreshingQuotes();
    vi.stubGlobal("fetch", api);
    const quoter = renderHook(() => hooks.useGetRelayrTxQuote());
    await act(async () => {
      await quoter.result.current.getRelayrTxQuote([safeExec(1), safeExec(10)]);
    });
    const saved = activity.transactionActivitySnapshot()[0];
    review.registerTransactionReviewHandler(async () => false);
    await expect(quoter.result.current.getRelayrTxQuote([safeExec(10)])).rejects.toThrow();
    expect(activity.transactionActivitySnapshot()).toEqual([saved]);
    expect(api.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1);
    expect(mocks.sendTransaction).not.toHaveBeenCalled();
  });

  it("holds a changed-signature subset of a legacy submitted Safe bundle", async () => {
    const { hooks, review, activity } = await freshHarness();
    review.registerTransactionReviewHandler(async () => true);
    const api = relayrApi();
    vi.stubGlobal("fetch", api);
    const quoter = renderHook(() => hooks.useGetRelayrTxQuote());
    await act(async () => {
      await quoter.result.current.getRelayrTxQuote([safeExec(1), safeExec(10)]);
    });
    const saved = activity.transactionActivitySnapshot()[0];
    // Older bundles have only byte-key reservations, not semantic Safe aliases.
    activity.updateTransactionActivity(saved.id, {
      relayrPaymentStatus: "submitted",
      relayrCallKeys: saved.relayrCallKeys?.filter((key) => !key.includes("safe-execution:")),
    });
    const data = encodeFunctionData({
      abi: SAFE_EXEC_ABI,
      functionName: "execTransaction",
      args: [
        TARGET,
        0n,
        "0x1234",
        0,
        0n,
        0n,
        0n,
        zeroAddress,
        zeroAddress,
        `${SIGNATURE}${SIGNATURE.slice(2)}` as Hex,
      ],
    });
    await expect(
      quoter.result.current.getRelayrTxQuote([
        { ...safeExec(1), data: { ...safeExec(1).data, data } },
      ]),
    ).rejects.toMatchObject({ name: "RelayrRecoveryError", activityId: saved.id });
    expect(api.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1);
    expect(mocks.sendTransaction).not.toHaveBeenCalled();
  });

  it("does not resume a quote while another historical bundle reserves the same Safe intent", async () => {
    const { hooks, review, activity } = await freshHarness();
    review.registerTransactionReviewHandler(async () => true);
    const api = relayrApi();
    vi.stubGlobal("fetch", api);
    const quoter = renderHook(() => hooks.useGetRelayrTxQuote());
    await act(async () => {
      await quoter.result.current.getRelayrTxQuote([safeExec(1), safeExec(10)]);
    });
    const saved = activity.transactionActivitySnapshot()[0];
    activity.recordTransactionActivity({
      ...saved,
      id: `relayr:${OTHER_BUNDLE_UUID}`,
      bundleUuid: OTHER_BUNDLE_UUID,
      relayrSafeSessionId: undefined,
      relayrQuote: undefined,
      callKey: "different-signatures",
      relayrCallKeys: [],
      relayrExpectedTransactions: saved.relayrExpectedTransactions!.slice(0, 1),
      relayrPaymentStatus: "submitted",
    });
    await expect(
      quoter.result.current.getRelayrTxQuote([safeExec(1), safeExec(10)]),
    ).rejects.toBeInstanceOf(hooks.RelayrRecoveryError);
    expect(api.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1);
    expect(mocks.sendTransaction).not.toHaveBeenCalled();
  });

  it("reserves a Safe nonce across competing transaction hashes but permits the next nonce", async () => {
    const { hooks, review, activity } = await freshHarness();
    review.registerTransactionReviewHandler(async () => true);
    const api = relayrApi();
    vi.stubGlobal("fetch", api);
    const quoter = renderHook(() => hooks.useGetRelayrTxQuote());
    await act(async () => {
      await quoter.result.current.getRelayrTxQuote([safeExec(1)]);
    });
    activity.updateTransactionActivity(`relayr:${BUNDLE_UUID}`, {
      relayrPaymentStatus: "submitted",
      relayrSafeFundingUnknown: true,
    });
    const data = encodeFunctionData({
      abi: SAFE_EXEC_ABI,
      functionName: "execTransaction",
      args: [TARGET, 0n, "0x5678", 0, 0n, 0n, 0n, zeroAddress, zeroAddress, SIGNATURE],
    });
    const alternative = {
      ...safeExec(1),
      data: { ...safeExec(1).data, data },
      expectedSafeExecution: {
        ...safeExec(1).expectedSafeExecution,
        safeTxHash: safeHash(1, 7, "0x5678"),
      },
    };
    await expect(quoter.result.current.getRelayrTxQuote([alternative])).rejects.toBeInstanceOf(
      hooks.RelayrRecoveryError,
    );
    expect(api.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1);
    liveNonce = 8n;
    await act(async () => {
      await expect(
        quoter.result.current.getRelayrTxQuote([
          {
            ...alternative,
            expectedSafeExecution: {
              ...safeExec(1).expectedSafeExecution,
              nonce: 8,
              safeTxHash: safeHash(1, 8, "0x5678"),
            },
          },
        ]),
      ).resolves.toMatchObject({ bundle_uuid: BUNDLE_UUID });
    });
    expect(api.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(2);
  });

  it("checks Safe chains concurrently before publishing and rechecks them before paying", async () => {
    const { hooks, review } = await freshHarness();
    review.registerTransactionReviewHandler(async () => true);
    vi.stubGlobal("fetch", relayrApi());
    const defaultCall = mocks.rawRequest.getMockImplementation()!;
    let releases: Array<() => void> = [];
    mocks.rawRequest.mockImplementation(async (args) => {
      if (args.params?.[0]?.data === exec)
        await new Promise<void>((resolve) => releases.push(resolve));
      return defaultCall(args);
    });
    const quoter = renderHook(() => hooks.useGetRelayrTxQuote());
    await act(async () => {
      const pending = quoter.result.current.getRelayrTxQuote([safeExec(1), safeExec(10)]);
      await vi.waitFor(() => expect(releases).toHaveLength(2));
      expect(fetch).not.toHaveBeenCalled();
      releases[1]();
      releases[0]();
      await pending;
    });
    const posted = JSON.parse((vi.mocked(fetch).mock.calls[0][1] as RequestInit).body as string);
    expect(posted.transactions.map((row: { chain: number }) => row.chain)).toEqual([1, 10]);
    releases = [];
    const payer = renderHook(() => hooks.useSendRelayrTx());
    await act(async () => {
      const pending = payer.result.current.sendRelayrTx(payment());
      await vi.waitFor(() => expect(releases).toHaveLength(2));
      expect(mocks.sendTransaction).not.toHaveBeenCalled();
      releases.forEach((release) => release());
      await pending;
    });
    expect(mocks.sendTransaction).toHaveBeenCalledTimes(1);
  });

  for (const stage of ["switch", "payment-submitting"] as const) {
    it.each(CONTEXT_CHANGES)(
      `retains the unpaid Safe quote after %s changes during ${stage}`,
      async (change) => {
        const { hooks, review, activity } = await freshHarness();
        const { setViewAs } = await import("@/lib/view-as");
        review.registerTransactionReviewHandler(async () => true);
        vi.stubGlobal("fetch", relayrApi());
        const quoter = renderHook(() => hooks.useGetRelayrTxQuote());
        await act(async () => {
          await quoter.result.current.getRelayrTxQuote([safeExec(1)]);
        });
        let release!: () => void;
        let entered = false;
        if (stage === "switch")
          mocks.switchChain.mockImplementation(
            () =>
              new Promise<void>((resolve) => {
                entered = true;
                release = resolve;
              }),
          );
        const payer = renderHook(() => hooks.useSendRelayrTx());
        await act(async () => {
          const pending = payer.result.current.sendRelayrTx(payment(), {
            onProgress: (event) => {
              if (stage === "payment-submitting" && event.type === "phase" && event.phase === stage)
                changeContext(change, setViewAs);
            },
          });
          const refused = expect(pending).rejects.toThrow();
          if (stage === "switch") {
            await vi.waitFor(() => expect(entered).toBe(true));
            changeContext(change, setViewAs);
            release();
          }
          await refused;
        });
        expect(mocks.sendTransaction).not.toHaveBeenCalled();
        expect(activity.transactionActivitySnapshot()[0]).toMatchObject({
          relayrPaymentStatus: "unfunded",
          relayrSafeFundingUnknown: false,
        });
        expect(activity.transactionActivitySnapshot()[0].hash).toBeUndefined();
      },
    );
  }

  it("authenticates and simulates the Safe funding payment before invoking the wallet", async () => {
    const { hooks, review } = await freshHarness();
    review.registerTransactionReviewHandler(async () => true);
    vi.stubGlobal("fetch", relayrApi());
    const quoter = renderHook(() => hooks.useGetRelayrTxQuote());
    await act(async () => {
      await quoter.result.current.getRelayrTxQuote([safeExec(1)]);
    });
    const payer = renderHook(() => hooks.useSendRelayrTx());
    mocks.getCode.mockResolvedValue("0x1234");
    await expect(payer.result.current.sendRelayrTx(payment())).rejects.toThrow(
      /code is not recognized/,
    );
    mocks.getCode.mockResolvedValue(PAYMENT_RUNTIME);
    mocks.rawRequest.mockResolvedValue("0x1234");
    await expect(payer.result.current.sendRelayrTx(payment())).rejects.toThrow(/unexpected result/);
    expect(mocks.sendTransaction).not.toHaveBeenCalled();
  });

  it.each([
    "expired before wallet",
    "wallet threw not-sent",
    "wallet threw not-sent with rejection cause",
  ])("retains correct Safe payment certainty: %s", async (failure) => {
    const invoked = failure !== "expired before wallet";
    const { hooks, review, activity } = await freshHarness();
    review.registerTransactionReviewHandler(async () => true);
    vi.stubGlobal("fetch", relayrApi());
    const quoter = renderHook(() => hooks.useGetRelayrTxQuote());
    await act(async () => {
      await quoter.result.current.getRelayrTxQuote([safeExec(1)]);
    });
    const payer = renderHook(() => hooks.useSendRelayrTx());
    if (invoked)
      mocks.sendTransaction.mockRejectedValue(
        new RelayrPaymentNotSentError(
          new Error(
            "wallet result lost",
            failure.endsWith("rejection cause") ? { cause: { code: 4001 } } : undefined,
          ),
        ),
      );
    await expect(
      payer.result.current.sendRelayrTx(payment(), {
        onProgress: (event) => {
          if (
            failure === "expired before wallet" &&
            event.type === "phase" &&
            event.phase === "payment-submitting"
          )
            vi.setSystemTime(new Date((NOW + 601) * 1_000));
        },
      }),
    ).rejects.toThrow();
    expect(mocks.sendTransaction).toHaveBeenCalledTimes(invoked ? 1 : 0);
    expect(activity.transactionActivitySnapshot()[0]).toMatchObject({
      relayrPaymentStatus: invoked ? "submitted" : "unfunded",
      relayrSafeFundingUnknown: invoked,
    });
  });

  it.each([false, true])(
    "tracks deferred Safe payment checks, wrapped funding and each verified chain (reopen recovery: %s)",
    async (reopenRecovery) => {
      const { hooks, review, activity } = await freshHarness();
      review.registerTransactionReviewHandler(async () => true);
      const ethereumHash = `0x${"11".repeat(32)}` as Hex;
      const optimismHash = `0x${"22".repeat(32)}` as Hex;
      let funded = false;
      let ethereumAvailable = false;
      const wrappedPayment = {
        ...onchain(TARGET, "0xdeadbeef", 0n),
        from: OTHER_ACCOUNT,
        logs: [
          {
            address: PAYMENT_TARGET,
            topics: [RELAYR_PAYMENT_EVENT, `0x${BUNDLE_UUID.replaceAll("-", "").padEnd(64, "0")}`],
            data: encodeAbiParameters([{ type: "uint256" }, { type: "uint40" }], [16n, NOW + 600]),
            transactionHash: HASH,
            blockHash: BLOCK_HASH,
            blockNumber: 123n,
          },
        ],
      };
      const landed = (hash: Hex) => {
        const chainId = hash === ethereumHash ? 1 : 10;
        return {
          ...onchain(SAFE, exec, 0n, chainId),
          hash,
          transactionHash: hash,
          logs: [
            {
              address: SAFE,
              topics: encodeEventTopics({
                abi: SAFE_EXEC_ABI,
                eventName: "ExecutionSuccess",
                args: { txHash: safeHash(chainId) },
              }),
              data: encodeAbiParameters([{ type: "uint256" }], [0n]),
            },
          ],
        };
      };
      mocks.getTransaction.mockImplementation(async ({ hash }: { hash: Hex }) => {
        if (hash === HASH) return wrappedPayment;
        if (hash === ethereumHash && !ethereumAvailable) return null;
        return landed(hash);
      });
      mocks.getTransactionReceipt.mockImplementation(async ({ hash }: { hash: Hex }) => {
        if (hash === HASH) return wrappedPayment;
        if (hash === ethereumHash && !ethereumAvailable) return null;
        return landed(hash);
      });
      let submitPayment!: () => void;
      mocks.sendTransaction.mockImplementation(
        () =>
          new Promise<Hex>((resolve) => {
            submitPayment = () => {
              funded = true;
              resolve(HASH);
            };
          }),
      );
      let confirmPayment!: () => void;
      mocks.waitForTransactionReceipt.mockImplementation(
        () =>
          new Promise((resolve) => {
            confirmPayment = () => resolve({ status: "success", transactionHash: HASH });
          }),
      );
      vi.stubGlobal(
        "fetch",
        relayrApi({
          records: (records) =>
            funded
              ? records.map((record) => ({
                  ...record,
                  status: {
                    state: "Success",
                    data: { hash: record.request.chain === 1 ? ethereumHash : optimismHash },
                  },
                }))
              : records,
        }),
      );
      const quoter = renderHook(() => hooks.useGetRelayrTxQuote());
      await act(async () => {
        await quoter.result.current.getRelayrTxQuote([safeExec(1), safeExec(10)]);
      });
      let acceptPaymentReview!: () => void;
      review.registerTransactionReviewHandler((request) => {
        expect(request).toMatchObject({ title: "Review payment", confirmLabel: "Pay" });
        return new Promise<boolean>((resolve) => {
          acceptPaymentReview = () => resolve(true);
        });
      });
      let authenticatePayment!: () => void;
      mocks.getCode.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            authenticatePayment = () => resolve(PAYMENT_RUNTIME);
          }),
      );
      const read = mocks.clientCall.getMockImplementation()!;
      const rechecks: Array<() => void> = [];
      mocks.clientCall.mockImplementation(async (args) => {
        if (args.data?.startsWith(NONCE))
          await new Promise<void>((resolve) => rechecks.push(resolve));
        return read(args);
      });
      const progress = vi.fn();
      const payer = renderHook(() => hooks.useSendRelayrTx());
      await act(async () => {
        const pending = payer.result.current.sendRelayrTx(payment(), { onProgress: progress });
        await vi.waitFor(() => expect(acceptPaymentReview).toBeTypeOf("function"));
        expect(progress).toHaveBeenLastCalledWith(
          expect.objectContaining({ phase: "payment-review" }),
        );
        expect(rechecks).toHaveLength(0);
        expect(mocks.sendTransaction).not.toHaveBeenCalled();
        acceptPaymentReview();
        await vi.waitFor(() => expect(authenticatePayment).toBeTypeOf("function"));
        expect(progress).toHaveBeenLastCalledWith(
          expect.objectContaining({ phase: "payment-review" }),
        );
        expect(rechecks).toHaveLength(0);
        authenticatePayment();
        await vi.waitFor(() => expect(rechecks).toHaveLength(2));
        expect(progress).toHaveBeenLastCalledWith(
          expect.objectContaining({ phase: "payment-checking" }),
        );
        expect(mocks.sendTransaction).not.toHaveBeenCalled();
        rechecks.forEach((resolve) => resolve());
        await vi.waitFor(() => expect(submitPayment).toBeTypeOf("function"));
        expect(progress).toHaveBeenLastCalledWith(
          expect.objectContaining({ phase: "payment-submitting" }),
        );
        submitPayment();
        await vi.waitFor(() => expect(confirmPayment).toBeTypeOf("function"));
        expect(progress).toHaveBeenLastCalledWith(
          expect.objectContaining({ phase: "payment-confirming" }),
        );
        expect(activity.transactionActivitySnapshot()[0]).toMatchObject({
          hash: HASH,
          relayrPaymentStatus: "submitted",
          relayrPayments: [expect.objectContaining({ hash: HASH })],
        });
        confirmPayment();
        await expect(pending).resolves.toBe(HASH);
      });
      expect(mocks.getCode).toHaveBeenCalledWith({ address: PAYMENT_TARGET, blockNumber: 123n });
      expect(activity.transactionActivitySnapshot()[0].relayrPaymentStatus).toBe("confirmed");
      expect(progress).toHaveBeenCalledWith(
        expect.objectContaining({ type: "phase", phase: "payment-confirming" }),
      );
      expect(progress).toHaveBeenCalledWith(
        expect.objectContaining({ type: "execution", status: "confirming", hash: ethereumHash }),
      );
      expect(progress).toHaveBeenCalledWith(
        expect.objectContaining({ type: "execution", status: "executed", hash: optimismHash }),
      );
      expect(progress).not.toHaveBeenCalledWith(
        expect.objectContaining({ type: "execution", status: "executed", hash: ethereumHash }),
      );
      expect(mocks.sendTransaction).toHaveBeenCalledOnce();
      if (reopenRecovery) {
        // Each listener represents a newly opened recovery dialog. The SDK may
        // suppress unchanged statuses, but both dialogs still need every row.
        for (let reopened = 0; reopened < 2; reopened += 1) {
          const recoveredProgress = vi.fn();
          await expect(
            hooks.checkRelayrSession(`relayr:${BUNDLE_UUID}`, recoveredProgress),
          ).resolves.toMatchObject({ state: "pending" });
          expect(recoveredProgress).toHaveBeenCalledWith(
            expect.objectContaining({
              type: "execution",
              status: "confirming",
              hash: ethereumHash,
            }),
          );
          expect(recoveredProgress).toHaveBeenCalledWith(
            expect.objectContaining({ type: "execution", status: "executed", hash: optimismHash }),
          );
          expect(recoveredProgress).not.toHaveBeenCalledWith(
            expect.objectContaining({
              type: "execution",
              status: "confirming",
              hash: optimismHash,
            }),
          );
        }
        expect(mocks.sendTransaction).toHaveBeenCalledOnce();
      }
      ethereumAvailable = true;
      progress.mockClear();
      await hooks.waitForRelayrBundle(BUNDLE_UUID, undefined, progress);
      expect(progress).toHaveBeenCalledWith(
        expect.objectContaining({ type: "execution", status: "executed", hash: ethereumHash }),
      );
      expect(progress).not.toHaveBeenCalledWith(
        expect.objectContaining({ type: "execution", status: "confirming", hash: optimismHash }),
      );
      expect(progress).toHaveBeenCalledWith(
        expect.objectContaining({ type: "phase", phase: "complete" }),
      );
      expect(mocks.sendTransaction).toHaveBeenCalledOnce();
    },
  );

  it("persists an uncertain Safe wallet invocation before returning its error", async () => {
    const { hooks, review, activity } = await freshHarness();
    review.registerTransactionReviewHandler(async () => true);
    vi.stubGlobal("fetch", relayrApi());
    const quoter = renderHook(() => hooks.useGetRelayrTxQuote());
    await act(async () => {
      await quoter.result.current.getRelayrTxQuote([safeExec(1)]);
    });
    mocks.sendTransaction.mockRejectedValue(new Error("Wallet connection lost"));
    const payer = renderHook(() => hooks.useSendRelayrTx());
    await expect(payer.result.current.sendRelayrTx(payment())).rejects.toBeInstanceOf(
      hooks.RelayrRecoveryError,
    );
    expect(activity.transactionActivitySnapshot()[0]).toMatchObject({
      relayrSafeFundingUnknown: true,
      relayrPaymentStatus: "submitted",
    });
    await expect(quoter.result.current.getRelayrTxQuote([safeExec(1)])).rejects.toBeInstanceOf(
      hooks.RelayrRecoveryError,
    );
    expect(mocks.sendTransaction).toHaveBeenCalledOnce();
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

  it.each(["nonce", "hash"] as const)(
    "reconstructs missing legacy guards and refuses %s drift after payment review",
    async (changed) => {
      const { hooks, review, activity } = await freshHarness();
      review.registerTransactionReviewHandler(async () => true);
      vi.stubGlobal("fetch", relayrApi());
      const quoter = renderHook(() => hooks.useGetRelayrTxQuote());
      await act(async () => {
        await quoter.result.current.getRelayrTxQuote([safeExec(1)]);
      });
      const saved = activity.transactionActivitySnapshot()[0];
      activity.updateTransactionActivity(saved.id, {
        relayrExpectedTransactions: saved.relayrExpectedTransactions!.map((row) => ({
          ...row,
          preconditions: undefined,
        })),
      });
      mocks.clientCall.mockClear();
      const paymentReview = vi.fn(async (request: TransactionReviewRequest) => {
        if (request.title === "Review payment") {
          mocks.clientCall.mockImplementation(async ({ data }) => ({
            data: data?.startsWith(NONCE)
              ? encodeAbiParameters([{ type: "uint256" }], [changed === "nonce" ? 8n : 7n])
              : zeroHash,
          }));
        }
        return true;
      });
      review.registerTransactionReviewHandler(paymentReview);
      const payer = renderHook(() => hooks.useSendRelayrTx());
      await expect(payer.result.current.sendRelayrTx(payment())).rejects.toThrow(
        /reviewed state changed/,
      );
      expect(paymentReview).toHaveBeenCalledWith(
        expect.objectContaining({ title: "Review payment", confirmLabel: "Pay" }),
      );
      expect(mocks.clientCall).toHaveBeenCalledTimes(changed === "nonce" ? 1 : 2);
      expect(mocks.sendTransaction).not.toHaveBeenCalled();
    },
  );

  it("rejects a Safe call that is not execTransaction, and mixed bundles", async () => {
    const { hooks, review } = await freshHarness();
    review.registerTransactionReviewHandler(async () => true);
    vi.stubGlobal("fetch", vi.fn());
    const { result } = renderHook(() => hooks.useGetRelayrTxQuote());
    await expect(
      result.current.getRelayrTxQuote([
        { ...safeExec(1), data: { ...safeExec(1).data, data: "0x1234" } },
      ]),
    ).rejects.toThrow(/not execTransaction|Encoded function signature/);
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

  it("never pays a quote again after sixteen payments, before it opens a review", async () => {
    const { activity, review, result } = await revertedPayment();
    const reviewed = vi.fn(async () => true);
    review.registerTransactionReviewHandler(reviewed);
    const hashes = Array.from(
      { length: 16 },
      (_, index) => `0x${(index + 1).toString(16).padStart(64, "0")}` as Hex,
    );
    activity.updateTransactionActivity(`relayr:${BUNDLE_UUID}`, {
      relayrPayments: hashes.map((hash) => ({
        hash,
        chainId: 1,
        target: PAYMENT_TARGET,
        data: payment().calldata,
        value: "16",
      })),
    });
    relayrReports();
    fundingChain(
      Object.fromEntries(hashes.map((hash) => [hash, "reverted"])) as Record<Hex, "reverted">,
    );
    await expect(result.current.sendRelayrTx(payment())).rejects.toThrow(
      "This quote was paid too many times to pay again. Keep it pending; do not pay again.",
    );
    expect(reviewed).not.toHaveBeenCalled();
    expect(mocks.sendTransaction).toHaveBeenCalledOnce();
  });

  it("does not pay again over a saved payment the SDK refuses to read", async () => {
    const { activity, result } = await revertedPayment();
    relayrReports();
    const [first] = activity.transactionActivitySnapshot()[0].relayrPayments!;
    // The SDK reads a saved amount in decimal only.
    activity.updateTransactionActivity(`relayr:${BUNDLE_UUID}`, {
      relayrPayments: [{ ...first, value: "0x10" }],
    });
    await expect(result.current.sendRelayrTx(payment())).rejects.toThrow(
      "Only an authenticated Relayr payment with its transaction hash can be verified.",
    );
    expect(mocks.sendTransaction).toHaveBeenCalledOnce();
  });

  it("does not pay again while the chain of a payment it sent has no RPC", async () => {
    const { activity, result } = await revertedPayment();
    relayrReports();
    const [first] = activity.transactionActivitySnapshot()[0].relayrPayments!;
    activity.updateTransactionActivity(`relayr:${BUNDLE_UUID}`, {
      relayrPayments: [
        { ...first, hash: SECOND_HASH, chainId: 10, data: payment({ chain: 10 }).calldata },
      ],
    });
    const client = mocks.getPublicClient();
    mocks.getPublicClient.mockImplementation(
      (_config: unknown, { chainId }: { chainId: number }) => (chainId === 10 ? undefined : client),
    );
    await expect(result.current.sendRelayrTx(payment())).rejects.toThrow(
      "No RPC is available for chain 10. Do not pay again yet; check it later.",
    );
    expect(mocks.sendTransaction).toHaveBeenCalledOnce();
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
      "This quote expired. Review the action again for a new quote.",
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

  /** An unpaid quote for `request`, signed at the forwarder nonce 4, with the options Relayr offers. */
  async function signedSession(
    request: ReviewedRelayrRequest = GUARDED,
    payments?: ChainPayment[],
  ) {
    const harness = await freshHarness();
    harness.review.registerTransactionReviewHandler(async () => true);
    guardReads(async () => ({ data: GUARD_VALUE }));
    vi.stubGlobal("fetch", relayrApi({ payments }));
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
    async function revertedPayment({
      open = false,
      payments,
    }: { open?: boolean; payments?: ChainPayment[] } = {}) {
      const harness = await signedSession(GUARDED, payments);
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
        "Another payment funded this quote. Check again once its calls have run; do not pay again.",
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
        "Another payment funded this quote. Check again once its calls have run; do not pay again.",
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

    it("waits for the deadline of every option of its quote, not only the one it paid", async () => {
      const later = payment({ chain: 10 }, { deadline: NOW + 1_800 });
      const { result } = await revertedPayment({ payments: [payment(), later] });
      // The paid option's deadline is final on both chains; the other option's is not.
      chainAt({ timestamp: NOW + 700, finalizedNonce: 4n });
      relayrReads();
      await expect(result.current.getRelayrTxQuote([GUARDED])).rejects.toThrow(
        /earlier signature can still run until/,
      );
      chainAt({ timestamp: NOW + 1_900, finalizedNonce: 4n });
      await act(async () => {
        await expect(result.current.getRelayrTxQuote([GUARDED])).resolves.toMatchObject({
          bundle_uuid: OTHER_BUNDLE_UUID,
        });
      });
      expect(mocks.signTypedData).toHaveBeenCalledOnce();
    });

    it("is released by the deadline its payment's calldata pays until, though its saved quote no longer lists the option it paid", async () => {
      const { activity, result, session } = await revertedPayment();
      activity.updateTransactionActivity(session()!.id, {
        relayrQuote: { bundle_uuid: BUNDLE_UUID, payment_info: [] },
      });
      chainAt({ timestamp: NOW + 700, finalizedNonce: 4n });
      relayrReads();
      await act(async () => {
        await expect(result.current.getRelayrTxQuote([GUARDED])).resolves.toMatchObject({
          bundle_uuid: OTHER_BUNDLE_UUID,
        });
      });
      expect(mocks.signTypedData).toHaveBeenCalledOnce();
      expect(session()).toMatchObject({ relayrPaymentStatus: "expired" });
    });

    it("is never paid again with another option while its saved quote no longer lists the one it paid", async () => {
      const { activity, result, session } = await revertedPayment({ open: true });
      activity.updateTransactionActivity(session()!.id, {
        relayrQuote: { bundle_uuid: BUNDLE_UUID, payment_info: [payment({ chain: 10 })] },
      });
      relayrReads();
      await expect(result.current.getRelayrTxQuote([GUARDED])).rejects.toThrow(
        "This Relayr quote cannot be paid again from its saved record. Keep it pending; do not pay again.",
      );
      expect(mocks.signTypedData).toHaveBeenCalledOnce();
      expect(mocks.sendTransaction).toHaveBeenCalledOnce();
    });

    it("never pays again when Relayr reports a payment without listing its calls", async () => {
      const { hooks, result } = await revertedPayment({ open: true });
      // Without a list of calls the read names no funding, so the quote is payable; the
      // payment's own retry check reads Relayr again and refuses it.
      relayrReads({ payment_received: true, transactions: null });
      await act(async () => {
        await expect(result.current.getRelayrTxQuote([GUARDED])).resolves.toMatchObject({
          bundle_uuid: BUNDLE_UUID,
        });
      });
      const payer = renderHook(() => hooks.useSendRelayrTx());
      await expect(payer.result.current.sendRelayrTx(payment())).rejects.toThrow(
        "Relayr already reports a payment for this bundle. Do not pay again.",
      );
      expect(mocks.sendTransaction).toHaveBeenCalledOnce();
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

  describe("a Discard and the batch rounds that hold its session", () => {
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
    const batchOf = (id: string, round: { state: "quoted" | "pending"; bundleUuid?: string }) => ({
      id,
      scope: "payouts",
      label: "Send payouts",
      account: ACCOUNT,
      key: "0x",
      route: "relayr" as const,
      calls: [call],
      rounds: [{ indices: [0], ...round }],
      status: "pending" as const,
      createdAt: NOW,
    });

    it("never lets the Discard of a replaced session reset the round that pays its replacement", async () => {
      const { activity, hooks, review } = await freshHarness();
      review.registerTransactionReviewHandler(async () => true);
      guardReads(async () => ({ data: GUARD_VALUE }));
      const batches = await import("@/lib/multichain-batch");
      const request = {
        ...GUARDED,
        recoveryScope: batches.batchCallScope(
          batchOf("multichain:batch", { state: "quoted" }),
          call,
          0,
        ),
      };
      // The round's calls are signed at nonce 4 and quoted.
      vi.stubGlobal("fetch", relayrApi());
      const quoter = renderHook(() => hooks.useGetRelayrTxQuote());
      await act(async () => {
        await quoter.result.current.getRelayrTxQuote([request]);
      });
      batches.saveMultichainBatch(
        batchOf("multichain:batch", { state: "quoted", bundleUuid: BUNDLE_UUID }),
      );
      const old = () =>
        activity.transactionActivitySnapshot().find((row) => row.bundleUuid === BUNDLE_UUID)!;
      // Every request is dead and unused: the account view marks the session for Discard.
      vi.setSystemTime(new Date(PAST_DEADLINE * 1_000));
      chainAt({ timestamp: PAST_DEADLINE, finalizedNonce: 4n });
      await hooks.checkRelayrSession(old().id);
      expect(old()).toMatchObject({ relayrDiscardable: "expired" });
      // The batch reopens: the same calls are signed again at nonce 4, and the round
      // pays the new bundle.
      vi.stubGlobal("fetch", nextQuote());
      await act(async () => {
        await quoter.result.current.getRelayrTxQuote([request]);
      });
      expect(mocks.signTypedData.mock.calls.map(([signed]) => signed.message.nonce)).toEqual([
        4n,
        4n,
      ]);
      batches.saveMultichainBatch(
        batchOf("multichain:batch", { state: "pending", bundleUuid: OTHER_BUNDLE_UUID }),
      );
      // The replaced session has nothing left to discard.
      expect(old()).toMatchObject({ relayrPaymentStatus: "expired" });
      expect(old().relayrDiscardable).toBeUndefined();
      expect(() => hooks.discardRelayrSession(old().id)).toThrow(/can no longer run/);
      // The round still waits on the new bundle, so a resume proves it and never
      // signs the same calls a third time.
      expect(batches.readMultichainBatches()[0].rounds[0]).toMatchObject({
        state: "pending",
        bundleUuid: OTHER_BUNDLE_UUID,
      });
    });

    it("abandons only the round of a discarded session's own bundle, never another pending batch in its scope", async () => {
      const { activity, hooks, review } = await freshHarness();
      review.registerTransactionReviewHandler(async () => true);
      guardReads(async () => ({ data: GUARD_VALUE }));
      const batches = await import("@/lib/multichain-batch");
      const other = batchOf("multichain:other", { state: "quoted", bundleUuid: OTHER_BUNDLE_UUID });
      vi.stubGlobal("fetch", relayrApi());
      const quoter = renderHook(() => hooks.useGetRelayrTxQuote());
      await act(async () => {
        await quoter.result.current.getRelayrTxQuote([
          { ...GUARDED, recoveryScope: batches.batchCallScope(other, call, 0) },
        ]);
      });
      batches.saveMultichainBatch(other);
      const session = () =>
        activity.transactionActivitySnapshot().find((row) => row.bundleUuid === BUNDLE_UUID)!;
      vi.setSystemTime(new Date(PAST_DEADLINE * 1_000));
      chainAt({ timestamp: PAST_DEADLINE, finalizedNonce: 5n });
      await hooks.checkRelayrSession(session().id);
      expect(session()).toMatchObject({ relayrDiscardable: "ran" });
      hooks.discardRelayrSession(session().id);
      expect(batches.findPendingBatch(ACCOUNT, "payouts")).toMatchObject({
        id: "multichain:other",
        rounds: [{ state: "quoted", bundleUuid: OTHER_BUNDLE_UUID }],
      });
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

  it("clears the Discard mark of a paid bundle that a later check proves ran", async () => {
    const { activity, hooks, session } = await signedSession();
    const id = session()!.id;
    const [signed] = session()!.relayrExpectedTransactions!;
    activity.updateTransactionActivity(id, {
      status: "failed",
      relayrPaymentStatus: "confirmed",
      hash: HASH,
      chainId: 1,
      relayrPayment: { target: PAYMENT_TARGET, data: payment().calldata, value: "16" },
      manualVerificationRequired: true,
      relayrDiscardable: "ran",
    });
    const DESTINATION = `0x${"de".repeat(32)}` as Hex;
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
      hash === DESTINATION ? destination : onchain(PAYMENT_TARGET, payment().calldata),
    );
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
                  status: { state: "Success", data: { hash: DESTINATION } },
                },
              ],
            }),
            { status: 200 },
          ),
      ),
    );
    await expect(hooks.waitForRelayrBundle(BUNDLE_UUID)).resolves.toBeTruthy();
    expect(session()).toMatchObject({ status: "success", manualVerificationRequired: false });
    expect(session()?.relayrDiscardable).toBeUndefined();
  });
});
