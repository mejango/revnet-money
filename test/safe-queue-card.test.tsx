import { SafeQueueCard } from "@/app/[slug]/components/v6/operator/SafeQueueCard";
import { recordTransactionActivity, transactionActivityForHash } from "@/lib/transaction-activity";
import { safeProposalFor, type SafeQueuedTransaction } from "@bananapus/nana-sdk-core/safe-service";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import type { Address, Hex } from "viem";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  executionLog,
  provenSafe,
  queuedRow,
  SAFE_OWNER_A,
  safeChain,
  safeTransactionService,
} from "./fixtures/safe-chain";

// wallet-action:safe-queue

const SAFE = provenSafe();
const OWNERS = SAFE.owners;
const TARGET = "0x4444444444444444444444444444444444444444" as Address;
const EXECUTION = `0x${"ef".repeat(32)}` as Hex;
const signature = (owner: Address) => `0x${owner.slice(2).padStart(128, "1")}1b` as Hex;

const mocks = vi.hoisted(() => ({
  client: undefined as unknown,
  write: vi.fn(),
  writeOptions: undefined as undefined | { manualReceiptVerification?: () => boolean },
  receipt: vi.fn(),
  review: vi.fn(),
}));

vi.mock("wagmi", () => ({
  useAccount: () => ({ address: "0x2222222222222222222222222222222222222222", chainId: 8453 }),
  useConfig: () => ({}),
}));
vi.mock("@/lib/wagmiConfig", () => ({ wagmiConfig: {} }));
vi.mock("@/app/[slug]/components/v6/operator/operatorLib", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/app/[slug]/components/v6/operator/operatorLib")>()),
  publicClientFor: () => mocks.client,
  isLiveRevnetOperator: async () => true,
}));
vi.mock("@/app/[slug]/components/v6/operator/useLiveRevnetOperators", () => ({
  useLiveRevnetOperators: (rows: { chainId: number }[]) => ({
    operatorByChain: new Map(rows.map((row) => [row.chainId, SAFE.address])),
    isLoading: false,
  }),
}));
vi.mock("@/hooks/useReviewedWriteContract", () => ({
  requireOnchainExecution: vi.fn(),
  useSafeConnection: () => false,
  useWriteContract: (options: typeof mocks.writeOptions) => {
    mocks.writeOptions = options;
    return { writeContractAsync: mocks.write };
  },
}));
vi.mock("@/hooks/useReviewedRelayr", () => ({
  useGetRelayrTxQuote: () => ({ getRelayrTxQuote: vi.fn(), reset: vi.fn() }),
  useSendRelayrTx: () => ({ sendRelayrTx: vi.fn() }),
  waitForRelayrBundle: vi.fn(),
}));
vi.mock("@/hooks/useReviewedSafeSignature", () => ({
  useReviewedSafeSignature: () => ({ signSafeTransactionAsync: vi.fn() }),
}));
vi.mock("@/lib/transaction-review", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/transaction-review")>()),
  requireTransactionReview: mocks.review,
}));
vi.mock("@/lib/waitForReceipt", () => ({ waitForReceiptWithRetry: mocks.receipt }));
vi.mock("@/components/EthereumAddress", () => ({
  EthereumAddress: ({ address }: { address: string }) => <span>{address}</span>,
}));
vi.mock("@/components/ui/TxConfirmDialog", () => ({
  SummaryRow: ({ label, children }: { label: string; children: ReactNode }) => (
    <p>
      {label}: {children}
    </p>
  ),
  TxConfirmDialog: ({
    open,
    onConfirm,
    action,
    children,
    error,
  }: {
    open: boolean;
    onConfirm: () => void;
    action: string;
    children: ReactNode;
    error?: string | null;
  }) =>
    open ? (
      <div role="dialog">
        {children}
        {error ? <p role="alert">{error}</p> : null}
        <button onClick={onConfirm}>{action}</button>
      </div>
    ) : null,
}));

function renderCard(chainId: 8453 | 11155420) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <SafeQueueCard
        rows={[{ chainId, projectId: 42 }]}
        fallbackProject={{ chainId, projectId: 42 }}
      />
    </QueryClientProvider>,
  );
}

/** Base's queue holds `tx` at the Safe's nonce, confirmed by both current owners. */
function baseQueue(tx: SafeQueuedTransaction) {
  const row = queuedRow(
    8453,
    SAFE.address,
    tx,
    OWNERS.map((owner) => ({ owner, signature: signature(owner) })),
  );
  const service = safeTransactionService("base", SAFE.address, [row]);
  vi.stubGlobal("fetch", service.fetch);
  return row;
}

beforeEach(() => {
  window.localStorage.clear();
  mocks.client = safeChain(SAFE.address, { nonce: 5n }).client;
  mocks.writeOptions = undefined;
  mocks.review.mockResolvedValue(undefined);
  mocks.write.mockImplementation(async () => {
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
});

describe("Safe queue card", () => {
  it("states in one line, and asks no service, where Safe hosts no transaction service", async () => {
    const service = vi.fn();
    vi.stubGlobal("fetch", service);
    renderCard(11155420);

    expect(
      await screen.findByText("Safe queue isn't available on Optimism Sepolia.", { exact: true }),
    ).toBeVisible();
    expect(screen.queryByText(/No pending transactions/)).toBeNull();
    expect(service).not.toHaveBeenCalled();
  });

  it("refuses a queued transaction that pays a gas refund", async () => {
    baseQueue({ ...safeProposalFor({ to: TARGET, data: "0x1234" }, 5), gasPrice: "1" });
    renderCard(8453);

    expect(
      await screen.findByText("This transaction pays a gas refund, so it can't be executed here."),
    ).toBeVisible();
    expect(screen.queryByRole("button", { name: "Execute" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Sign" })).toBeNull();
  });

  it("counts only the current owners' confirmations", async () => {
    const row = queuedRow(8453, SAFE.address, safeProposalFor({ to: TARGET, data: "0x1234" }, 5), [
      { owner: SAFE_OWNER_A, signature: signature(SAFE_OWNER_A) },
      { owner: TARGET, signature: signature(TARGET) },
    ]);
    vi.stubGlobal("fetch", safeTransactionService("base", SAFE.address, [row]).fetch);
    renderCard(8453);

    expect(await screen.findByText(/1\/2 signatures/)).toBeVisible();
    expect(screen.queryByRole("button", { name: "Execute" })).toBeNull();
  });

  describe("executing a queued transaction from an owner's wallet", () => {
    async function execute(
      logs: ReturnType<typeof executionLog>[] | ((safeTxHash: Hex) => object),
    ) {
      const row = baseQueue(safeProposalFor({ to: TARGET, data: "0x1234" }, 5));
      mocks.receipt.mockResolvedValue(
        typeof logs === "function"
          ? logs(row.safeTxHash!)
          : { status: "success", transactionHash: EXECUTION, blockNumber: 1n, logs },
      );
      renderCard(8453);
      fireEvent.click(await screen.findByRole("button", { name: "Execute" }));
      const dialog = await screen.findByRole("dialog");
      fireEvent.click(within(dialog).getByRole("button", { name: "Execute" }));
      await waitFor(() => expect(mocks.receipt).toHaveBeenCalled());
      return row.safeTxHash!;
    }

    it("leaves the card, not the outer receipt, to confirm it", async () => {
      await execute([]);
      expect(mocks.writeOptions?.manualReceiptVerification?.()).toBe(true);
    });

    it("is not confirmed when the receipt has no ExecutionSuccess for its hash", async () => {
      const otherHash = `0x${"12".repeat(32)}` as Hex;
      await execute([executionLog(SAFE.address, otherHash)]);

      expect(
        await screen.findByText(/no ExecutionSuccess or ExecutionFailure/, { exact: false }),
      ).toBeVisible();
      expect(transactionActivityForHash(EXECUTION)).toMatchObject({
        status: "failed",
        manualVerificationRequired: true,
      });
      expect(screen.queryByText(/Executed Safe transaction/)).toBeNull();
    });

    it.each([
      [
        "its transaction reverted",
        () => ({ status: "reverted", transactionHash: EXECUTION, blockNumber: 1n, logs: [] }),
        "reverted",
      ],
      [
        "the Safe's call failed",
        (safeTxHash: Hex) => ({
          status: "success",
          transactionHash: EXECUTION,
          blockNumber: 1n,
          logs: [executionLog(SAFE.address, safeTxHash, "ExecutionFailure")],
        }),
        "ExecutionFailure",
      ],
    ])("is settled failed, and can be sent again, when %s", async (_case, receipt, reason) => {
      await execute(receipt);

      expect(await screen.findByText(new RegExp(reason))).toBeVisible();
      await waitFor(() =>
        expect(transactionActivityForHash(EXECUTION)).toMatchObject({
          status: "failed",
          manualVerificationRequired: false,
        }),
      );
    });

    it("is confirmed by the Safe's ExecutionSuccess for its hash", async () => {
      const row = baseQueue(safeProposalFor({ to: TARGET, data: "0x1234" }, 5));
      mocks.receipt.mockResolvedValue({
        status: "success",
        transactionHash: EXECUTION,
        blockNumber: 1n,
        logs: [executionLog(SAFE.address, row.safeTxHash!)],
      });
      renderCard(8453);
      fireEvent.click(await screen.findByRole("button", { name: "Execute" }));
      fireEvent.click(
        within(await screen.findByRole("dialog")).getByRole("button", { name: "Execute" }),
      );

      expect(await screen.findByText("Executed Safe transaction #5 on Base.")).toBeVisible();
      expect(transactionActivityForHash(EXECUTION)).toMatchObject({
        status: "success",
        manualVerificationRequired: false,
      });
    });
  });
});
