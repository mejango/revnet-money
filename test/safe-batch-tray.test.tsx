import { SafeBatchTray } from "@/app/[slug]/components/v6/operator/SafeBatchTray";
import { buildStep, readBatch, writeBatch } from "@/lib/safe-batch";
import { NATIVE_TOKEN } from "@bananapus/nana-sdk-core";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { Address } from "viem";
import { beforeEach, describe, expect, it, vi } from "vitest";

// wallet-action:safe-batch

const OPERATOR = `0x${"22".repeat(20)}` as Address;
const HOOK = "0xB222Da5A71e8FB89a5A38b7c920EaB5DfbC74B91" as Address;
const TERMINAL = "0x4a56AEf5b6A5b9742AbB02cA67C5a85ba183D901" as Address;
const ROWS = [
  { chainId: 8453 as const, projectId: 6 },
  { chainId: 10 as const, projectId: 7 },
];

const mocks = vi.hoisted(() => ({
  submit: vi.fn(),
  preset: {
    status: "ready" as const,
    steps: [] as unknown[],
    notes: [] as string[],
  },
}));

// The route and preset reads need RPC; the shell test has none, so useQuery
// answers each key with its fixture and the submit hook is a spy.
vi.mock("@tanstack/react-query", () => ({
  useQuery: ({ queryKey }: { queryKey: unknown[] }) => ({
    data:
      queryKey[0] === "safe-batch-route"
        ? { kind: "eoa", authority: OPERATOR }
        : queryKey[0] === "safe-batch-preset"
          ? ROWS.map((row) => ({ row, result: mocks.preset }))
          : undefined,
    isLoading: false,
    isError: false,
  }),
}));
vi.mock("@/app/[slug]/components/v6/operator/useSafeBatchSubmit", () => ({
  useSafeBatchSubmit: () => ({
    routeFor: vi.fn(),
    submit: mocks.submit,
  }),
}));
vi.mock("@/app/[slug]/components/v6/operator/useLiveRevnetOperators", () => ({
  useLiveRevnetOperators: () => ({
    operatorByChain: new Map([[8453, OPERATOR]]),
    isLoading: false,
  }),
}));
vi.mock("@/hooks/useReviewedWriteContract", () => ({
  isSafeProposalPendingError: () => false,
}));
vi.mock("@/components/ChainLogo", () => ({ ChainLogo: () => null }));
vi.mock("@/components/ButtonWithWallet", () => ({
  ButtonWithWallet: ({
    children,
    loading: _loading,
    targetChainId: _target,
    connectWalletText: _connect,
    ...props
  }: {
    children: React.ReactNode;
    loading?: boolean;
    targetChainId?: number;
    connectWalletText?: string;
  }) => <button {...props}>{children}</button>,
}));
vi.mock("@/lib/wagmiConfig", () => ({ wagmiConfig: {} }));
vi.mock("wagmi", () => ({
  useAccount: () => ({ address: OPERATOR, chainId: 8453 }),
  useChainId: () => 8453,
  useConfig: () => ({}),
  useSwitchChain: () => ({ switchChainAsync: vi.fn(), isPending: false }),
}));

const hookStep = () =>
  buildStep({ kind: "setHookFor", chainId: 8453, projectId: 6, values: { hook: HOOK } });
const poolStep = () =>
  buildStep({
    kind: "setPoolFor",
    chainId: 8453,
    projectId: 6,
    values: { fee: 10_000n, tickSpacing: 200n, twapWindow: 1_800n, terminalToken: NATIVE_TOKEN },
  });
const terminalStep = () =>
  buildStep({
    kind: "setTerminalFor",
    chainId: 8453,
    projectId: 6,
    values: { terminal: TERMINAL },
  });

describe("SafeBatchTray", () => {
  beforeEach(() => {
    window.localStorage.clear();
    mocks.submit.mockReset();
  });

  it("shows one chip per chain with queued steps, read from storage", () => {
    writeBatch(8453, 6, [hookStep(), terminalStep()]);
    render(<SafeBatchTray rows={ROWS} fallbackProject={ROWS[0]} />);
    expect(screen.getByRole("button", { name: "2 queued · Base" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Optimism/ })).toBeNull();
    expect(screen.getByRole("button", { name: "Presets" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Same on every chain" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Clear" })).toBeTruthy();
  });

  it("keeps only Presets when nothing is queued, and Clear empties every chain", () => {
    const { unmount } = render(<SafeBatchTray rows={ROWS} fallbackProject={ROWS[0]} />);
    expect(screen.getByText("Nothing queued.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Clear" })).toBeNull();
    unmount();

    writeBatch(8453, 6, [hookStep()]);
    writeBatch(10, 7, [
      buildStep({ kind: "setHookFor", chainId: 10, projectId: 7, values: { hook: HOOK } }),
    ]);
    render(<SafeBatchTray rows={ROWS} fallbackProject={ROWS[0]} />);
    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    expect(readBatch(8453, 6)).toEqual([]);
    expect(readBatch(10, 7)).toEqual([]);
    expect(screen.getByText("Nothing queued.")).toBeTruthy();
  });

  it("opens the chain's batch dialog listing each step with its decoded call", async () => {
    writeBatch(8453, 6, [hookStep(), terminalStep()]);
    render(<SafeBatchTray rows={ROWS} fallbackProject={ROWS[0]} />);
    fireEvent.click(screen.getByRole("button", { name: "2 queued · Base" }));

    const dialog = await screen.findByRole("dialog", { name: "Batch on Base" });
    const list = screen.getByRole("list", { name: "Batch steps" });
    expect(dialog.contains(list)).toBe(true);
    const items = list.querySelectorAll(":scope > li");
    expect(items).toHaveLength(2);
    expect(items[0]!.textContent).toContain("Set buyback hook");
    expect(items[0]!.textContent).toContain("setHookFor(uint256, address)");
    expect(items[0]!.textContent).toContain(HOOK);
    expect(items[1]!.textContent).toContain("Set router terminal");
    expect(items[1]!.textContent).toContain("setTerminalFor(uint256, address)");
    expect(dialog.textContent).toContain("2 transactions from your wallet, in order");
    expect(dialog.textContent).toContain("EOA");
    expect(screen.getByRole("button", { name: "Send 2 transactions" })).not.toBeDisabled();
  });

  it("shows the dependency message on the offending step, disables the action, and lets ↑ fix it", async () => {
    writeBatch(8453, 6, [poolStep(), hookStep()]);
    render(<SafeBatchTray rows={ROWS} fallbackProject={ROWS[0]} />);
    fireEvent.click(screen.getByRole("button", { name: "2 queued · Base" }));
    await screen.findByRole("dialog", { name: "Batch on Base" });

    const alert = screen.getByRole("alert");
    expect(alert.textContent).toMatch(/Set the buyback hook before registering its pool/);
    const first = screen.getByRole("list", { name: "Batch steps" }).querySelector(":scope > li")!;
    expect(first.contains(alert)).toBe(true);
    expect(screen.getByRole("button", { name: "Send 2 transactions" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Move step 1 up" })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Move step 2 up" }));
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
    expect(readBatch(8453, 6).map((step) => step.kind)).toEqual(["setHookFor", "setPoolFor"]);
    expect(screen.getByRole("button", { name: "Send 2 transactions" })).not.toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Move step 1 down" }));
    await screen.findByRole("alert");
    expect(readBatch(8453, 6).map((step) => step.kind)).toEqual(["setPoolFor", "setHookFor"]);
  });

  it("removes a step from storage and updates the chip", async () => {
    writeBatch(8453, 6, [hookStep(), terminalStep()]);
    render(<SafeBatchTray rows={ROWS} fallbackProject={ROWS[0]} />);
    fireEvent.click(screen.getByRole("button", { name: "2 queued · Base" }));
    await screen.findByRole("dialog", { name: "Batch on Base" });

    fireEvent.click(screen.getByRole("button", { name: "Remove step 1" }));
    await waitFor(() =>
      expect(readBatch(8453, 6).map((step) => step.kind)).toEqual(["setTerminalFor"]),
    );
    expect(screen.getByRole("button", { name: "1 queued · Base" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Send 1 transaction" })).toBeTruthy();
  });

  it("submits the queued steps through the routed path and clears the chain on success", async () => {
    mocks.submit.mockResolvedValue({ kind: "sent", transactions: 2 });
    writeBatch(8453, 6, [hookStep(), terminalStep()]);
    render(<SafeBatchTray rows={ROWS} fallbackProject={ROWS[0]} />);
    fireEvent.click(screen.getByRole("button", { name: "2 queued · Base" }));
    await screen.findByRole("dialog", { name: "Batch on Base" });

    fireEvent.click(screen.getByRole("button", { name: "Send 2 transactions" }));
    await waitFor(() => expect(mocks.submit).toHaveBeenCalledTimes(1));
    expect(mocks.submit.mock.calls[0]![0]).toMatchObject({
      chainId: 8453,
      route: { kind: "eoa" },
      steps: [
        expect.objectContaining({ kind: "setHookFor" }),
        expect.objectContaining({ kind: "setTerminalFor" }),
      ],
    });
    await waitFor(() => expect(readBatch(8453, 6)).toEqual([]));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("stages a preset's resolved steps per chain and adds them to the batch without submitting", async () => {
    mocks.preset.steps = [hookStep(), poolStep(), terminalStep()];
    render(<SafeBatchTray rows={ROWS} fallbackProject={ROWS[0]} />);
    fireEvent.click(screen.getByRole("button", { name: "Presets" }));
    const dialog = await screen.findByRole("dialog", { name: "Move to buyback 1.4.0 + gateway" });
    expect(dialog.textContent).toContain("Register buyback pool");

    const windowInput = screen.getByRole("textbox", {
      name: "TWAP window on Base",
    }) as HTMLInputElement;
    expect(windowInput.value).toBe("1800");
    fireEvent.change(windowInput, { target: { value: "900" } });

    // Both chains are pre-checked; drop Optimism and add Base's three.
    const optimism = screen.getByRole("checkbox", { name: "Optimism" });
    fireEvent.click(optimism);
    fireEvent.click(screen.getByRole("button", { name: "Add 3 steps to batch" }));

    await waitFor(() => expect(readBatch(8453, 6)).toHaveLength(3));
    expect(readBatch(8453, 6)[1]!.values.twapWindow).toBe(900n);
    expect(mocks.submit).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "3 queued · Base" })).toBeTruthy();
  });
});
