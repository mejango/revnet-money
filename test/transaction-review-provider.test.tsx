import { TransactionReviewProvider } from "@/components/TransactionReviewProvider";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { requireTransactionReview } from "@/lib/transaction-review";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { isBlockedByModalDialog, openModalDialogs } from "./native-dialog-shim";

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
    expect(screen.getByRole("button", { name: "Close review" })).toHaveFocus();

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
});
