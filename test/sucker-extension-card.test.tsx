import { SuckerExtensionCard } from "@/app/[slug]/components/v6/operator/SuckerExtensionCard";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const CONFIG_HASH = `0x${"ab".repeat(32)}`;

const mocks = vi.hoisted(() => ({ runWrites: vi.fn(), read: vi.fn() }));

vi.mock("@/lib/wagmiConfig", () => ({ wagmiConfig: {} }));
vi.mock("wagmi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("wagmi")>()),
  useAccount: () => ({ address: "0x2222222222222222222222222222222222222222" }),
}));
vi.mock("@/app/[slug]/components/v6/operator/useOperatorWrites", () => ({
  useOperatorWrites: () => ({ runWrites: mocks.runWrites }),
}));
vi.mock("@/app/[slug]/components/v6/operator/useLiveRevnetOperators", () => ({
  useLiveRevnetOperators: () => ({
    operatorByChain: new Map([[1, "0x2222222222222222222222222222222222222222"]]),
    isLoading: false,
  }),
}));
// The configuration-hash and accounting reads go to each chain's RPC.
vi.mock("@/app/[slug]/components/v6/operator/operatorLib", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/app/[slug]/components/v6/operator/operatorLib")>()),
  publicClientFor: () => ({ readContract: mocks.read }),
}));
vi.mock("@/app/[slug]/components/v6/operator/suckerExtensionLib", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@/app/[slug]/components/v6/operator/suckerExtensionLib")
  >()),
  buildSuckerExtensionWrites: () => [{ chainId: 1, label: "Deploy suckers" }],
}));
vi.mock("@/lib/suckerExtensionSalt", () => ({
  saltForExtension: () => `0x${"11".repeat(32)}`,
  clearExtensionSalt: vi.fn(),
}));
vi.mock("@/hooks/useReviewedWriteContract", () => ({
  isSafeProposalPendingError: (error: unknown) =>
    error instanceof Error && error.name === "SafeProposalPendingError",
}));
vi.mock("@/components/ProjectIdInput", () => ({
  ProjectIdInput: ({
    value,
    onChange,
    ariaLabel,
  }: {
    value: string;
    onChange: (value: string) => void;
    ariaLabel: string;
  }) => <input aria-label={ariaLabel} value={value} onChange={(e) => onChange(e.target.value)} />,
}));
vi.mock("@/components/ChainLogo", () => ({ ChainLogo: () => null }));
vi.mock("@/components/ui/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@/components/ButtonWithWallet", () => ({
  ButtonWithWallet: ({
    children,
    connectWalletText: _connect,
    loading: _loading,
    targetChainId: _chain,
    ...props
  }: {
    children: ReactNode;
    connectWalletText?: string;
    loading?: boolean;
    targetChainId?: number;
  }) => <button {...props}>{children}</button>,
}));

/** Picks Base and project 9, and opens the extension's confirm. */
async function openConfirm() {
  render(<SuckerExtensionCard rows={[{ chainId: 1, projectId: 4 }]} />);
  fireEvent.click(screen.getByRole("button", { name: "Extend to another chain" }));
  fireEvent.click(screen.getByRole("combobox", { name: "Target chain" }));
  fireEvent.click(await screen.findByRole("option", { name: "Base" }));
  fireEvent.change(screen.getByRole("textbox", { name: "Project ID on the target chain" }), {
    target: { value: "9" },
  });
  fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.click(screen.getByRole("button", { name: "Deploy suckers" }));
  return (await screen.findByRole("dialog", { name: "Confirm suckers" })) as HTMLDialogElement;
}

beforeEach(() => {
  mocks.read.mockImplementation(async ({ functionName }: { functionName: string }) =>
    functionName === "hashedEncodedConfigurationOf" ? CONFIG_HASH : [],
  );
  mocks.runWrites.mockResolvedValue({ chains: 2, safeQueued: 0, safeConfirmed: 0 });
});

describe("extend to another chain confirm", () => {
  it("goes back to the form with Cancel, and sends nothing", async () => {
    const confirm = await openConfirm();

    fireEvent.click(within(confirm).getByRole("button", { name: "Cancel" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.getByRole("textbox", { name: "Project ID on the target chain" })).toHaveValue(
      "9",
    );
    expect(mocks.read).not.toHaveBeenCalled();
    expect(mocks.runWrites).not.toHaveBeenCalled();
  });

  it("wallet-action:operator-writes refuses every way out from Confirm through the configuration check and the sends", async () => {
    let answer!: () => void;
    const held = new Promise<void>((resolve) => (answer = resolve));
    mocks.read.mockImplementation(async ({ functionName }: { functionName: string }) => {
      await held;
      return functionName === "hashedEncodedConfigurationOf" ? CONFIG_HASH : [];
    });
    const confirm = await openConfirm();
    fireEvent.click(within(confirm).getByRole("button", { name: "Deploy suckers" }));
    await waitFor(() => expect(mocks.read).toHaveBeenCalled());

    const cancel = within(confirm).getByRole("button", { name: "Cancel" });
    const close = within(confirm).getByRole("button", { name: "Close" });
    expect(cancel).toBeDisabled();
    expect(close).toBeDisabled();
    fireEvent.click(cancel);
    fireEvent.click(close);
    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.pointerDown(confirm);
    expect(screen.getByRole("dialog", { name: "Confirm suckers" })).toBe(confirm);
    expect(mocks.runWrites).not.toHaveBeenCalled();

    await act(async () => answer());
    await waitFor(() => expect(mocks.runWrites).toHaveBeenCalledOnce());
    // Landed on every chain: the confirm and the form close.
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.getByRole("button", { name: "Extend to another chain" })).toBeEnabled();
  });

  it("ends on Done when the deployment went to the Safe as a proposal", async () => {
    mocks.runWrites.mockRejectedValue(
      Object.assign(new Error("Deploy suckers was proposed to Safe."), {
        name: "SafeProposalPendingError",
      }),
    );
    const confirm = await openConfirm();
    fireEvent.click(within(confirm).getByRole("button", { name: "Deploy suckers" }));

    const done = await within(confirm).findByRole("button", { name: "Done" });
    expect(confirm).toHaveTextContent("Deploy suckers was proposed to Safe.");
    expect(within(confirm).queryByRole("button", { name: "Deploy suckers" })).toBeNull();
    fireEvent.click(done);

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.getByText("Deploy suckers was proposed to Safe.")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(mocks.runWrites).toHaveBeenCalledOnce();
  });
});
