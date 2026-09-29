import { TransactionReviewProvider } from "@/components/TransactionReviewProvider";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import type { ChainPayment } from "@/lib/nana/types";
import {
  chooseRelayrPayment,
  fundingChainLabel,
  requireFundingChainSelection,
  requireTransactionReview,
  TransactionReviewCancelledError,
} from "@/lib/transaction-review";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import { encodeFunctionData } from "viem";
import { describe, expect, it, vi } from "vitest";
import { isBlockedByModalDialog, openModalDialogs } from "./native-dialog-shim";

const relayrPayments: ChainPayment[] = [
  {
    chain: 8453,
    amount: "0x6d23ad5f8000",
    calldata: "0x12345678",
    payment_deadline: "2030-01-01T00:00:00Z",
    target: "0x2222222222222222222222222222222222222222",
    token: "0x0000000000000000000000000000000000000000",
  },
  {
    chain: 10,
    amount: "0x110d9316ec000",
    calldata: "0x87654321",
    payment_deadline: "2030-01-01T00:00:00Z",
    target: "0x3333333333333333333333333333333333333333",
    token: "0x0000000000000000000000000000000000000000",
  },
];
const BASE_FEE = "Base (0.00012 ETH)";
const OPTIMISM_FEE = "Optimism (0.0003 ETH)";
const PICKER = "Choose where to pay";

vi.mock("@/hooks/useReviewedRelayr", () => ({
  resumePendingRelayrBundles: vi.fn(),
  waitForRelayrBundle: vi.fn(),
}));

vi.mock("@/hooks/useReviewedWriteContract", () => ({
  resumeSafeProposalTracking: vi.fn(),
}));

vi.mock("@/lib/transaction-activity", () => ({
  dismissTransactionActivity: vi.fn(),
  updateTransactionActivity: vi.fn(),
  useTransactionActivities: () => [],
}));

vi.mock("wagmi", () => ({
  useAccount: () => ({
    address: "0x1111111111111111111111111111111111111111",
  }),
}));

describe("TransactionReviewProvider", () => {
  it("serves any funding-chain choice with one picker", async () => {
    render(<TransactionReviewProvider>{null}</TransactionReviewProvider>);
    const choice = requireFundingChainSelection(
      [
        { chainId: 1, label: fundingChainLabel("Ethereum", 10n ** 18n) },
        { chainId: 8453, label: fundingChainLabel("Base", 10n ** 15n) },
      ],
      8453,
    );

    const dialog = await screen.findByRole("dialog", { name: PICKER });
    expect(dialog).toHaveAccessibleDescription(
      "One payment covers every chain. You'll review it before your wallet sends it.",
    );
    expect(screen.getByRole("combobox", { name: "Pay on" })).toHaveTextContent("Base (0.001 ETH)");
    fireEvent.click(screen.getByRole("button", { name: "Continue to payment review" }));
    await expect(choice).resolves.toBe(8453);
  });

  it("asks where to pay with the connected chain preselected and lets the user change it", async () => {
    render(<TransactionReviewProvider>{null}</TransactionReviewProvider>);
    const selected = vi.fn();
    const choice = chooseRelayrPayment(relayrPayments, 8453).then(selected);

    const dialog = await screen.findByRole("dialog", { name: PICKER });
    const picker = screen.getByRole("combobox", { name: "Pay on" });
    expect(picker).toHaveTextContent(BASE_FEE);
    expect(selected).not.toHaveBeenCalled();

    fireEvent.click(picker);
    expect(screen.getAllByRole("option").map((option) => option.textContent)).toEqual([
      BASE_FEE,
      OPTIMISM_FEE,
    ]);
    const option = screen.getByRole("option", { name: OPTIMISM_FEE });
    expect(isBlockedByModalDialog(option)).toBe(false);
    expect(dialog.contains(option)).toBe(true);
    fireEvent.click(option);
    expect(picker).toHaveTextContent(OPTIMISM_FEE);
    expect(selected).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Continue to payment review" }));
    await choice;
    expect(selected).toHaveBeenCalledExactlyOnceWith(relayrPayments[1]);
  });

  it("preselects a lone quote when the connected chain is not quoted", async () => {
    render(<TransactionReviewProvider>{null}</TransactionReviewProvider>);
    const choice = chooseRelayrPayment([relayrPayments[0]], 42161);

    await screen.findByRole("dialog", { name: PICKER });
    expect(screen.getByRole("combobox", { name: "Pay on" })).toHaveTextContent(BASE_FEE);
    fireEvent.click(screen.getByRole("button", { name: "Continue to payment review" }));
    await expect(choice).resolves.toBe(relayrPayments[0]);
  });

  it("selects nothing when several chains are quoted and none is connected", async () => {
    render(<TransactionReviewProvider>{null}</TransactionReviewProvider>);
    const choice = chooseRelayrPayment(relayrPayments, 42161);

    await screen.findByRole("dialog", { name: PICKER });
    const picker = screen.getByRole("combobox", { name: "Pay on" });
    const confirm = screen.getByRole("button", { name: "Continue to payment review" });
    expect(picker).toHaveTextContent("Choose a chain");
    expect(confirm).toBeDisabled();

    fireEvent.click(picker);
    fireEvent.click(screen.getByRole("option", { name: BASE_FEE }));
    expect(confirm).toBeEnabled();
    fireEvent.click(confirm);
    await expect(choice).resolves.toBe(relayrPayments[0]);
  });

  it.each([
    ["Cancel", () => fireEvent.click(screen.getByRole("button", { name: "Cancel" }))],
    ["the close button", () => fireEvent.click(screen.getByRole("button", { name: "Close" }))],
    ["Escape", () => fireEvent.keyDown(document, { key: "Escape" })],
    ["the backdrop", () => fireEvent.pointerDown(screen.getByRole("dialog", { name: PICKER }))],
  ])("cancels the funding choice from %s without paying", async (_, dismiss) => {
    render(<TransactionReviewProvider>{null}</TransactionReviewProvider>);
    const choice = chooseRelayrPayment(relayrPayments, 8453);
    const cancelled = expect(choice).rejects.toBeInstanceOf(TransactionReviewCancelledError);

    await screen.findByRole("dialog", { name: PICKER });
    dismiss();

    await cancelled;
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("queues the funding choice behind an open review", async () => {
    render(<TransactionReviewProvider>{null}</TransactionReviewProvider>);
    const review = requireTransactionReview({
      title: "Review authorization",
      calls: [{ chainId: 8453, to: `0x${"22".repeat(20)}`, data: "0x12345678" }],
    });
    const choice = chooseRelayrPayment(relayrPayments, 10);

    await screen.findByRole("dialog", { name: "Review authorization" });
    expect(screen.queryByRole("dialog", { name: PICKER })).toBeNull();

    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Agree & continue" }));
    await expect(review).resolves.toBeUndefined();

    await screen.findByRole("dialog", { name: PICKER });
    expect(screen.getByRole("combobox", { name: "Pay on" })).toHaveTextContent(OPTIMISM_FEE);
    fireEvent.click(screen.getByRole("button", { name: "Continue to payment review" }));
    await expect(choice).resolves.toBe(relayrPayments[1]);
  });

  it("resets the chosen funding chain when a queued request opens", async () => {
    render(<TransactionReviewProvider>{null}</TransactionReviewProvider>);
    const first = chooseRelayrPayment(relayrPayments, 8453);
    const second = chooseRelayrPayment(relayrPayments);
    const canceledSecond = expect(second).rejects.toBeInstanceOf(TransactionReviewCancelledError);

    await screen.findByRole("dialog", { name: PICKER });
    fireEvent.click(screen.getByRole("button", { name: "Continue to payment review" }));
    await expect(first).resolves.toBe(relayrPayments[0]);

    await waitFor(() => expect(screen.getByRole("combobox")).toHaveTextContent("Choose a chain"));
    expect(screen.getByRole("button", { name: "Continue to payment review" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await canceledSecond;
  });

  it("cancels active and queued requests when the provider unmounts", async () => {
    const { unmount } = render(<TransactionReviewProvider>{null}</TransactionReviewProvider>);
    const first = expect(chooseRelayrPayment(relayrPayments, 8453)).rejects.toBeInstanceOf(
      TransactionReviewCancelledError,
    );
    const second = expect(
      requireTransactionReview({
        calls: [{ chainId: 8453, to: `0x${"22".repeat(20)}`, data: "0x12345678" }],
      }),
    ).rejects.toBeInstanceOf(TransactionReviewCancelledError);

    await screen.findByRole("dialog", { name: PICKER });
    unmount();

    await Promise.all([first, second]);
  });

  it("opens above the app shell in the top layer and keeps its actions interactive", async () => {
    const writeText = vi.fn(async () => undefined);
    vi.stubGlobal("navigator", {
      ...navigator,
      clipboard: { writeText },
    });

    render(
      <div data-testid="app-shell">
        <TransactionReviewProvider>
          <p>Payment confirmation</p>
        </TransactionReviewProvider>
      </div>,
    );

    const shell = screen.getByTestId("app-shell");

    const review = requireTransactionReview({
      title: "Review approve",
      calls: [
        {
          chainId: 8453,
          to: "0x2222222222222222222222222222222222222222",
          data: "0x12345678",
        },
      ],
    });

    const dialog = await screen.findByRole("dialog", { name: "Review approve" });
    expect(screen.getByRole("heading", { name: "Review approve" })).toBeInTheDocument();
    expect(shell.contains(dialog)).toBe(false);
    expect(isBlockedByModalDialog(dialog)).toBe(false);
    expect(isBlockedByModalDialog(shell)).toBe(true);
    expect(dialog).toHaveFocus();

    fireEvent.click(screen.getByRole("button", { name: "[copy tx audit prompt]" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole("checkbox"));
    const approve = screen.getByRole("button", { name: "Agree & continue" });
    expect(approve).toBeEnabled();
    fireEvent.click(approve);

    await expect(review).resolves.toBeUndefined();
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("stays interactive above an open pay dialog whose card keeps re-rendering", async () => {
    function PayFlow({ tick: _tick }: { tick: number }) {
      const [open, setOpen] = useState(false);
      return (
        <TransactionReviewProvider>
          <button onClick={() => setOpen(true)}>Open pay</button>
          <Dialog open={open} onOpenChange={(next) => setOpen(next)}>
            <DialogContent>
              <DialogTitle>Pay</DialogTitle>
              <button>Pay now</button>
            </DialogContent>
          </Dialog>
        </TransactionReviewProvider>
      );
    }

    const { rerender } = render(<PayFlow tick={0} />);
    fireEvent.click(screen.getByRole("button", { name: "Open pay" }));
    await screen.findByRole("dialog", { name: "Pay" });

    const review = requireTransactionReview({
      title: "Review pay",
      calls: [{ chainId: 8453, to: `0x${"22".repeat(20)}`, data: "0x12345678" }],
    });
    const dialog = await screen.findByRole("dialog", { name: "Review pay" });

    // The pay card re-renders on every quote refresh while the review is open.
    for (let renderCount = 1; renderCount <= 3; renderCount += 1) {
      rerender(<PayFlow tick={renderCount} />);
    }

    expect(openModalDialogs().at(-1)).toBe(dialog);
    expect(isBlockedByModalDialog(dialog)).toBe(false);
    expect(isBlockedByModalDialog(screen.getByRole("dialog", { name: "Pay", hidden: true }))).toBe(
      true,
    );

    fireEvent.click(screen.getByRole("checkbox"));
    const approve = screen.getByRole("button", { name: "Agree & continue" });
    expect(approve).toBeEnabled();
    fireEvent.click(approve);
    await expect(review).resolves.toBeUndefined();
  });

  it("hands the top layer back to the pay dialog once the review is answered", async () => {
    function Shell() {
      const [open, setOpen] = useState(false);
      return (
        <TransactionReviewProvider>
          <button onClick={() => setOpen(true)}>Open pay</button>
          <Dialog open={open} onOpenChange={(next) => setOpen(next)}>
            <DialogContent>
              <DialogTitle>Pay</DialogTitle>
              <button>Pay now</button>
            </DialogContent>
          </Dialog>
        </TransactionReviewProvider>
      );
    }

    render(<Shell />);
    fireEvent.click(screen.getByRole("button", { name: "Open pay" }));
    const payDialog = await screen.findByRole("dialog", { name: "Pay" });

    const review = requireTransactionReview({
      title: "Review pay",
      calls: [{ chainId: 8453, to: `0x${"22".repeat(20)}`, data: "0x12345678" }],
    });
    await screen.findByRole("dialog", { name: "Review pay" });
    expect(isBlockedByModalDialog(payDialog)).toBe(true);

    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Agree & continue" }));
    await expect(review).resolves.toBeUndefined();

    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Review pay" })).toBeNull());
    expect(openModalDialogs()).toEqual([payDialog]);
    expect(isBlockedByModalDialog(screen.getByRole("button", { name: "Pay now" }))).toBe(false);
    expect(document.body.style.overflow).toBe("hidden");
  });

  it("never renders an empty guidance banner when the description is blank", async () => {
    render(<TransactionReviewProvider>{null}</TransactionReviewProvider>);

    void requireTransactionReview({
      title: "Review pay",
      description: "   ",
      calls: [{ chainId: 8453, to: `0x${"22".repeat(20)}`, data: "0x12345678" }],
    }).catch(() => undefined);

    const dialog = await screen.findByRole("dialog", { name: "Review pay" });
    for (const paragraph of dialog.querySelectorAll("p")) {
      expect(paragraph.textContent?.trim()).not.toBe("");
    }
    expect(
      screen.getByText(/These are the exact app-controlled fields your wallet will be asked/),
    ).toBeInTheDocument();
  });

  it("shows a caller-supplied description instead of the default guidance", async () => {
    render(<TransactionReviewProvider>{null}</TransactionReviewProvider>);

    void requireTransactionReview({
      title: "Review pay",
      description: "This Safe proposal executes later.",
      calls: [{ chainId: 8453, to: `0x${"22".repeat(20)}`, data: "0x12345678" }],
    }).catch(() => undefined);

    await screen.findByRole("dialog", { name: "Review pay" });
    expect(screen.getByText("This Safe proposal executes later.")).toBeInTheDocument();
    expect(
      screen.queryByText(/These are the exact app-controlled fields your wallet will be asked/),
    ).toBeNull();
  });

  it("labels the Permit2 approval destination, USDC token, and Uniswap spender", async () => {
    const abi = [
      {
        type: "function",
        name: "approve",
        stateMutability: "nonpayable",
        inputs: [
          { name: "token", type: "address" },
          { name: "spender", type: "address" },
          { name: "amount", type: "uint160" },
          { name: "expiration", type: "uint48" },
        ],
        outputs: [],
      },
    ] as const;
    const args = [
      "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      "0x6fF5693b99212Da76ad316178A184AB56D299b43",
      50_000_000n,
      1_800_000_000,
    ] as const;
    render(<TransactionReviewProvider>{null}</TransactionReviewProvider>);

    void requireTransactionReview({
      calls: [
        {
          chainId: 8453,
          to: "0x000000000022D473030F116dDEE9F6B43aC78BA3",
          data: encodeFunctionData({ abi, functionName: "approve", args }),
          abi,
          functionName: "approve",
          args,
        },
      ],
    }).catch(() => undefined);

    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("Permit2 | 0x000000000022D473030F116dDEE9F6B43aC78BA3");
    expect(dialog).toHaveTextContent("USDC |");
    expect(dialog).toHaveTextContent("Uniswap Universal Router |");
  });

  it("shows each call's Safe gas and gas limit, and warns when a failed call still executes", async () => {
    render(<TransactionReviewProvider>{null}</TransactionReviewProvider>);
    const to = `0x${"22".repeat(20)}` as const;

    void requireTransactionReview({
      title: "Review gas",
      calls: [
        { chainId: 8453, to, data: "0x12345678", safeTxGas: 0n, gas: 1_234_567n },
        { chainId: 8453, to, data: "0x12345678", safeTxGas: 50_000n },
        { chainId: 8453, to, data: "0x12345678" },
      ],
    }).catch(() => undefined);

    const dialog = await screen.findByRole("dialog", { name: "Review gas" });
    const [zeroSafeGas, nonzeroSafeGas, noGas] = dialog.querySelectorAll("section");
    const row = (card: Element, label: string) =>
      within(card as HTMLElement).queryByText(`${label}:`)?.nextElementSibling;
    const warning = "If this call fails, the Safe still executes and uses this nonce.";

    expect(row(zeroSafeGas, "Safe gas")).toHaveTextContent(/^0$/);
    expect(row(zeroSafeGas, "Gas limit")).toHaveTextContent(/^1,234,567$/);
    expect(within(zeroSafeGas as HTMLElement).queryByText(warning)).toBeNull();

    expect(row(nonzeroSafeGas, "Safe gas")).toHaveTextContent(`50,000${warning}`);
    expect(row(nonzeroSafeGas, "Gas limit")).toBeUndefined();

    expect(row(noGas, "Safe gas")).toBeUndefined();
    expect(row(noGas, "Gas limit")).toBeUndefined();
    expect(dialog).not.toHaveTextContent(
      /Preflight gas limit|Safe transaction gas|signed envelope/,
    );
  });

  it("keeps the signed authorization in the request-wide and single-call prompts", async () => {
    const writeText = vi.fn(async (_text: string) => undefined);
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
    render(<TransactionReviewProvider>{null}</TransactionReviewProvider>);

    void requireTransactionReview({
      kind: "authorization",
      title: "Review Relayr authorization",
      authorization: { primaryType: "ForwardRequest", nonce: 7n },
      calls: [{ chainId: 8453, to: `0x${"22".repeat(20)}`, data: "0x12345678" }],
    }).catch(() => undefined);

    const dialog = await screen.findByRole("dialog", { name: "Review Relayr authorization" });
    expect(within(dialog).getByText("Raw transaction payload")).toBeInTheDocument();
    const prompts = within(dialog).getAllByRole("button", { name: "[copy tx audit prompt]" });
    expect(prompts).toHaveLength(2);

    for (const prompt of prompts) fireEvent.click(prompt);
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(2));
    for (const [copied] of writeText.mock.calls) {
      expect(copied).toContain('"primaryType": "ForwardRequest"');
      expect(copied).toContain('"resultingCall"');
    }
  });

  it("shows a lone call's prompt and raw data only on its card", async () => {
    render(<TransactionReviewProvider>{null}</TransactionReviewProvider>);

    void requireTransactionReview({
      title: "Review one call",
      calls: [{ chainId: 8453, to: `0x${"22".repeat(20)}`, data: "0x12345678" }],
    }).catch(() => undefined);

    const dialog = await screen.findByRole("dialog", { name: "Review one call" });
    expect(within(dialog).queryByText("Raw transaction payload")).toBeNull();
    expect(within(dialog).getAllByRole("button", { name: "[copy tx audit prompt]" })).toHaveLength(
      1,
    );
  });
});
