import { PendingRoutingPayments } from "@/app/[slug]/components/ActivityFeed/PendingRoutingPayments";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
vi.mock("@/lib/utils", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/utils")>()),
  formatWalletError: (cause: Error) => cause.message,
}));

const projects = [
  { chainId: 1, projectId: 1, version: 6 },
  { chainId: 8453, projectId: 1, version: 6 },
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

describe("payment recovery", () => {
  it("renders nothing when all indexed destination projects have no pending calls", async () => {
    mocks.indexed.mockResolvedValue([]);
    setup();
    await waitFor(() => expect(mocks.indexed).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByText("Payments awaiting routing")).toBeNull());
  });

  it("offers a per-payment review with the original beneficiary and no settlement claim", async () => {
    setup();
    fireEvent.click(await screen.findByRole("button", { name: "Review routing" }));
    expect(await screen.findByRole("dialog")).toBeTruthy();
    expect(screen.getByText(/A retry can remain pending/)).toBeTruthy();
    expect(screen.getByText("Beneficiary")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Confirm routing" }));
    await screen.findByText(/Routing review complete/);
    expect(mocks.batch).toHaveBeenCalledWith(expect.objectContaining({ calls: [{ id: "one" }] }));
  });

  it("wallet-action:pending-routing batches every ready payment across chains and explicitly leaves cooldown calls pending", async () => {
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

  it("keeps the batch action above the payment list", async () => {
    mocks.indexed.mockImplementation(async (project: { chainId: number }) =>
      project.chainId === 1 ? [row("one").indexed, row("two").indexed] : [],
    );
    setup();
    const batch = await screen.findByRole("button", { name: "Batch all pending" });
    const firstRetry = screen.getAllByRole("button", { name: "Review routing" })[0];
    expect(
      batch.compareDocumentPosition(firstRetry) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("resumes the saved selection when the index is already empty without preparing another call", async () => {
    mocks.indexed.mockResolvedValue([]);
    mocks.saved.mockReturnValue({ scope: "pending-routing:1:6", completed: 1, total: 2 });
    setup();
    fireEvent.click(await screen.findByRole("button", { name: "Resume saved batch" }));
    fireEvent.click(await screen.findByRole("button", { name: "Continue" }));
    await waitFor(() =>
      expect(mocks.batch).toHaveBeenCalledWith(
        expect.objectContaining({ scope: "pending-routing:1:6", calls: [] }),
      ),
    );
    expect(mocks.prepare).not.toHaveBeenCalled();
  });

  it("shows the full discovered inventory while checking a saved three-attempt selection", async () => {
    let finish!: () => void;
    const check = new Promise<void>((resolve) => {
      finish = resolve;
    });
    mocks.saved.mockReturnValue({ scope: "legacy", completed: 0, total: 3 });
    mocks.indexed.mockImplementation(async (project: { chainId: number }) =>
      project.chainId === 1
        ? Array.from({ length: 7 }, (_, i) => ({
            ...row(`item-${i}`).indexed,
            amount: "100",
            token: mocks.address,
          }))
        : [],
    );
    mocks.payment.mockImplementation(async (_client, indexed) => {
      await check;
      return row(indexed.pendingCallId);
    });
    setup();
    expect(await screen.findByText("Found 7 payments. Checking current status…")).toBeTruthy();
    expect(screen.getAllByText("Checking payment status…")).toHaveLength(7);
    expect(screen.getByRole("button", { name: "Resume saved batch" })).toBeEnabled();
    expect(screen.getByText(/separate from the full pending list/)).toBeTruthy();
    expect(mocks.prepare).not.toHaveBeenCalled();
    finish();
    await screen.findByText("7 payments awaiting routing. 7 ready");
    expect(screen.getAllByText("0.1 ETH")).toHaveLength(7);
    expect(
      screen
        .getAllByRole("button", { name: "Review routing" })
        .every((button) => button.hasAttribute("disabled")),
    ).toBe(true);
  });

  it("keeps discovered payments visible when a chain check fails, excluding resolved rows", async () => {
    mocks.indexed.mockImplementation(async (project: { chainId: number }) =>
      project.chainId === 1
        ? [row("ok").indexed, row("failed").indexed, row("resolved").indexed]
        : [],
    );
    mocks.payment.mockImplementation(async (_client, indexed) => {
      if (indexed.pendingCallId === "failed") throw new Error("RPC unavailable");
      return indexed.pendingCallId === "resolved" ? null : row(indexed.pendingCallId);
    });
    setup();
    await screen.findByText("Could not verify payment: RPC unavailable");
    expect(screen.getAllByText("To project 1 on Ethereum")).toHaveLength(2);
    expect(screen.getByText("0.1 ETH")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Batch all pending" })).toBeDisabled();
    expect(mocks.prepare).not.toHaveBeenCalled();
  });

  it("replaces an untouched three-call draft with the full freshly reviewed selection", async () => {
    mocks.saved.mockReturnValue({
      id: "old-draft",
      scope: "legacy",
      completed: 0,
      total: 3,
      replaceableDraft: true,
    });
    mocks.indexed.mockImplementation(async (project: { chainId: number }) =>
      project.chainId === 1 ? Array.from({ length: 8 }, (_, i) => row(`item-${i}`).indexed) : [],
    );
    setup();
    fireEvent.click(await screen.findByRole("button", { name: "Batch all pending" }));
    expect(screen.queryByRole("button", { name: "Resume saved batch" })).toBeNull();
    expect(screen.queryByText(/Finish it before starting another batch/)).toBeNull();
    await screen.findByRole("button", { name: "Confirm routing" });
    // A later journal update must not silently change the selection being confirmed.
    mocks.saved.mockReturnValue({
      id: "different",
      scope: "other",
      completed: 0,
      total: 1,
      replaceableDraft: false,
    });
    fireEvent.click(screen.getByRole("button", { name: "Confirm routing" }));
    await waitFor(() =>
      expect(mocks.batch).toHaveBeenCalledWith(
        expect.objectContaining({
          scope: "pending-routing:destination:1:1,8453:1",
          replaceDraftId: "old-draft",
          calls: Array.from({ length: 8 }, (_, i) => ({ id: `item-${i}` })),
        }),
      ),
    );
    expect(mocks.prepare).toHaveBeenCalledTimes(8);
  });

  it("requires a fresh review after a failed draft replacement instead of reusing its old identity", async () => {
    mocks.saved.mockReturnValue({
      id: "old-draft",
      scope: "legacy",
      completed: 0,
      total: 3,
      replaceableDraft: true,
    });
    mocks.batch.mockImplementationOnce(async () => {
      mocks.saved.mockReturnValue(undefined);
      throw new Error("Quote unavailable");
    });
    setup();
    fireEvent.click(await screen.findByRole("button", { name: "Review routing" }));
    fireEvent.click(await screen.findByRole("button", { name: "Confirm routing" }));
    fireEvent.click(await screen.findByRole("button", { name: "Review again" }));
    fireEvent.click(await screen.findByRole("button", { name: "Confirm routing" }));
    await waitFor(() => expect(mocks.batch).toHaveBeenCalledTimes(2));
    expect(mocks.batch.mock.calls[0][0].replaceDraftId).toBe("old-draft");
    expect(mocks.batch.mock.calls[1][0].replaceDraftId).toBeUndefined();
    expect(mocks.prepare).toHaveBeenCalledTimes(2);
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

  it("goes back with Cancel before anything is sent", async () => {
    setup();
    fireEvent.click(await screen.findByRole("button", { name: "Review routing" }));
    const dialog = await screen.findByRole("dialog", { name: "Route pending payments" });

    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(mocks.batch).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Review routing" })).toBeEnabled();
  });

  it("refuses every way out while the routing round runs", async () => {
    let finish!: (result: unknown) => void;
    mocks.batch.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    setup();
    fireEvent.click(await screen.findByRole("button", { name: "Review routing" }));
    const dialog = (await screen.findByRole("dialog", {
      name: "Route pending payments",
    })) as HTMLDialogElement;
    fireEvent.click(within(dialog).getByRole("button", { name: "Confirm routing" }));
    await waitFor(() => expect(mocks.batch).toHaveBeenCalledTimes(1));

    const cancel = within(dialog).getByRole("button", { name: "Cancel" });
    const close = within(dialog).getByRole("button", { name: "Close" });
    expect(cancel).toBeDisabled();
    expect(close).toBeDisabled();
    expect(within(dialog).getByRole("button", { name: "Confirm routing" })).toBeDisabled();
    fireEvent.click(cancel);
    fireEvent.click(close);
    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.pointerDown(dialog);
    expect(screen.getByRole("dialog", { name: "Route pending payments" })).toBe(dialog);

    finish({ status: "success", hashes: [] });
    await within(dialog).findByRole("button", { name: "Done" });
    expect(mocks.batch).toHaveBeenCalledTimes(1);
  });

  it("ends the round on Done, still listing what it routed", async () => {
    setup();
    fireEvent.click(await screen.findByRole("button", { name: "Review routing" }));
    const dialog = await screen.findByRole("dialog", { name: "Route pending payments" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Confirm routing" }));

    const done = await within(dialog).findByRole("button", { name: "Done" });
    expect(dialog).toHaveTextContent(/Routing review complete/);
    expect(within(dialog).queryByRole("button", { name: "Confirm routing" })).toBeNull();
    expect(within(dialog).queryByRole("button", { name: "Cancel" })).toBeNull();
    const routed = within(dialog).getAllByRole("listitem");
    expect(routed).toHaveLength(1);
    expect(routed[0]).toHaveAttribute("data-state", "complete");
    expect(routed[0]).toHaveTextContent("0.1 ETH to project 1");

    fireEvent.click(done);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(mocks.batch).toHaveBeenCalledTimes(1);
  });
});
