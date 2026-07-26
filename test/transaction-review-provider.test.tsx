import { TransactionReviewProvider } from "@/components/TransactionReviewProvider";
import { requireTransactionReview } from "@/lib/transaction-review";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

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
  it("portals the review above inert app content and keeps its actions interactive", async () => {
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
    shell.setAttribute("inert", "");

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

    const dialog = await screen.findByRole("dialog");
    expect(screen.getByRole("heading", { name: "Review approve" })).toBeInTheDocument();
    expect(shell.contains(dialog)).toBe(false);
    expect(dialog.closest("[inert]")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "[copy tx audit prompt]" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole("checkbox"));
    const approve = screen.getByRole("button", { name: "Agree & continue" });
    expect(approve).toBeEnabled();
    fireEvent.click(approve);

    await expect(review).resolves.toBeUndefined();
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });
});
