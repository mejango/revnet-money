import { PendingRoutingPayments } from "@/app/[slug]/components/ActivityFeed/PendingRoutingPayments";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  indexed: vi.fn(),
  payment: vi.fn(),
  prepare: vi.fn(),
  batch: vi.fn(),
  saved: vi.fn(),
  address: "0x0000000000000000000000000000000000000001",
}));
vi.mock("wagmi", () => ({ useAccount: () => ({ address: mocks.address, chainId: 1 }) }));
vi.mock("@/lib/wagmiTransports", () => ({ getViemPublicClient: () => ({}) }));
vi.mock("@/hooks/useMultichainBatch", () => ({
  useMultichainBatch: () => ({ runBatch: mocks.batch, getPendingBatch: mocks.saved }),
}));
vi.mock("@/lib/pending-router-calls", () => ({
  readIndexedPendingRouterCalls: mocks.indexed,
  readPendingRouterPayment: mocks.payment,
  preparePendingRouterPayment: mocks.prepare,
}));
vi.mock("@/components/ButtonWithWallet", () => ({
  ButtonWithWallet: ({
    children,
    onClick,
    disabled,
    loading,
  }: {
    children: ReactNode;
    onClick: () => void;
    disabled?: boolean;
    loading?: boolean;
  }) => (
    <button onClick={onClick} disabled={disabled || loading}>
      {children}
    </button>
  ),
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
    status,
  }: {
    open: boolean;
    onConfirm: () => void;
    action: string;
    children: ReactNode;
    error: string;
    status: string;
  }) =>
    open ? (
      <div role="dialog">
        {children}
        <p>{status}</p>
        {error && <p role="alert">{error}</p>}
        <button onClick={onConfirm}>{action}</button>
      </div>
    ) : null,
}));
vi.mock("@/lib/utils", () => ({ formatWalletError: (cause: Error) => cause.message }));

const projects = [
  { chainId: 1, projectId: 7, version: 6 },
  { chainId: 8453, projectId: 9, version: 6 },
];
const row = (id: string, ready = true) => ({
  id,
  ready,
  amountLabel: "0.1 ETH",
  action: "processPendingCall",
  nextAttemptAt: 86_500n,
  indexed: {
    chainId: id === "base" ? 8453 : 1,
    sourceProjectId: 7,
    projectId: 1,
    beneficiary: mocks.address,
    refundTo: mocks.address,
    pendingCallId: id,
  },
});
function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <PendingRoutingPayments projects={projects} />
    </QueryClientProvider>,
  );
}
beforeEach(() => {
  mocks.saved.mockReturnValue(undefined);
  mocks.indexed.mockImplementation(async (project: { chainId: number }) =>
    project.chainId === 1 ? [row("one").indexed] : [],
  );
  mocks.payment.mockImplementation(async (_client, indexed) => row(indexed.pendingCallId));
  mocks.prepare.mockImplementation(async (_client, indexed) => ({
    payment: row(indexed.pendingCallId),
    call: { id: indexed.pendingCallId },
  }));
  mocks.batch.mockResolvedValue({ status: "success", hashes: [] });
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("wallet-action:pending-routing — payment recovery", () => {
  it("renders nothing when all indexed source projects have no pending calls", async () => {
    mocks.indexed.mockResolvedValue([]);
    setup();
    await waitFor(() => expect(mocks.indexed).toHaveBeenCalledTimes(2));
    expect(screen.queryByText("Payments awaiting routing")).toBeNull();
  });

  it("offers a per-payment review with the original beneficiary and no settlement claim", async () => {
    setup();
    fireEvent.click(await screen.findByRole("button", { name: "Review routing" }));
    expect(await screen.findByRole("dialog")).toBeTruthy();
    expect(screen.getByText(/A retry can remain pending/)).toBeTruthy();
    expect(screen.getByText(/Beneficiary:/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Confirm routing" }));
    await screen.findByText(/Routing review complete/);
    expect(mocks.batch).toHaveBeenCalledWith(expect.objectContaining({ calls: [{ id: "one" }] }));
  });

  it("batches every ready payment across chains and explicitly leaves cooldown calls pending", async () => {
    mocks.indexed.mockImplementation(async (project: { chainId: number }) =>
      project.chainId === 1 ? [row("one").indexed, row("waiting").indexed] : [row("base").indexed],
    );
    mocks.payment.mockImplementation(async (_client, indexed) =>
      row(indexed.pendingCallId, indexed.pendingCallId !== "waiting"),
    );
    setup();
    fireEvent.click(await screen.findByRole("button", { name: "Batch all pending" }));
    expect(
      screen.getByText("Includes 2 ready payments. Payments in cooldown must wait."),
    ).toBeTruthy();
    fireEvent.click(await screen.findByRole("button", { name: "Confirm routing" }));
    await waitFor(() =>
      expect(mocks.batch).toHaveBeenCalledWith(
        expect.objectContaining({ calls: [{ id: "one" }, { id: "base" }] }),
      ),
    );
    expect(mocks.prepare).toHaveBeenCalledTimes(2);
  });

  it("resumes the saved selection when the index is already empty without preparing another call", async () => {
    mocks.indexed.mockResolvedValue([]);
    mocks.saved.mockReturnValue({ completed: 1, total: 2 });
    setup();
    fireEvent.click(
      await screen.findByRole("button", { name: "Continue routing (1/2 confirmed)" }),
    );
    fireEvent.click(await screen.findByRole("button", { name: "Continue" }));
    await waitFor(() =>
      expect(mocks.batch).toHaveBeenCalledWith(expect.objectContaining({ calls: [] })),
    );
    expect(mocks.prepare).not.toHaveBeenCalled();
  });

  it("blocks submit if the wallet changed after review", async () => {
    const rendered = setup();
    fireEvent.click(await screen.findByRole("button", { name: "Review routing" }));
    await screen.findByRole("dialog");
    mocks.address = "0x0000000000000000000000000000000000000002";
    rendered.rerender(
      <QueryClientProvider client={new QueryClient()}>
        <PendingRoutingPayments projects={projects} />
      </QueryClientProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Confirm routing" }));
    await screen.findByText(/connected account changed/);
    expect(mocks.batch).not.toHaveBeenCalled();
  });

  it("keeps the authenticated obsolete Safe proposal and cancellation nonce visible", async () => {
    const hash = `0x${"a".repeat(64)}`;
    mocks.batch.mockResolvedValue({
      status: "pending",
      hashes: [],
      obsoleteSafeProposals: [{ chainId: 1, safe: mocks.address, hash, nonce: 7, callIndex: 0 }],
    });
    setup();
    fireEvent.click(await screen.findByRole("button", { name: "Review routing" }));
    fireEvent.click(await screen.findByRole("button", { name: "Confirm routing" }));
    const link = await screen.findByRole("link", { name: `Safe proposal ${hash}` });
    expect(link.getAttribute("href")).toContain(`safe=eth:${mocks.address}`);
    expect(screen.getByText(/Cancel or replace nonce 7/)).toBeTruthy();
    expect(screen.queryByText(/Routing review complete/)).toBeNull();
  });
});
