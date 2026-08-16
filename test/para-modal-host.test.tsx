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
    loggedIn: true,
    connectorId: "injected" as string | undefined,
    address: "0xfeedfacefeedfacefeedfacefeedfacefeedface" as string | undefined,
    openModalCalls: [] as unknown[],
    onRampCalls: [] as unknown[],
  };
  return {
    state,
    reset() {
      state.isOpen = false;
      state.containers.length = 0;
      state.loggedIn = true;
      state.connectorId = "injected";
      state.address = "0xfeedfacefeedfacefeedfacefeedfacefeedface";
      state.openModalCalls.length = 0;
      state.onRampCalls.length = 0;
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
      openModal: (options?: unknown) => {
        para.state.openModalCalls.push(options);
        para.setOpen(true);
      },
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

  return {
    ParaProvider,
    useModal,
    useAuthenticateWithEmailOrPhone: () => ({
      authenticateWithEmailOrPhoneAsync: vi.fn(),
      error: null,
    }),
    useAuthenticateWithOAuth: () => ({
      authenticateWithOAuthAsync: vi.fn(),
      error: null,
    }),
    useVerifyNewAccount: () => ({
      verifyNewAccountAsync: vi.fn(),
      isPending: false,
      error: null,
    }),
    useResendVerificationCode: () => ({ resendVerificationCodeAsync: vi.fn() }),
  };
});

// The SDK ships these as string enums; the host uses them as lookup tables.
vi.mock("@getpara/web-sdk", () => ({
  Network: { ETHEREUM: "ETHEREUM", BASE: "BASE" },
  OnRampAsset: { ETHEREUM: "ETHEREUM", USDC: "USDC" },
  OnRampProvider: { MOONPAY: "MOONPAY" },
  OnRampPurchaseType: { BUY: "BUY" },
}));

vi.mock("wagmi", () => ({
  useAccount: () => ({
    address: para.state.address,
    connector: para.state.connectorId ? { id: para.state.connectorId } : undefined,
  }),
  useConnectors: () => [],
  useConnect: () => ({ connectAsync: vi.fn() }),
}));

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
  getParaClient: () => ({
    isFullyLoggedIn: async () => para.state.loggedIn,
    initiateOnRampTransaction: async (options: unknown) => {
      para.state.onRampCalls.push(options);
      return { portalUrl: "https://portal.example/buy" };
    },
    onStatePhaseChange: () => () => {},
  }),
  PARA_APP: { appName: "Revnet" },
  PARA_ONRAMP_PROVIDER: "MOONPAY",
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
        <ParaModalHost
          requestId={0}
          request={{ kind: "auth" }}
          onOpenChange={() => {}}
          onSettled={() => {}}
        />
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

  it("signs in with our own sheet, never Para's packaged modal", async () => {
    para.reset();
    const onOpenChange = vi.fn();
    const onSettled = vi.fn();

    const { rerender } = render(
      <ParaModalHost
        requestId={1}
        request={{ kind: "auth" }}
        onOpenChange={onOpenChange}
        onSettled={onSettled}
      />,
    );

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(true));
    await waitFor(() => expect(hostDialog().open).toBe(true));
    expect(para.state.openModalCalls).toEqual([]);
    expect(screen.getByText(/You will receive a code/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    await waitFor(() => expect(onSettled).toHaveBeenCalledTimes(1));
    expect(hostDialog().open).toBe(false);

    // A re-render with the same request must not reopen the sheet.
    rerender(
      <ParaModalHost
        requestId={1}
        request={{ kind: "auth" }}
        onOpenChange={onOpenChange}
        onSettled={onSettled}
      />,
    );
    expect(hostDialog().open).toBe(false);
  });

  it("buys to the connected external wallet rather than the embedded one", async () => {
    para.reset();

    render(
      <ParaModalHost
        requestId={1}
        request={{ kind: "addFunds", asset: "ETHEREUM", network: "BASE" }}
        onOpenChange={() => {}}
        onSettled={() => {}}
      />,
    );

    // Para's add-funds modal has no address parameter, so an injected wallet
    // has to go through the headless call or the ETH lands in the wrong place.
    await waitFor(() => expect(para.state.onRampCalls).toHaveLength(1));
    expect(para.state.openModalCalls).toEqual([]);
    expect(para.state.onRampCalls[0]).toMatchObject({
      externalWalletAddress: para.state.address,
      shouldOpenPopup: true,
      params: { asset: "ETHEREUM", network: "BASE", provider: "MOONPAY" },
    });
  });

  it("warns that the purchase may not go through, and offers the window again", async () => {
    para.reset();

    render(
      <ParaModalHost
        requestId={1}
        request={{ kind: "addFunds", asset: "ETHEREUM", network: "BASE" }}
        onOpenChange={() => {}}
        onSettled={() => {}}
      />,
    );

    // A card decline arrives inside the provider's window with no explanation,
    // so the guidance has to live on our side of the handoff.
    await waitFor(() => expect(screen.getByText(/always go through/)).toBeTruthy());
    expect(screen.getByText(/bank transfer/)).toBeTruthy();
    // Popup blockers are common enough that the link has to be clickable.
    expect(
      hostDialog().querySelector('a[href="https://portal.example/buy"]'),
    ).not.toBeNull();
  });

  it("uses Para's own add-funds screen for the embedded wallet", async () => {
    para.reset();
    para.state.connectorId = "para";

    render(
      <ParaModalHost
        requestId={1}
        request={{ kind: "addFunds", asset: "USDC", network: "BASE" }}
        onOpenChange={() => {}}
        onSettled={() => {}}
      />,
    );

    await waitFor(() =>
      expect(para.state.openModalCalls).toEqual([{ step: "ACCOUNT_ADD_FUNDS_BUY" }]),
    );
    expect(para.state.onRampCalls).toEqual([]);
  });

  it("does not reopen the sheet when sign-in for the on-ramp is cancelled", async () => {
    // Closing reports the same event whether the visitor signed in or gave up,
    // so resuming unconditionally walks back into "no session, open the sheet"
    // and the sheet becomes impossible to dismiss.
    para.reset();
    para.state.loggedIn = false;

    render(
      <ParaModalHost
        requestId={1}
        request={{ kind: "addFunds", asset: "ETHEREUM", network: "BASE" }}
        onOpenChange={() => {}}
        onSettled={() => {}}
      />,
    );

    await waitFor(() => expect(screen.getByText(/You will receive a code/)).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Close" }));

    await waitFor(() => expect(hostDialog().open).toBe(false));
    expect(para.state.onRampCalls).toEqual([]);
  });

  it("signs in first when the on-ramp has no Para session to bill against", async () => {
    para.reset();
    para.state.loggedIn = false;

    render(
      <ParaModalHost
        requestId={1}
        request={{ kind: "addFunds", asset: "ETHEREUM", network: "BASE" }}
        onOpenChange={() => {}}
        onSettled={() => {}}
      />,
    );

    await waitFor(() => expect(screen.getByText(/You will receive a code/)).toBeTruthy());
    expect(para.state.onRampCalls).toEqual([]);
    expect(para.state.openModalCalls).toEqual([]);
  });
});
