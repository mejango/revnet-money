"use client";

import { cn, formatEthAddress } from "@/lib/utils";
import {
  type Dispatch,
  type KeyboardEvent as ReactKeyboardEvent,
  type SetStateAction,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { formatUnits } from "viem";
import { useAccount, useBalance, useConnect, useConnectors, useDisconnect } from "wagmi";
import { Button, type ButtonProps } from "./ui/button";

type WalletConnectButtonProps = Omit<ButtonProps, "children"> & {
  label?: string;
  menuAlign?: "left" | "right";
};

const MENU_ITEM_SELECTOR = '[role="menuitem"]:not([disabled])';

function menuItems(menu: HTMLElement | null) {
  return Array.from(menu?.querySelectorAll<HTMLElement>(MENU_ITEM_SELECTOR) ?? []);
}

function useDismissableMenu(open: boolean, setOpen: Dispatch<SetStateAction<boolean>>) {
  const containerRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const initialFocusRef = useRef<"first" | "last">("first");

  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setOpen(false);
      triggerRef.current?.focus();
    };

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, setOpen]);

  useEffect(() => {
    if (!open) return;
    const items = menuItems(menuRef.current);
    const item = initialFocusRef.current === "last" ? items.at(-1) : items[0];
    (item ?? menuRef.current)?.focus();
  }, [open]);

  const openMenu = (initialFocus: "first" | "last" = "first") => {
    initialFocusRef.current = initialFocus;
    setOpen(true);
  };

  const onTriggerKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    openMenu(event.key === "ArrowUp" ? "last" : "first");
  };

  const onMenuKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const items = menuItems(menuRef.current);
    if (!items.length) return;

    const currentIndex = items.indexOf(document.activeElement as HTMLElement);
    let nextIndex: number | undefined;
    switch (event.key) {
      case "ArrowDown":
        nextIndex = currentIndex < 0 ? 0 : (currentIndex + 1) % items.length;
        break;
      case "ArrowUp":
        nextIndex =
          currentIndex < 0 ? items.length - 1 : (currentIndex - 1 + items.length) % items.length;
        break;
      case "Home":
        nextIndex = 0;
        break;
      case "End":
        nextIndex = items.length - 1;
        break;
      default:
        return;
    }

    event.preventDefault();
    items[nextIndex]?.focus();
  };

  return { containerRef, menuRef, onMenuKeyDown, onTriggerKeyDown, openMenu, triggerRef };
}

function useAvailableWallets() {
  const connectors = useConnectors();
  return useMemo(() => {
    const discovered = connectors.filter((connector) => connector.id !== "injected");
    // Prefer individually named EIP-6963 wallets. Keep the generic injected
    // connector only as a compatibility fallback for older providers.
    return discovered.length ? discovered : connectors;
  }, [connectors]);
}

export function WalletConnectButton({
  label = "Connect wallet",
  menuAlign = "left",
  className,
  variant = "outline",
  ...props
}: WalletConnectButtonProps) {
  const connectors = useAvailableWallets();
  const { connectAsync, error, isPending, reset } = useConnect();
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const menu = useDismissableMenu(open, setOpen);

  const connect = async (connector: (typeof connectors)[number]) => {
    reset();
    try {
      await connectAsync({ connector });
      setOpen(false);
    } catch {
      // The mutation exposes a sanitized message in the menu. Keeping the menu
      // open lets the user choose another installed wallet.
    }
  };

  return (
    <div
      className="relative inline-flex"
      ref={menu.containerRef}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false);
      }}
    >
      <Button
        ref={menu.triggerRef}
        {...props}
        type={props.type ?? "button"}
        variant={variant}
        className={className}
        aria-haspopup="menu"
        aria-controls={menuId}
        aria-expanded={open}
        onKeyDown={(event) => {
          props.onKeyDown?.(event);
          if (!event.defaultPrevented) menu.onTriggerKeyDown(event);
        }}
        onClick={(event) => {
          props.onClick?.(event);
          if (event.defaultPrevented) return;
          reset();
          if (open) setOpen(false);
          else menu.openMenu();
        }}
        loading={isPending}
      >
        {label}
      </Button>
      {open ? (
        <div
          ref={menu.menuRef}
          id={menuId}
          role="menu"
          tabIndex={-1}
          aria-label="Available wallets"
          onKeyDown={menu.onMenuKeyDown}
          className={cn(
            "absolute top-full z-50 mt-2 min-w-56 border border-zinc-200 bg-white p-1 shadow-lg",
            menuAlign === "right" ? "right-0" : "left-0",
          )}
        >
          {connectors.length ? (
            connectors.map((connector) => (
              <button
                key={connector.uid}
                type="button"
                role="menuitem"
                disabled={isPending}
                onClick={() => void connect(connector)}
                className="block min-h-11 w-full px-3 py-2 text-left text-sm hover:bg-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-950 disabled:opacity-50"
              >
                {connector.name}
              </button>
            ))
          ) : (
            <p className="max-w-64 px-3 py-2 text-sm text-zinc-600">
              No browser wallet was detected. Install or enable an EIP-6963 wallet, then reload.
            </p>
          )}
          {error ? (
            <p
              role="alert"
              className="max-w-64 border-t border-zinc-100 px-3 py-2 text-xs text-red-700"
            >
              The wallet could not connect. Check that it is unlocked and try again.
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function WalletButton() {
  const { address, chain, isConnected } = useAccount();
  const { data: balance } = useBalance({ address });
  const { disconnect, isPending } = useDisconnect();
  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const menu = useDismissableMenu(open, setOpen);

  useEffect(() => setMounted(true), []);

  if (!mounted || !isConnected || !address) {
    return <WalletConnectButton menuAlign="right" />;
  }

  const formattedBalance = balance
    ? `${Number(formatUnits(balance.value, balance.decimals)).toLocaleString(undefined, {
        maximumFractionDigits: 4,
      })} ${balance.symbol}`
    : null;

  return (
    <div
      className="relative inline-flex"
      ref={menu.containerRef}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false);
      }}
    >
      <Button
        ref={menu.triggerRef}
        type="button"
        variant="outline"
        aria-haspopup="menu"
        aria-controls={menuId}
        aria-expanded={open}
        onKeyDown={menu.onTriggerKeyDown}
        onClick={() => {
          if (open) setOpen(false);
          else menu.openMenu();
        }}
        className="gap-2"
      >
        <span className="h-2 w-2 bg-teal-500" aria-hidden />
        <span>{formatEthAddress(address, { truncateTo: 4 })}</span>
        {formattedBalance ? (
          <span className="hidden border-l border-zinc-200 pl-2 text-zinc-600 sm:inline">
            {formattedBalance}
          </span>
        ) : null}
      </Button>
      {open ? (
        <div
          ref={menu.menuRef}
          id={menuId}
          role="menu"
          tabIndex={-1}
          aria-label="Wallet account"
          onKeyDown={menu.onMenuKeyDown}
          className="absolute right-0 top-full z-50 mt-2 min-w-64 border border-zinc-200 bg-white p-1 shadow-lg"
        >
          <div className="border-b border-zinc-100 px-3 py-2 text-xs text-zinc-600">
            <div className="font-medium text-zinc-950">
              {formattedBalance ?? "Balance unavailable"}
            </div>
            <div>{chain?.name ?? "Unsupported network"}</div>
          </div>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              void navigator.clipboard?.writeText(address).catch(() => undefined);
              setOpen(false);
              menu.triggerRef.current?.focus();
            }}
            className="block min-h-11 w-full px-3 py-2 text-left text-sm hover:bg-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-950"
          >
            Copy address
          </button>
          <button
            type="button"
            role="menuitem"
            disabled={isPending}
            onClick={() => {
              disconnect();
              setOpen(false);
            }}
            className={cn(
              "block min-h-11 w-full px-3 py-2 text-left text-sm hover:bg-zinc-100",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-950 disabled:opacity-50",
            )}
          >
            Disconnect
          </button>
        </div>
      ) : null}
    </div>
  );
}
