import { PendingRoutingPayments } from "@/app/[slug]/components/ActivityFeed/PendingRoutingPayments";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  indexed: vi.fn(),
  payment: vi.fn(),
  prepare: vi.fn(),
  batch: vi.fn(),
  saved: vi.fn(),
  recheck: vi.fn(),
  describe: vi.fn(),
  address: "0x0000000000000000000000000000000000000001",
}));
vi.mock("wagmi", () => ({ useAccount: () => ({ address: mocks.address, chainId: 1 }) }));
vi.mock("@/lib/wagmiTransports", () => ({ getViemPublicClient: () => ({}) }));
vi.mock("@/hooks/useMultichainBatch", () => ({
  useMultichainBatch: () => ({
    runBatch: mocks.batch,
    getPendingBatch: mocks.saved,
    recheckPendingRoutingBatch: mocks.recheck,
  }),
}));
vi.mock("@/lib/pending-router-calls", () => ({
  readIndexedPendingRouterCalls: mocks.indexed,
  readPendingRouterPayment: mocks.payment,
  preparePendingRouterPayment: mocks.prepare,
  describeSavedRoutingCall: mocks.describe,
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
  mocks.address = "0x0000000000000000000000000000000000000001";
  mocks.saved.mockReturnValue(undefined);
  mocks.recheck.mockImplementation(async () => mocks.saved());
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
    expect(await screen.findByText("1 payment ready to route.")).toBeTruthy();
    fireEvent.click(await screen.findByRole("button", { name: "Review routing" }));
    expect(await screen.findByRole("dialog")).toBeTruthy();
    expect(screen.getByText(/A retry can remain pending/)).toBeTruthy();
    expect(screen.getByText("Beneficiary")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Confirm routing" }));
    await screen.findByText(/Routing review complete/);
    expect(mocks.batch).toHaveBeenCalledWith(expect.objectContaining({ calls: [{ id: "one" }] }));
  });

  it("wallet-action:pending-routing batches every ready payment across chains and explicitly leaves cooldown calls pending", async () => {
    mocks.saved.mockReturnValue({
      id: "unknown",
      scope: "legacy",
      completed: 0,
      total: 3,
      refreshable: true,
    });
    mocks.indexed.mockImplementation(async (project: { chainId: number }) =>
      project.chainId === 1 ? [row("one").indexed, row("waiting").indexed] : [row("base").indexed],
    );
    mocks.payment.mockImplementation(async (_client, indexed) =>
      row(indexed.pendingCallId, indexed.pendingCallId !== "waiting"),
    );
    setup();
    expect(await screen.findByText("2 of 3 payments ready to route.")).toBeTruthy();
    fireEvent.click(await screen.findByRole("button", { name: "Batch all pending" }));
    expect(screen.getByText("Payments in cooldown must wait.")).toBeTruthy();
    expect(await screen.findByRole("button", { name: "Confirm routing" })).toBeEnabled();
    expect(screen.queryByRole("checkbox")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Confirm routing" }));
    await waitFor(() =>
      expect(mocks.batch).toHaveBeenCalledWith(
        expect.objectContaining({ calls: [{ id: "one" }, { id: "base" }] }),
      ),
    );
    expect(mocks.prepare).toHaveBeenCalledTimes(2);
  });

  it("reviews all 14 ready payments and offers normal confirmation despite a hashless three-attempt selection", async () => {
    mocks.saved.mockReturnValue({
      id: "unknown-three",
      scope: "legacy",
      completed: 0,
      total: 3,
      refreshable: true,
      recoveryReason: "A wallet submission has an unknown result.",
    });
    mocks.indexed.mockImplementation(async (project: { chainId: number }) =>
      project.chainId === 1 ? Array.from({ length: 14 }, (_, i) => row(`item-${i}`).indexed) : [],
    );
    const rendered = setup();
    await screen.findByText("14 payments ready to route.");
    expect(screen.queryByRole("button", { name: "Resume saved batch" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Re-check saved status" })).toBeNull();
    expect(screen.queryByText(/Saved batch:/)).toBeNull();
    expect(screen.queryByText(/A wallet submission has an unknown result/)).toBeNull();
    expect(mocks.recheck).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Batch all pending" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getAllByRole("listitem")).toHaveLength(14);
    const confirm = within(dialog).getByRole("button", { name: "Confirm routing" });
    expect(within(dialog).queryByRole("checkbox")).toBeNull();
    expect(confirm).toBeEnabled();
    expect(mocks.batch).not.toHaveBeenCalled();
    expect(within(dialog).queryByText(/Check your wallet has no pending transaction/)).toBeNull();

    // The eventual write must recheck the reviewed ID, never silently supersede a newer journal.
    mocks.saved.mockReturnValue({
      id: "different",
      scope: "other",
      completed: 0,
      total: 1,
      refreshable: true,
    });
    rendered.rerender(
      <QueryClientProvider client={new QueryClient()}>
        <PendingRoutingPayments projects={projects} />
      </QueryClientProvider>,
    );
    fireEvent.click(confirm);
    await waitFor(() => expect(mocks.batch).toHaveBeenCalledTimes(1));
    expect(mocks.batch.mock.calls[0][0]).toMatchObject({
      scope: "pending-routing:destination:1:1,8453:1",
      refreshBatchId: "unknown-three",
      calls: Array.from({ length: 14 }, (_, i) => ({ id: `item-${i}` })),
    });
    expect(mocks.batch.mock.calls[0][0].replaceDraftId).toBeUndefined();
    expect(mocks.batch.mock.calls[0][0].expectedBatchId).toBeUndefined();
    expect(mocks.prepare).toHaveBeenCalledTimes(14);
  });

  it("cancels a fresh review without changing the saved batch and prepares all current payments again", async () => {
    mocks.saved.mockReturnValue({
      id: "unknown",
      scope: "legacy",
      completed: 0,
      total: 3,
      refreshable: true,
    });
    mocks.indexed.mockImplementation(async (project: { chainId: number }) =>
      project.chainId === 1 ? Array.from({ length: 14 }, (_, i) => row(`item-${i}`).indexed) : [],
    );
    setup();
    fireEvent.click(await screen.findByRole("button", { name: "Batch all pending" }));
    expect(await screen.findByRole("button", { name: "Confirm routing" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(mocks.batch).not.toHaveBeenCalled();
    expect(mocks.saved()).toMatchObject({ id: "unknown", refreshable: true });
    fireEvent.click(screen.getByRole("button", { name: "Batch all pending" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getAllByRole("listitem")).toHaveLength(14);
    expect(within(dialog).queryByRole("checkbox")).toBeNull();
    expect(within(dialog).getByRole("button", { name: "Confirm routing" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: "Resume saved batch" })).toBeNull();
    expect(mocks.prepare).toHaveBeenCalledTimes(28);
    expect(mocks.batch).not.toHaveBeenCalled();
  });

  it("requires a fresh full-set review after a failed submission and captures the current saved identity", async () => {
    mocks.saved.mockReturnValue({
      id: "unknown",
      scope: "legacy",
      completed: 0,
      total: 3,
      refreshable: true,
    });
    mocks.indexed.mockImplementation(async (project: { chainId: number }) =>
      project.chainId === 1 ? Array.from({ length: 14 }, (_, i) => row(`item-${i}`).indexed) : [],
    );
    mocks.batch.mockImplementationOnce(async () => {
      mocks.saved.mockReturnValue({
        id: "newer-unknown",
        scope: "legacy",
        completed: 0,
        total: 3,
        refreshable: true,
      });
      throw new Error("The saved batch changed. Review again.");
    });
    setup();
    fireEvent.click(await screen.findByRole("button", { name: "Batch all pending" }));
    fireEvent.click(await screen.findByRole("button", { name: "Confirm routing" }));
    fireEvent.click(await screen.findByRole("button", { name: "Review again" }));
    const confirm = await screen.findByRole("button", { name: "Confirm routing" });
    expect(confirm).toBeEnabled();
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(within(screen.getByRole("dialog")).getAllByRole("listitem")).toHaveLength(14);
    expect(mocks.prepare).toHaveBeenCalledTimes(28);
    expect(mocks.batch).toHaveBeenCalledTimes(1);
    fireEvent.click(confirm);
    await waitFor(() => expect(mocks.batch).toHaveBeenCalledTimes(2));
    expect(mocks.batch.mock.calls[0][0].refreshBatchId).toBe("unknown");
    expect(mocks.batch.mock.calls[1][0]).toMatchObject({
      refreshBatchId: "newer-unknown",
      calls: Array.from({ length: 14 }, (_, i) => ({ id: `item-${i}` })),
    });
  });

  it("blocks refreshing a hashless selection when the reviewed account changes", async () => {
    mocks.saved.mockReturnValue({
      id: "unknown",
      scope: "legacy",
      completed: 0,
      total: 3,
      refreshable: true,
    });
    const rendered = setup();
    fireEvent.click(await screen.findByRole("button", { name: "Review routing" }));
    expect(await screen.findByRole("button", { name: "Confirm routing" })).toBeEnabled();
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

  it("keeps submitted selections in recovery without offering a fresh batch", async () => {
    mocks.saved.mockReturnValue({
      id: "submitted",
      scope: "legacy",
      completed: 0,
      total: 3,
      refreshable: false,
    });
    mocks.indexed.mockImplementation(async (project: { chainId: number }) =>
      project.chainId === 1 ? Array.from({ length: 14 }, (_, i) => row(`item-${i}`).indexed) : [],
    );
    setup();
    await screen.findByText("14 payments ready to route.");
    expect(screen.queryByRole("button", { name: "Batch all pending" })).toBeNull();
    expect(
      screen
        .getAllByRole("button", { name: "Review routing" })
        .every((button) => button.hasAttribute("disabled")),
    ).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Resume saved batch" }));
    expect(within(await screen.findByRole("dialog")).queryByRole("checkbox")).toBeNull();
    expect(mocks.prepare).not.toHaveBeenCalled();
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
    mocks.saved.mockReturnValue({
      id: "original-batch",
      scope: "pending-routing:1:6",
      completed: 1,
      total: 2,
    });
    setup();
    fireEvent.click(await screen.findByRole("button", { name: "Resume saved batch" }));
    fireEvent.click(await screen.findByRole("button", { name: "Continue" }));
    await waitFor(() =>
      expect(mocks.batch).toHaveBeenCalledWith(
        expect.objectContaining({
          scope: "pending-routing:1:6",
          expectedBatchId: "original-batch",
          calls: [],
        }),
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
    expect(screen.getByText(/Saved batch: 0 of 3 attempts handled/)).toBeTruthy();
    expect(mocks.prepare).not.toHaveBeenCalled();
    finish();
    await screen.findByText("7 payments ready to route.");
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
    expect(screen.queryByText(/Saved batch:/)).toBeNull();
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

  it("shows the saved payment details and exact recovery reason before continuing", async () => {
    mocks.saved.mockReturnValue({
      id: "held",
      scope: "legacy",
      completed: 0,
      total: 1,
      replaceableDraft: false,
      recoveryReason: "The previous wallet submission has an unknown result.",
      calls: [{ chainId: 8453, state: "submitting" }],
    });
    mocks.describe.mockReturnValue({
      id: "saved",
      chainId: 8453,
      projectId: "1",
      sourceProjectId: "6",
      amountLabel: "1.3 USDC",
      beneficiary: mocks.address,
      pendingCallId: "0x1234",
      state: "submitting",
    });
    setup();
    fireEvent.click(await screen.findByRole("button", { name: "Resume saved batch" }));
    const dialog = await screen.findByRole("dialog");
    expect(
      within(dialog).getByText("The previous wallet submission has an unknown result."),
    ).toBeTruthy();
    expect(within(dialog).getByText("1.3 USDC")).toBeTruthy();
    expect(within(dialog).getByText("Project 6")).toBeTruthy();
    expect(within(dialog).getByText("submitting")).toBeTruthy();
    expect(mocks.batch).not.toHaveBeenCalled();
    expect(mocks.prepare).not.toHaveBeenCalled();
  });

  it("rechecks a saved reservation without submitting and unlocks a proven released draft", async () => {
    const held = { id: "held", scope: "legacy", completed: 0, total: 3, replaceableDraft: false };
    mocks.saved.mockReturnValue(held);
    mocks.recheck.mockImplementation(async () => {
      const checked = {
        ...held,
        replaceableDraft: true,
        recoveryReason: "The unpaid quote expired.",
      };
      mocks.saved.mockReturnValue(checked);
      return checked;
    });
    mocks.indexed.mockImplementation(async (project: { chainId: number }) =>
      project.chainId === 1 ? [row("a").indexed, row("b").indexed] : [],
    );
    setup();
    expect(await screen.findByRole("button", { name: "Batch all pending" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: "Resume saved batch" })).toBeNull();
    expect(mocks.recheck).toHaveBeenCalledTimes(1);
    expect(mocks.batch).not.toHaveBeenCalled();
    expect(mocks.prepare).not.toHaveBeenCalled();
  });

  it("does not switch an open saved review to a different journal after a status check", async () => {
    const first = {
      id: "first",
      scope: "first-scope",
      completed: 0,
      total: 1,
      replaceableDraft: false,
    };
    mocks.saved.mockReturnValue(first);
    setup();
    await waitFor(() => expect(mocks.recheck).toHaveBeenCalledTimes(1));
    fireEvent.click(await screen.findByRole("button", { name: "Resume saved batch" }));
    await screen.findByRole("dialog");
    mocks.recheck.mockResolvedValue({ ...first, id: "other", scope: "other-scope" });
    fireEvent.click(screen.getByRole("button", { name: "Re-check saved status" }));
    await screen.findByRole("button", { name: "Review again" });
    expect(screen.queryByRole("button", { name: "Continue" })).toBeNull();
    expect(mocks.batch).not.toHaveBeenCalled();
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

  it("refuses every way out after preparation reaches the payment boundary", async () => {
    let finish!: (result: unknown) => void;
    mocks.batch.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    setup();
    fireEvent.click(await screen.findByRole("button", { name: "Review routing" }));
    const dialog = (await screen.findByRole("dialog", {
      name: "Route pending payments",
    })) as HTMLDialogElement;
    fireEvent.click(within(dialog).getByRole("button", { name: "Confirm routing" }));
    await waitFor(() => expect(mocks.batch).toHaveBeenCalledTimes(1));
    const close = within(dialog).getByRole("button", { name: "Close" });
    const cancel = within(dialog).getByRole("button", { name: "Cancel" });
    expect(close).toBeEnabled();
    expect(cancel).toBeEnabled();
    act(() => {
      mocks.batch.mock.calls[0][0].onBeforePayment();
      // The boundary locks immediately, before React renders the disabled close control.
      fireEvent.click(close);
      fireEvent.click(cancel);
    });
    expect(close).toBeDisabled();
    expect(within(dialog).getByRole("status")).toHaveTextContent("Preparing routing…");
    expect(within(dialog).queryByRole("button", { name: "Cancel" })).toBeNull();
    expect(within(dialog).queryByRole("button", { name: "Confirm routing" })).toBeNull();
    fireEvent.click(close);
    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.pointerDown(dialog);
    expect(screen.getByRole("dialog", { name: "Route pending payments" })).toBe(dialog);
    expect(mocks.batch.mock.calls[0][0].signal.aborted).toBe(false);

    finish({ status: "success", hashes: [] });
    await within(dialog).findByRole("button", { name: "Done" });
    expect(mocks.batch).toHaveBeenCalledTimes(1);
  });

  it("shows passive progress for all 14 payments and restores the action after a timeout", async () => {
    let fail!: (cause: Error) => void;
    mocks.indexed.mockImplementation(async (project: { chainId: number }) =>
      project.chainId === 1 ? Array.from({ length: 14 }, (_, i) => row(`item-${i}`).indexed) : [],
    );
    mocks.batch.mockReturnValueOnce(new Promise((_resolve, reject) => (fail = reject)));
    setup();
    fireEvent.click(await screen.findByRole("button", { name: "Batch all pending" }));
    const dialog = await screen.findByRole("dialog", { name: "Route pending payments" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Confirm routing" }));

    expect(within(dialog).getByRole("status")).toHaveTextContent("Preparing routing…");
    expect(within(dialog).getAllByRole("listitem")).toHaveLength(14);
    expect(within(dialog).queryByRole("button", { name: "Confirm routing" })).toBeNull();
    expect(within(dialog).getByRole("button", { name: "Cancel" })).toBeEnabled();
    expect(within(dialog).getByRole("button", { name: "Close" })).toBeEnabled();
    expect(mocks.batch.mock.calls[0][0].calls).toHaveLength(14);

    act(() => mocks.batch.mock.calls[0][0].onProgress("Requesting network fee…"));
    expect(within(dialog).getByRole("status")).toHaveTextContent("Requesting network fee…");
    expect(within(dialog).queryByText("Preparing routing…")).toBeNull();
    await act(async () => fail(new Error("The network-fee request timed out. Try again.")));

    expect(within(dialog).getByText("The network-fee request timed out. Try again.")).toBeTruthy();
    expect(within(dialog).queryByRole("status")).toBeNull();
    expect(within(dialog).getByRole("button", { name: "Cancel" })).toBeEnabled();
    expect(within(dialog).getByRole("button", { name: "Close" })).toBeEnabled();
    const confirm = within(dialog).getByRole("button", { name: "Confirm routing" });
    expect(confirm).toBeEnabled();
    expect(mocks.batch).toHaveBeenCalledTimes(1);

    fireEvent.click(confirm);
    await within(dialog).findByRole("button", { name: "Done" });
    expect(mocks.batch).toHaveBeenCalledTimes(2);
  });

  it.each(["success", "error"])(
    "cancels quote preparation and ignores its late %s and progress callbacks",
    async (outcome) => {
      let finish!: (result: unknown) => void;
      let fail!: (cause: Error) => void;
      mocks.batch.mockReturnValueOnce(
        new Promise((resolve, reject) => {
          finish = resolve;
          fail = reject;
        }),
      );
      setup();
      fireEvent.click(await screen.findByRole("button", { name: "Review routing" }));
      const dialog = await screen.findByRole("dialog", { name: "Route pending payments" });
      fireEvent.click(within(dialog).getByRole("button", { name: "Confirm routing" }));
      const options = mocks.batch.mock.calls[0][0];
      expect(options.signal.aborted).toBe(false);
      fireEvent.click(
        within(dialog).getByRole("button", { name: outcome === "success" ? "Cancel" : "Close" }),
      );
      expect(options.signal.aborted).toBe(true);
      expect(screen.queryByRole("dialog")).toBeNull();
      expect(screen.getByRole("button", { name: "Review routing" })).toBeDisabled();

      await act(async () => {
        options.onProgress("Late quote progress");
        options.onBeforePayment();
        if (outcome === "success") finish({ status: "success", hashes: [] });
        else fail(new Error("Late quote failure"));
      });
      expect(screen.queryByRole("dialog")).toBeNull();
      expect(screen.queryByText(/Late quote/)).toBeNull();
      expect(screen.queryByText(/Routing review complete/)).toBeNull();
      expect(screen.getByRole("button", { name: "Review routing" })).toBeEnabled();
      expect(mocks.batch).toHaveBeenCalledTimes(1);

      fireEvent.click(screen.getByRole("button", { name: "Review routing" }));
      const nextDialog = await screen.findByRole("dialog", { name: "Route pending payments" });
      act(() => options.onProgress("Late quote progress"));
      expect(within(nextDialog).queryByRole("status")).toBeNull();
      expect(within(nextDialog).queryByRole("button", { name: "Done" })).toBeNull();
      expect(within(nextDialog).getByRole("button", { name: "Confirm routing" })).toBeEnabled();
    },
  );

  it.each(["quote", "payment"])(
    "unmounting during %s only aborts preparation and ignores late completion",
    async (phase) => {
      let finish!: (result: unknown) => void;
      mocks.batch.mockReturnValueOnce(new Promise((resolve) => (finish = resolve)));
      const rendered = setup();
      fireEvent.click(await screen.findByRole("button", { name: "Review routing" }));
      const dialog = await screen.findByRole("dialog", { name: "Route pending payments" });
      fireEvent.click(within(dialog).getByRole("button", { name: "Confirm routing" }));
      const options = mocks.batch.mock.calls[0][0];
      if (phase === "payment") act(() => options.onBeforePayment());
      expect(options.signal.aborted).toBe(false);

      rendered.unmount();
      expect(options.signal.aborted).toBe(phase === "quote");
      const invalidate = vi.spyOn(QueryClient.prototype, "invalidateQueries");
      try {
        await act(async () => {
          options.onProgress("Late progress after navigation");
          finish({ status: "success", hashes: [] });
        });
        expect(invalidate).not.toHaveBeenCalled();
        expect(screen.queryByRole("dialog")).toBeNull();
      } finally {
        invalidate.mockRestore();
      }
    },
  );

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
