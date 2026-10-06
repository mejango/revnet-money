import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Toast,
  ToastClose,
  ToastDescription,
  ToastProvider,
  ToastViewport,
} from "@/components/ui/toast";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { TxConfirmDialog } from "@/components/ui/TxConfirmDialog";
import { ErrorNote, TxError } from "@/components/ui/TxError";
import { stepStatus, TxStep, TxSteps } from "@/components/ui/TxSteps";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

describe("dependency-free UI primitives", () => {
  it("moves and restores dialog focus and supports Escape and backdrop dismissal", async () => {
    const onOpenChange = vi.fn();
    render(
      <Dialog onOpenChange={onOpenChange}>
        <DialogTrigger asChild>
          <button>Open settings</button>
        </DialogTrigger>
        <DialogContent>
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription>Change project settings.</DialogDescription>
          <input aria-label="Project name" />
          <button>Save</button>
        </DialogContent>
      </Dialog>,
    );

    const trigger = screen.getByRole("button", { name: "Open settings" });
    trigger.focus();
    fireEvent.click(trigger);
    const dialog = await screen.findByRole("dialog", { name: "Settings" });
    // `showModal()` makes `role="dialog"` and `aria-modal` implicit, and the
    // backdrop is `::backdrop` rather than an element, so there is nothing in
    // the portal but the dialog itself.
    expect(dialog.tagName).toBe("DIALOG");
    expect(dialog).toHaveAttribute("open");
    expect(dialog).toHaveAccessibleDescription("Change project settings.");
    expect(dialog.className).not.toMatch(/animate-in|fade-in|zoom-in|slide-in/);
    expect(dialog.closest("[data-ui-dialog-portal]")?.children).toHaveLength(1);
    expect(dialog).toHaveFocus();

    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(trigger).toHaveFocus();
    expect(onOpenChange).toHaveBeenLastCalledWith(false);

    fireEvent.click(trigger);
    const reopened = await screen.findByRole("dialog", { name: "Settings" });
    fireEvent.pointerDown(reopened);
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("supports controlled select value, arrow keys, disabled options, and typeahead", async () => {
    function Example() {
      const [value, setValue] = useState("");
      return (
        <Select value={value} onValueChange={setValue}>
          <SelectTrigger aria-label="Network">
            <SelectValue placeholder="Choose a network" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ethereum">Ethereum</SelectItem>
            <SelectItem value="optimism">Optimism</SelectItem>
            <SelectItem value="disabled" disabled>
              Disabled
            </SelectItem>
          </SelectContent>
        </Select>
      );
    }

    render(<Example />);
    const trigger = screen.getByRole("combobox", { name: "Network" });
    expect(trigger).toHaveTextContent("Choose a network");
    fireEvent.click(trigger);
    const listbox = await screen.findByRole("listbox");
    expect(listbox).toBeVisible();
    expect(listbox.className).not.toMatch(/animate-in|fade-in|zoom-in|slide-in/);
    expect(screen.getByRole("option", { name: "Disabled" })).toHaveAttribute(
      "aria-disabled",
      "true",
    );

    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    fireEvent.keyDown(trigger, { key: "Enter" });
    await waitFor(() => expect(trigger).toHaveTextContent("Optimism"));
    expect(trigger).toHaveAttribute("aria-expanded", "false");

    fireEvent.keyDown(trigger, { key: "e" });
    await waitFor(() => expect(trigger).toHaveTextContent("Ethereum"));
  });

  it("links tooltip content to its trigger and closes it with Escape", async () => {
    render(
      <TooltipProvider delayDuration={0}>
        <Tooltip>
          <TooltipTrigger asChild>
            <time>2h ago</time>
          </TooltipTrigger>
          <TooltipContent>January 1</TooltipContent>
        </Tooltip>
      </TooltipProvider>,
    );

    const trigger = screen.getByText("2h ago");
    fireEvent.focus(trigger);
    const tooltip = await screen.findByRole("tooltip");
    expect(trigger).toHaveAttribute("aria-describedby", tooltip.id);
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("tooltip")).not.toBeInTheDocument());
  });

  it("toggles tooltip content on repeated mobile taps", async () => {
    const matchMedia = vi.fn(() => ({
      matches: true,
      media: "(max-width: 767px)",
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));
    vi.stubGlobal("matchMedia", matchMedia);

    render(
      <Tooltip>
        <TooltipTrigger>Balance details</TooltipTrigger>
        <TooltipContent>All chain balances</TooltipContent>
      </Tooltip>,
    );

    const trigger = screen.getByRole("button", { name: "Balance details" });
    await waitFor(() => expect(matchMedia).toHaveBeenCalled());

    fireEvent.focus(trigger);
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();

    fireEvent.click(trigger);
    expect(await screen.findByRole("tooltip")).toHaveTextContent("All chain balances");

    fireEvent.pointerLeave(trigger, { pointerType: "touch" });
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(screen.getByRole("tooltip")).toBeVisible();

    fireEvent.click(trigger);
    await waitFor(() => expect(screen.queryByRole("tooltip")).not.toBeInTheDocument());
  });

  it("announces and dismisses toasts through an accessible live role", async () => {
    const onOpenChange = vi.fn();
    render(
      <ToastProvider duration={Infinity}>
        <ToastViewport>
          <Toast onOpenChange={onOpenChange}>
            <ToastDescription>Transaction confirmed.</ToastDescription>
            <ToastClose />
          </Toast>
        </ToastViewport>
      </ToastProvider>,
    );

    expect(screen.getByRole("region", { name: "Notifications" })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Transaction confirmed.");
    fireEvent.click(screen.getByRole("button", { name: "Close notification" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    await waitFor(() => expect(screen.queryByRole("status")).not.toBeInTheDocument());
  });

  it("preserves the child element for Button asChild", () => {
    const disabledClick = vi.fn();
    render(
      <>
        <Button asChild variant="outline">
          <a href="https://example.com/project">View project</a>
        </Button>
        <Button asChild disabled>
          <a href="https://example.com/disabled" onClick={disabledClick}>
            Disabled project
          </a>
        </Button>
      </>,
    );
    const link = screen.getByRole("link", { name: "View project" });
    expect(link).toHaveAttribute("href", "https://example.com/project");
    expect(link.className).toContain("border");
    const disabledLink = screen.getByRole("link", { name: "Disabled project" });
    fireEvent.click(disabledLink);
    expect(disabledClick).not.toHaveBeenCalled();
    expect(disabledLink).toHaveAttribute("aria-disabled", "true");
  });

  it("gives inherited outline controls an explicit accessible foreground", () => {
    render(<Button variant="outline">Connect wallet</Button>);

    const button = screen.getByRole("button", { name: "Connect wallet" });
    expect(button.className).toContain("text-zinc-950");
    expect(button.className).toContain("dark:text-zinc-50");
  });
});

describe("the wallet-prompt queue", () => {
  const steps = [{ title: "Approve" }, { title: "Mint", detail: "Mints the position." }];

  it("marks everything before the active step done and the rest pending", () => {
    render(<TxSteps steps={[...steps, { title: "Stake" }]} activeIndex={1} ariaLabel="Queue" />);

    const items = within(screen.getByLabelText("Queue")).getAllByRole("listitem");
    expect(items.map((item) => item.getAttribute("data-state"))).toEqual([
      "complete",
      "active",
      "pending",
    ]);
    expect(items[1]).toHaveAttribute("aria-current", "step");
    expect(items[0]).not.toHaveAttribute("aria-current");
    expect(items[0]).toHaveTextContent("✓");
    expect(items[1]).toHaveTextContent("Step 2 of 3: Mint");
    expect(items[1]).toHaveTextContent("Mints the position.");
    expect(screen.getByText(/Your wallet will ask for 3 actions/)).toBeInTheDocument();
  });

  it("shows nothing running at -1 and every step done once the flow passes steps.length", () => {
    const { rerender } = render(<TxSteps steps={steps} activeIndex={-1} ariaLabel="Queue" />);
    const states = () =>
      within(screen.getByLabelText("Queue"))
        .getAllByRole("listitem")
        .map((item) => item.getAttribute("data-state"));
    expect(states()).toEqual(["pending", "pending"]);

    rerender(<TxSteps steps={steps} activeIndex={steps.length} ariaLabel="Queue" />);
    expect(states()).toEqual(["complete", "complete"]);
  });

  it("names a single action, and lets the flow replace the line", () => {
    const { rerender } = render(<TxSteps steps={[{ title: "Burn" }]} activeIndex={-1} />);
    expect(screen.getByText("Your wallet will ask for one action.")).toBeInTheDocument();

    rerender(<TxSteps steps={[{ title: "Burn" }]} activeIndex={-1} intro="One signature." />);
    expect(screen.getByText("One signature.")).toBeInTheDocument();
    expect(screen.queryByText("Your wallet will ask for one action.")).toBeNull();
  });

  it("keeps a resumable step's own state and body", () => {
    expect(stepStatus(true, true)).toBe("done");
    expect(stepStatus(false, true)).toBe("active");
    expect(stepStatus(false, false)).toBe("pending");
    render(
      <ol>
        <TxStep number={1} total={2} title="Set the ENS record" status="done" />
        <TxStep number={2} total={2} title="Publish the handle" status="active">
          <p>Publishes the reverse claim.</p>
        </TxStep>
      </ol>,
    );

    const [done, active] = screen.getAllByRole("listitem");
    expect(done).toHaveTextContent("✓");
    expect(done).toHaveTextContent("Step 1 of 2");
    expect(done).not.toHaveAttribute("aria-current");
    expect(active).toHaveAttribute("aria-current", "step");
    expect(active).toHaveTextContent("Publish the handle");
    expect(active).toHaveTextContent("Publishes the reverse claim.");
  });
});

describe("one palette in the step file", () => {
  /** The marker colors of a status: its border, fill and text utilities. */
  const colors = (marker: Element) =>
    [...marker.classList].filter((name) => /^(border|bg|text)-(melon|teal|zinc)-/.test(name));

  it("draws a resumable step's markers as the queue draws its own", () => {
    render(
      <>
        <TxSteps
          steps={[{ title: "A" }, { title: "B" }, { title: "C" }]}
          activeIndex={1}
          ariaLabel="Queue"
        />
        <ol aria-label="Resumable">
          <TxStep number={1} total={3} title="A" status="done" />
          <TxStep number={2} total={3} title="B" status="active" />
          <TxStep number={3} total={3} title="C" status="pending" />
        </ol>
      </>,
    );
    const markers = (label: string) =>
      within(screen.getByLabelText(label))
        .getAllByRole("listitem")
        .map((item) => colors(item.querySelector('[aria-hidden="true"]')!));

    expect(markers("Resumable")).toEqual(markers("Queue"));
  });
});

describe("the write error block", () => {
  it("renders nothing without an error, so a flow can pass its state straight through", () => {
    const { container, rerender } = render(<TxError error={null} />);
    expect(container).toBeEmptyDOMElement();
    rerender(<TxError error="" />);
    expect(container).toBeEmptyDOMElement();
    rerender(<TxError error={undefined} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("announces the error, and wraps unbroken hex inside its container", () => {
    const hex = `0x${"ab".repeat(64)}`;
    render(<TxError error={`Reverted with ${hex}`} />);

    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent(`Reverted with ${hex}`);
    expect(alert).toHaveClass("wrap-anywhere");
  });

  it("gives the authority cards a compact variant", () => {
    render(<ErrorNote message="The connected account is not the operator." />);

    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("The connected account is not the operator.");
    expect(alert).toHaveClass("text-xs", "wrap-anywhere");
  });
});

describe("the confirm", () => {
  function Confirm(props: Partial<Parameters<typeof TxConfirmDialog>[0]>) {
    return (
      <TxConfirmDialog
        open
        onClose={vi.fn()}
        title="Confirm burn"
        rows={[
          { label: "Burns", value: "10 ART", strong: true },
          { label: "Holder", value: "0x1111111111111111111111111111111111111111", mono: true },
        ]}
        steps={[{ title: "Burn 10 ART" }]}
        activeIndex={-1}
        action="Burn permanently"
        onConfirm={vi.fn()}
        {...props}
      >
        <p>Supply drops permanently.</p>
      </TxConfirmDialog>
    );
  }
  const button = (name: string) => screen.queryByRole("button", { name });

  it("shows the plan with a way back before anything is sent", () => {
    const onClose = vi.fn();
    const onConfirm = vi.fn();
    render(<Confirm onClose={onClose} onConfirm={onConfirm} />);

    const dialog = screen.getByRole("dialog", { name: "Confirm burn" }) as HTMLDialogElement;
    expect(dialog).toHaveTextContent("Review");
    expect(dialog).toHaveTextContent("Burns10 ART");
    expect(dialog).toHaveTextContent("Supply drops permanently.");
    expect(dialog).toHaveTextContent("Your wallet will ask for one action.");
    expect(button("Done")).toBeNull();

    fireEvent.click(button("Cancel")!);
    fireEvent.click(button("Close")!);
    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.pointerDown(dialog);
    expect(onClose).toHaveBeenCalledTimes(4);
    expect(onConfirm).not.toHaveBeenCalled();

    fireEvent.click(button("Burn permanently")!);
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it("refuses every way out while busy, and offers no second send", () => {
    const onClose = vi.fn();
    const onConfirm = vi.fn();
    render(<Confirm busy activeIndex={0} onClose={onClose} onConfirm={onConfirm} />);
    const dialog = screen.getByRole("dialog", { name: "Confirm burn" }) as HTMLDialogElement;

    expect(button("Cancel")).toBeDisabled();
    expect(button("Close")).toBeDisabled();
    expect(button("Burn permanently")).toBeDisabled();
    fireEvent.click(button("Cancel")!);
    fireEvent.click(button("Close")!);
    fireEvent.click(button("Burn permanently")!);
    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.pointerDown(dialog);

    expect(onClose).not.toHaveBeenCalled();
    expect(onConfirm).not.toHaveBeenCalled();
    expect(dialog.open).toBe(true);
  });

  it("collapses to Done once the send is complete", () => {
    const onClose = vi.fn();
    render(<Confirm complete status="Tokens burned." onClose={onClose} />);

    expect(button("Cancel")).toBeNull();
    expect(button("Burn permanently")).toBeNull();
    expect(screen.getByRole("listitem")).toHaveAttribute("data-state", "complete");
    expect(screen.getByText("Tokens burned.")).toBeInTheDocument();
    fireEvent.click(button("Done")!);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("holds the action while it prepares, and keeps the way back open", () => {
    const onClose = vi.fn();
    const { rerender } = render(
      <Confirm preparing status="Reading your balance…" onClose={onClose} />,
    );

    expect(screen.getByRole("status")).toHaveTextContent("Reading your balance…");
    expect(screen.queryByText("Burns")).toBeNull();
    expect(button("Burn permanently")).toBeDisabled();
    expect(button("Burn permanently")).toHaveAttribute("aria-busy", "true");
    fireEvent.click(button("Cancel")!);
    expect(onClose).toHaveBeenCalledOnce();

    rerender(<Confirm actionDisabled cancelLabel="Back" onClose={onClose} />);
    expect(button("Burn permanently")).toBeDisabled();
    expect(button("Burn permanently")).not.toHaveAttribute("aria-busy");
    expect(button("Back")).toBeEnabled();
  });

  it("shows the send's error under the plan, and renders nothing while closed", () => {
    const { rerender } = render(<Confirm error="The wallet refused the transaction." />);
    expect(screen.getByText("The wallet refused the transaction.")).toBeInTheDocument();

    rerender(<Confirm open={false} />);
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
