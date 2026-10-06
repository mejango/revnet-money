import { V6BurnTokensDialog } from "@/app/[slug]/components/v6/owners/accounts/V6BurnTokensDialog";
import type { JBChainId } from "@bananapus/nana-sdk-core";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import type { Address, Hex } from "viem";
import { beforeEach, describe, expect, it, vi } from "vitest";

// wallet-action:burn
// wallet-action:burn-tokens

const CONTROLLER = "0x2222222222222222222222222222222222222222" as Address;
const HASH = `0x${"cd".repeat(32)}` as Hex;
/** A burn proposed to a Safe whose result the app can't confirm. */
const PROPOSAL = `0x${"ce".repeat(32)}` as Hex;

const mocks = vi.hoisted(() => ({
  read: vi.fn(),
  write: vi.fn(),
}));

vi.mock("wagmi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("wagmi")>()),
  useAccount: () => ({ address: "0x1111111111111111111111111111111111111111" }),
  usePublicClient: () => ({ readContract: mocks.read }),
}));
vi.mock("@/components/ButtonWithWallet", () => ({
  ButtonWithWallet: ({
    children,
    loading: _loading,
    targetChainId: _chain,
    variant: _variant,
    ...props
  }: {
    children: ReactNode;
    loading?: boolean;
    targetChainId?: unknown;
    variant?: string;
  }) => <button {...props}>{children}</button>,
}));
vi.mock("@/components/ChainLogo", () => ({ ChainLogo: () => null }));
vi.mock("@/components/ui/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@/hooks/useReviewedWriteContract", async (importOriginal) => ({
  SAFE_PROPOSAL_UNCONFIRMED_LINE: (
    await importOriginal<typeof import("@/hooks/useReviewedWriteContract")>()
  ).SAFE_PROPOSAL_UNCONFIRMED_LINE,
  // A burn's own Safe proposal ends where the app can't confirm its result.
  useWaitForTransactionReceipt: ({ hash }: { hash?: Hex }) => ({
    isLoading: false,
    isSuccess: false,
    isSafeResultUnconfirmed: hash === PROPOSAL,
  }),
  useWriteContract: () => ({ writeContractAsync: mocks.write }),
}));

const confirmPanel = () => document.querySelector<HTMLElement>("[data-tx-confirm]");
const burnDialog = () => screen.getByRole("dialog", { name: "Burn tokens" }) as HTMLDialogElement;
/** The burn dialog's own ×, hidden while the confirm replaces its content. */
const dialogClose = () =>
  [...burnDialog().querySelectorAll<HTMLButtonElement>("button")].find(
    (button) => !button.closest("[data-tx-confirm]") && button.textContent === "Close",
  )!;

/** Holds the first read (the balance check before the prompt) until the test answers it. */
function heldRead() {
  let answer!: () => void;
  const held = new Promise<void>((resolve) => {
    answer = resolve;
  });
  let first = true;
  mocks.read.mockImplementation(async ({ functionName }: { functionName: string }) => {
    if (first) {
      first = false;
      await held;
    }
    return functionName === "totalBalanceOf" ? 10n ** 21n : CONTROLLER;
  });
  return answer;
}

async function openConfirm() {
  render(
    <V6BurnTokensDialog
      rows={[{ chainId: 8453 as JBChainId, projectId: 4n, balance: 10n ** 21n }]}
      tokenSymbol="ART"
    >
      <button>Burn</button>
    </V6BurnTokensDialog>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Burn" }));
  fireEvent.change(await screen.findByPlaceholderText("Amount of ART"), {
    target: { value: "10" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Burn permanently" }));
  await waitFor(() => expect(confirmPanel()).not.toBeNull());
  return confirmPanel()!;
}

beforeEach(() => {
  mocks.read.mockImplementation(async ({ functionName }: { functionName: string }) =>
    functionName === "totalBalanceOf" ? 10n ** 21n : CONTROLLER,
  );
  mocks.write.mockResolvedValue(HASH);
});

describe("burn tokens confirm", () => {
  it("goes back to the amount with Cancel, and sends nothing", async () => {
    const confirm = await openConfirm();

    fireEvent.click(within(confirm).getByRole("button", { name: "Cancel" }));

    expect(confirmPanel()).toBeNull();
    expect(screen.getByPlaceholderText("Amount of ART")).toBeVisible();
    expect(mocks.read).not.toHaveBeenCalled();
    expect(mocks.write).not.toHaveBeenCalled();
  });

  it("refuses every way out from Confirm through the reads before the wallet prompt", async () => {
    const answerRead = heldRead();
    // Every send happens with the confirm on screen, never after a close.
    mocks.write.mockImplementation(async () => {
      expect(confirmPanel()).not.toBeNull();
      return HASH;
    });
    const confirm = await openConfirm();

    fireEvent.click(within(confirm).getByRole("button", { name: "Burn permanently" }));
    await waitFor(() => expect(mocks.read).toHaveBeenCalled());
    const cancel = within(confirm).getByRole("button", { name: "Cancel" });
    const close = within(confirm).getByRole("button", { name: "Close" });
    expect(cancel).toBeDisabled();
    expect(close).toBeDisabled();
    fireEvent.click(cancel);
    fireEvent.click(close);
    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.pointerDown(burnDialog());
    fireEvent.click(dialogClose());
    expect(burnDialog().open).toBe(true);
    expect(confirmPanel()).toBe(confirm);
    expect(mocks.write).not.toHaveBeenCalled();

    answerRead();
    await waitFor(() => expect(mocks.write).toHaveBeenCalledOnce());
    expect(mocks.write.mock.calls[0][0]).toMatchObject({ chainId: 8453, address: CONTROLLER });
    // Submitted: the confirm closes on its own, back to the burn form.
    await waitFor(() => expect(confirmPanel()).toBeNull());
    expect(burnDialog().open).toBe(true);
  });
});

describe("wallet-action:burn — a burn left open over its own Safe proposal the app can't confirm", () => {
  it("says to check the proposal in Safe", async () => {
    mocks.write.mockResolvedValue(PROPOSAL);
    render(
      <V6BurnTokensDialog
        rows={[{ chainId: 1 as JBChainId, projectId: 7n, balance: 10n ** 21n }]}
        tokenSymbol="REV"
      >
        <button type="button">Open burn</button>
      </V6BurnTokensDialog>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Open burn" }));
    fireEvent.change(await screen.findByPlaceholderText("Amount of REV"), {
      target: { value: "1" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Burn permanently" }));
    await waitFor(() => expect(confirmPanel()).not.toBeNull());
    const confirm = confirmPanel()!;

    fireEvent.click(within(confirm).getByRole("button", { name: "Burn permanently" }));

    await waitFor(() => expect(mocks.write).toHaveBeenCalledTimes(1));
    await screen.findByText(
      "This step's Safe proposal can't be confirmed here. Check it in Safe, then dismiss it in your account activity.",
    );
  });
});
