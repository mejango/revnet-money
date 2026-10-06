import { SafeQueueCard } from "@/app/[slug]/components/v6/operator/SafeQueueCard";
import { recordTransactionActivity } from "@/lib/transaction-activity";
import { safeProposalFor, type SafeQueuedTransaction } from "@bananapus/nana-sdk-core/safe-service";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { zeroAddress, type Address, type Hex } from "viem";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  executionLog,
  provenSafe,
  queuedRow,
  SAFE_OWNER_A,
  safeChain,
  safeTransactionService,
} from "./fixtures/safe-chain";
import { expectEveryWayOutRefused } from "./support/confirm";

// wallet-action:safe-queue

const SAFE = provenSafe();
const [, COSIGNER] = SAFE.owners as [Address, Address];
const TARGET = "0x4444444444444444444444444444444444444444" as Address;
const EXECUTION = `0x${"ef".repeat(32)}` as Hex;
const signature = (owner: Address) => `0x${owner.slice(2).padStart(128, "1")}1b` as Hex;

const mocks = vi.hoisted(() => ({
  address: undefined as string | undefined,
  client: undefined as unknown,
  /** The live operator check, the first read after each Confirm. */
  live: vi.fn(),
  sign: vi.fn(),
  review: vi.fn(),
  write: vi.fn(),
  receipt: vi.fn(),
  quote: vi.fn(),
  pay: vi.fn(),
  bundle: vi.fn(),
}));

vi.mock("wagmi", () => ({
  useAccount: () => ({ address: mocks.address, chainId: 8453 }),
  useConfig: () => ({}),
}));
vi.mock("@/lib/wagmiConfig", () => ({ wagmiConfig: {} }));
vi.mock("@/components/EthereumAddress", () => ({
  EthereumAddress: ({ address }: { address: string }) => <span>{address}</span>,
}));
vi.mock("@/app/[slug]/components/v6/operator/useLiveRevnetOperators", () => ({
  useLiveRevnetOperators: (rows: { chainId: number }[]) => ({
    operatorByChain: new Map(rows.map((row) => [row.chainId, SAFE.address])),
    isLoading: false,
  }),
}));
vi.mock("@/app/[slug]/components/v6/operator/operatorLib", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/app/[slug]/components/v6/operator/operatorLib")>()),
  isLiveRevnetOperator: mocks.live,
  publicClientFor: () => mocks.client,
}));
vi.mock("@/hooks/useReviewedSafeSignature", () => ({
  useReviewedSafeSignature: () => ({ signSafeTransactionAsync: mocks.sign }),
}));
vi.mock("@/hooks/useReviewedWriteContract", () => ({
  requireOnchainExecution: vi.fn(),
  useSafeConnection: () => false,
  useWriteContract: () => ({ writeContractAsync: mocks.write }),
}));
vi.mock("@/hooks/useReviewedRelayr", () => ({
  useGetRelayrTxQuote: () => ({ getRelayrTxQuote: mocks.quote, reset: vi.fn() }),
  useSendRelayrTx: () => ({ sendRelayrTx: mocks.pay }),
  waitForRelayrBundle: mocks.bundle,
}));
vi.mock("@/lib/transaction-review", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/transaction-review")>()),
  requireTransactionReview: mocks.review,
  chooseRelayrPayment: async (payments: unknown[]) => payments[0],
}));
vi.mock("@/lib/waitForReceipt", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/waitForReceipt")>()),
  waitForReceiptWithRetry: mocks.receipt,
}));

/** `chainId`'s queued call at the Safe's nonce 5, confirmed by `signers`. */
function queued(chainId: number, signers: Address[]): SafeQueuedTransaction {
  return queuedRow(
    chainId,
    SAFE.address,
    safeProposalFor({ to: TARGET, data: "0x1234" }, 5),
    signers.map((owner) => ({ owner, signature: signature(owner) })),
  );
}

/** Safe's transaction service on Base (and on Optimism when given) lists these rows. */
function serveQueues(base: SafeQueuedTransaction, optimism?: SafeQueuedTransaction) {
  const onBase = safeTransactionService("base", SAFE.address, [base]);
  const onOptimism = safeTransactionService("oeth", SAFE.address, optimism ? [optimism] : []);
  vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) =>
    String(input).includes("/tx-service/oeth/")
      ? onOptimism.fetch(input, init)
      : onBase.fetch(input, init),
  );
  return onBase;
}

function renderCard(...chainIds: (8453 | 10)[]) {
  const rows = chainIds.map((chainId) => ({ chainId, projectId: 4 }));
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <SafeQueueCard rows={rows} fallbackProject={rows[0]!} />
    </QueryClientProvider>,
  );
}

/** Holds the next live operator check, the first read each send makes after Confirm. */
function holdLiveRead() {
  let answer!: () => void;
  mocks.live.mockReturnValue(new Promise<boolean>((resolve) => (answer = () => resolve(true))));
  return () => act(async () => answer());
}

beforeEach(() => {
  window.localStorage.clear();
  mocks.address = SAFE_OWNER_A;
  mocks.client = {
    ...(safeChain(SAFE.address, { nonce: 5n }).client as object),
    estimateGas: async () => 100_000n,
  };
  mocks.live.mockReset().mockResolvedValue(true);
  mocks.sign.mockReset().mockResolvedValue(`0x${"9".repeat(130)}`);
  mocks.review.mockReset().mockResolvedValue(undefined);
  mocks.write.mockReset().mockImplementation(async () => {
    // As the reviewed write does when the caller keeps the receipt.
    recordTransactionActivity({
      id: `tx:8453:${EXECUTION}`,
      kind: "direct",
      title: "execTransaction",
      status: "pending",
      message: "Pending action-specific receipt verification.",
      chainId: 8453,
      hash: EXECUTION,
      manualVerificationRequired: true,
    });
    return EXECUTION;
  });
  mocks.receipt.mockReset();
  mocks.quote.mockReset().mockResolvedValue({
    bundle_uuid: "bundle-1",
    payment_info: [{ chain: 8453, amount: "1000", token: zeroAddress }],
  });
  mocks.pay.mockReset().mockResolvedValue(EXECUTION);
  mocks.bundle.mockReset().mockResolvedValue(undefined);
});

describe("the Safe queue's signature confirm", () => {
  async function openSign() {
    const service = serveQueues(queued(8453, [COSIGNER]));
    renderCard(8453);
    fireEvent.click(await screen.findByRole("button", { name: "Sign" }));
    const confirm = await screen.findByRole("dialog", { name: "Confirm signature" });
    return { confirm, service };
  }

  it("goes back with Cancel, and signs nothing", async () => {
    const { confirm } = await openSign();

    fireEvent.click(within(confirm).getByRole("button", { name: "Cancel" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(mocks.sign).not.toHaveBeenCalled();
  });

  it("refuses every way out from Confirm through the reads before the wallet prompt, then closes once signed", async () => {
    const { confirm, service } = await openSign();
    const release = holdLiveRead();
    fireEvent.click(within(confirm).getByRole("button", { name: "Sign" }));
    await waitFor(() =>
      expect(within(confirm).getByRole("button", { name: "Cancel" })).toBeDisabled(),
    );

    expectEveryWayOutRefused(confirm);
    expect(mocks.sign).not.toHaveBeenCalled();

    await release();
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(mocks.sign).toHaveBeenCalledOnce();
    expect(service.posts).toHaveLength(1);
    expect(screen.getByText("Signed Safe transaction #5 on Base.")).toBeInTheDocument();
  });
});

describe("the Safe queue's execution confirm", () => {
  async function openExecute() {
    const row = queued(8453, SAFE.owners);
    serveQueues(row);
    mocks.receipt.mockResolvedValue({
      status: "success",
      transactionHash: EXECUTION,
      blockNumber: 1n,
      logs: [executionLog(SAFE.address, row.safeTxHash!)],
    });
    renderCard(8453);
    fireEvent.click(await screen.findByRole("button", { name: "Execute" }));
    return screen.findByRole("dialog", { name: "Confirm execution" });
  }

  it("waits for a wallet before it opens", async () => {
    mocks.address = undefined;
    serveQueues(queued(8453, SAFE.owners));
    renderCard(8453);

    expect(await screen.findByRole("button", { name: "Execute" })).toBeDisabled();
  });

  it("goes back with Cancel, and executes nothing", async () => {
    const confirm = await openExecute();

    fireEvent.click(within(confirm).getByRole("button", { name: "Cancel" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(mocks.review).not.toHaveBeenCalled();
    expect(mocks.write).not.toHaveBeenCalled();
  });

  it("refuses every way out from Confirm through the reads before the wallet prompt, then closes once executed", async () => {
    const confirm = await openExecute();
    const release = holdLiveRead();
    fireEvent.click(within(confirm).getByRole("button", { name: "Execute" }));
    await waitFor(() =>
      expect(within(confirm).getByRole("button", { name: "Cancel" })).toBeDisabled(),
    );

    expectEveryWayOutRefused(confirm);
    expect(mocks.write).not.toHaveBeenCalled();

    await release();
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(mocks.write).toHaveBeenCalledOnce();
    expect(mocks.write.mock.calls[0][0]).toMatchObject({
      chainId: 8453,
      address: SAFE.address,
      functionName: "execTransaction",
    });
    expect(screen.getByText("Executed Safe transaction #5 on Base.")).toBeInTheDocument();
  });
});

describe("the Safe queue's execute-all confirm", () => {
  async function openBatch() {
    serveQueues(queued(8453, SAFE.owners), queued(10, SAFE.owners));
    renderCard(8453, 10);
    fireEvent.click(await screen.findByRole("button", { name: "Execute 2 ready" }));
    return screen.findByRole("dialog", { name: "Execute 2 Safe transactions" });
  }

  it("goes back with Cancel, and pays nothing", async () => {
    const confirm = await openBatch();

    fireEvent.click(within(confirm).getByRole("button", { name: "Cancel" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(mocks.quote).not.toHaveBeenCalled();
    expect(mocks.pay).not.toHaveBeenCalled();
  });

  it("refuses every way out from Confirm through the checks and the payment, then ends on Done", async () => {
    const confirm = await openBatch();
    const release = holdLiveRead();
    fireEvent.click(within(confirm).getByRole("button", { name: "Pay once and execute 2" }));
    await waitFor(() =>
      expect(within(confirm).getByRole("button", { name: "Cancel" })).toBeDisabled(),
    );

    expectEveryWayOutRefused(confirm);
    expect(mocks.pay).not.toHaveBeenCalled();

    await release();
    const done = await within(confirm).findByRole("button", { name: "Done" });
    expect(confirm).toHaveTextContent("Executed 2 Safe transactions.");
    // Nothing is left to send from here: Done stands alone.
    expect(within(confirm).queryByRole("button", { name: "Cancel" })).toBeNull();
    expect(within(confirm).queryByRole("button", { name: /Pay once/ })).toBeNull();
    expect(mocks.pay).toHaveBeenCalledOnce();

    fireEvent.click(done);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });
});
