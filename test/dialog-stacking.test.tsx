import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

/**
 * jsdom implements neither the `inert` attribute nor its property reflection,
 * so mirror the browser rule directly: a node is unusable when it or any
 * ancestor is inert, and a click inside an inert subtree never reaches it.
 */
function isInert(element: Element | null): boolean {
  for (let node: Element | null = element; node; node = node.parentElement) {
    if (node.hasAttribute("inert")) return true;
    if ((node as HTMLElement).inert === true) return true;
  }
  return false;
}

function click(element: HTMLElement) {
  if (isInert(element)) return;
  fireEvent.click(element);
}

function portalOf(dialogName: string): HTMLElement {
  const portal = screen
    // `hidden: true` so a covered dialog can still be inspected.
    .getByRole("dialog", { name: dialogName, hidden: true })
    .closest<HTMLElement>("[data-ui-dialog-portal]");
  if (!portal) throw new Error(`no portal for ${dialogName}`);
  return portal;
}

/**
 * The production shape: a payment dialog whose parent re-renders continuously
 * (quote polling, amount input) while a review dialog sits on top of it. Every
 * callback is an inline arrow, so each render hands the dialog new identities.
 */
function StackedDialogs({
  agree,
  autoFocus = false,
  tick: _tick = 0,
}: {
  agree: () => void;
  autoFocus?: boolean;
  tick?: number;
}) {
  const [payOpen, setPayOpen] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const suppressAutoFocus = autoFocus ? undefined : (event: Event) => event.preventDefault();
  return (
    <div>
      <button onClick={() => setPayOpen(true)}>Open pay</button>
      <Dialog open={payOpen} onOpenChange={(next) => setPayOpen(next)}>
        <DialogContent
          onOpenAutoFocus={(event) => suppressAutoFocus?.(event)}
          onCloseAutoFocus={(event) => suppressAutoFocus?.(event)}
          onEscapeKeyDown={() => undefined}
        >
          <DialogTitle>Pay</DialogTitle>
          <button onClick={() => setReviewOpen(true)}>Open review</button>
          <button onClick={agree}>Pay now</button>
        </DialogContent>
      </Dialog>
      <Dialog open={reviewOpen} onOpenChange={(next) => setReviewOpen(next)}>
        <DialogContent
          onOpenAutoFocus={(event) => suppressAutoFocus?.(event)}
          onCloseAutoFocus={(event) => suppressAutoFocus?.(event)}
          onEscapeKeyDown={() => undefined}
        >
          <DialogTitle>Review</DialogTitle>
          <input aria-label="I reviewed the calldata" type="checkbox" />
          <button onClick={agree}>Agree and continue</button>
          <button onClick={() => setReviewOpen(false)}>Cancel</button>
        </DialogContent>
      </Dialog>
    </div>
  );
}

describe("stacked dialogs", () => {
  it("keeps the top dialog interactive when the dialog underneath re-renders", async () => {
    const agree = vi.fn();
    const { rerender } = render(<StackedDialogs agree={agree} tick={0} />);

    click(screen.getByRole("button", { name: "Open pay" }));
    await screen.findByRole("dialog", { name: "Pay" });
    click(screen.getByRole("button", { name: "Open review" }));
    await screen.findByRole("dialog", { name: "Review" });

    // The payment card re-renders on every quote/preview tick.
    for (let renderCount = 1; renderCount <= 3; renderCount += 1) {
      rerender(<StackedDialogs agree={agree} tick={renderCount} />);
    }

    expect(isInert(portalOf("Review"))).toBe(false);

    const checkbox = screen.getByRole("checkbox", { name: "I reviewed the calldata" });
    expect(isInert(checkbox)).toBe(false);
    click(checkbox);
    expect(checkbox).toBeChecked();

    click(screen.getByRole("button", { name: "Agree and continue" }));
    expect(agree).toHaveBeenCalledTimes(1);
  });

  it("inerts the dialog underneath and restores it when the top dialog closes", async () => {
    const agree = vi.fn();
    render(<StackedDialogs agree={agree} />);

    click(screen.getByRole("button", { name: "Open pay" }));
    await screen.findByRole("dialog", { name: "Pay" });
    expect(isInert(portalOf("Pay"))).toBe(false);

    click(screen.getByRole("button", { name: "Open review" }));
    await screen.findByRole("dialog", { name: "Review" });
    expect(isInert(portalOf("Pay"))).toBe(true);
    expect(portalOf("Pay")).toHaveAttribute("aria-hidden", "true");

    click(screen.getByRole("button", { name: "Pay now", hidden: true }));
    expect(agree).not.toHaveBeenCalled();

    click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Review" })).toBeNull());

    expect(isInert(portalOf("Pay"))).toBe(false);
    expect(portalOf("Pay")).not.toHaveAttribute("aria-hidden");
    click(screen.getByRole("button", { name: "Pay now" }));
    expect(agree).toHaveBeenCalledTimes(1);
  });

  it("does not re-sweep the document when only callback identities change", async () => {
    const agree = vi.fn();
    const { rerender } = render(<StackedDialogs agree={agree} tick={0} />);

    click(screen.getByRole("button", { name: "Open pay" }));
    await screen.findByRole("dialog", { name: "Pay" });

    // A body-level overlay mounted after the dialog opened: a later sweep would
    // capture and freeze it.
    const lateOverlay = document.createElement("div");
    document.body.appendChild(lateOverlay);

    rerender(<StackedDialogs agree={agree} tick={1} />);

    expect(isInert(lateOverlay)).toBe(false);
    expect(lateOverlay).not.toHaveAttribute("aria-hidden");
    lateOverlay.remove();
  });

  it("does not steal focus back on every parent re-render", async () => {
    const agree = vi.fn();
    const { rerender } = render(<StackedDialogs agree={agree} autoFocus tick={0} />);

    click(screen.getByRole("button", { name: "Open pay" }));
    await screen.findByRole("dialog", { name: "Pay" });
    const payNow = screen.getByRole("button", { name: "Pay now" });
    await waitFor(() => expect(screen.getByRole("button", { name: "Open review" })).toHaveFocus());

    payNow.focus();
    rerender(<StackedDialogs agree={agree} autoFocus tick={1} />);
    await new Promise((resolve) => queueMicrotask(() => resolve(undefined)));

    expect(payNow).toHaveFocus();
  });

  it("leaves opt-out overlays such as the Para sign-in modal interactive", async () => {
    const agree = vi.fn();
    const paraPortal = document.createElement("div");
    paraPortal.dataset.uiModalPortal = "";
    const paraButton = document.createElement("button");
    const paraClick = vi.fn();
    paraButton.addEventListener("click", paraClick);
    paraPortal.appendChild(paraButton);
    document.body.appendChild(paraPortal);

    const { rerender } = render(<StackedDialogs agree={agree} tick={0} />);
    click(screen.getByRole("button", { name: "Open pay" }));
    await screen.findByRole("dialog", { name: "Pay" });
    rerender(<StackedDialogs agree={agree} tick={1} />);

    expect(isInert(paraButton)).toBe(false);
    expect(paraPortal).not.toHaveAttribute("aria-hidden");
    click(paraButton);
    expect(paraClick).toHaveBeenCalledTimes(1);
    paraPortal.remove();
  });

  it("restores the swept application shell only after the last dialog closes", async () => {
    const agree = vi.fn();
    render(<StackedDialogs agree={agree} />);
    const shell = screen.getByRole("button", { name: "Open pay" }).parentElement!.parentElement!;

    click(screen.getByRole("button", { name: "Open pay" }));
    await screen.findByRole("dialog", { name: "Pay" });
    expect(isInert(shell)).toBe(true);

    click(screen.getByRole("button", { name: "Open review" }));
    await screen.findByRole("dialog", { name: "Review" });
    click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Review" })).toBeNull());

    // The pay dialog is still open: the shell must stay inert.
    expect(isInert(shell)).toBe(true);

    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Pay" })).toBeNull());
    expect(isInert(shell)).toBe(false);
    expect(shell).not.toHaveAttribute("aria-hidden");
    expect(document.body.style.overflow).toBe("");
  });
});
