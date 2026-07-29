import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import ParaModalHost from "@/providers/ParaModalHost";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { isBlockedByModalDialog, openModalDialogs } from "./native-dialog-shim";

const para = vi.hoisted(() => {
  const listeners = new Set<() => void>();
  const state = {
    isOpen: false,
    /** Every container the host has offered Para for its overlay portal. */
    containers: [] as (HTMLElement | null | undefined)[],
  };
  return {
    state,
    reset() {
      state.isOpen = false;
      state.containers.length = 0;
    },
    setOpen(open: boolean) {
      state.isOpen = open;
      listeners.forEach((listener) => listener());
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
});

vi.mock("@getpara/react-sdk-lite/styles.css", () => ({}));

vi.mock("@getpara/react-sdk-lite", async () => {
  const { useSyncExternalStore } = await import("react");
  const { createPortal } = await import("react-dom");

  const useModal = () => {
    const isOpen = useSyncExternalStore(
      para.subscribe,
      () => para.state.isOpen,
      () => para.state.isOpen,
    );
    return {
      isOpen,
      openModal: () => para.setOpen(true),
      closeModal: () => para.setOpen(false),
    };
  };

  // The real provider renders Para's warm-up iframe unconditionally and, while
  // the modal is open, an overlay portalled into `usePortalContainer()`.
  const ParaProvider = ({ children }: { children: React.ReactNode }) => {
    const { isOpen } = useModal();
    const container = para.state.containers.at(-1);
    return (
      <>
        <iframe title="para-preload" />
        {isOpen && container
          ? createPortal(<button type="button">Continue with email</button>, container)
          : null}
        {children}
      </>
    );
  };

  return { ParaProvider, useModal };
});

vi.mock("@getpara/react-component-library", () => ({
  PortalContainerProvider: ({
    container,
    children,
  }: {
    container: HTMLElement | null | undefined;
    children: React.ReactNode;
  }) => {
    if (para.state.containers.at(-1) !== container) para.state.containers.push(container);
    return children;
  },
}));

vi.mock("@/providers/para-config", () => ({
  getParaClient: () => ({}),
  PARA_APP: { appName: "Revnet" },
}));

function hostDialog(): HTMLDialogElement {
  const host = document.querySelector<HTMLDialogElement>("dialog[data-ui-modal-portal]");
  if (!host) throw new Error("no Para host dialog");
  return host;
}

describe("ParaModalHost", () => {
  it("hosts Para in the top layer so sign-in works above an open dialog", async () => {
    para.reset();

    render(
      <>
        <Dialog open>
          <DialogContent>
            <DialogTitle>Pay</DialogTitle>
            <button type="button">Pay now</button>
          </DialogContent>
        </Dialog>
        <ParaModalHost requestId={0} onOpenChange={() => {}} onSettled={() => {}} />
      </>,
    );

    const payDialog = await screen.findByRole("dialog", { name: "Pay" });
    await waitFor(() => expect(para.state.containers.at(-1)).toBeInstanceOf(HTMLDialogElement));
    const host = hostDialog();

    // Para's overlay is portalled into the host, not into the body: the top
    // layer is the only place an overlay can sit above an open dialog.
    expect(para.state.containers.at(-1)).toBe(host);

    // Nothing is open yet, so the pay dialog still owns the top layer.
    expect(host.open).toBe(false);
    expect(openModalDialogs()).toEqual([payDialog]);

    act(() => para.setOpen(true));

    await waitFor(() => expect(host.open).toBe(true));
    expect(openModalDialogs()).toEqual([payDialog, host]);
    const signIn = screen.getByRole("button", { name: "Continue with email" });
    expect(host.contains(signIn)).toBe(true);
    expect(isBlockedByModalDialog(signIn)).toBe(false);
    expect(
      isBlockedByModalDialog(screen.getByRole("button", { name: "Pay now", hidden: true })),
    ).toBe(true);

    // Escape belongs to Para: a native cancel would close the host while Para
    // still believed its own modal was open.
    fireEvent.keyDown(document, { key: "Escape" });
    expect(host.open).toBe(true);

    act(() => para.setOpen(false));

    await waitFor(() => expect(host.open).toBe(false));
    expect(openModalDialogs()).toEqual([payDialog]);
    expect(isBlockedByModalDialog(screen.getByRole("button", { name: "Pay now" }))).toBe(false);
  });

  it("opens the Para modal once per sign-in request", async () => {
    para.reset();
    const onOpenChange = vi.fn();
    const onSettled = vi.fn();

    const { rerender } = render(
      <ParaModalHost requestId={1} onOpenChange={onOpenChange} onSettled={onSettled} />,
    );

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(true));
    await waitFor(() => expect(hostDialog().open).toBe(true));

    act(() => para.setOpen(false));
    await waitFor(() => expect(onSettled).toHaveBeenCalledTimes(1));
    expect(hostDialog().open).toBe(false);

    // A re-render with the same request must not reopen the modal.
    rerender(<ParaModalHost requestId={1} onOpenChange={onOpenChange} onSettled={onSettled} />);
    expect(hostDialog().open).toBe(false);
  });
});
