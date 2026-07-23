"use client";

import { X } from "@/components/ui/icons";
import * as React from "react";
import { createPortal } from "react-dom";

import { cn } from "@/lib/utils";
import { composeRefs, Slot } from "./slot";

type DialogContextValue = {
  contentId: string;
  descriptionId: string;
  hasDescription: boolean;
  hasTitle: boolean;
  modal: boolean;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  registerDescription: () => () => void;
  registerTitle: () => () => void;
  titleId: string;
  triggerRef: React.RefObject<HTMLElement | null>;
};

const DialogContext = React.createContext<DialogContextValue | null>(null);

function useDialog(component: string) {
  const context = React.useContext(DialogContext);
  if (!context) throw new Error(`${component} must be used inside Dialog`);
  return context;
}

function useControllableState({
  value,
  defaultValue,
  onChange,
}: {
  value?: boolean;
  defaultValue: boolean;
  onChange?: (value: boolean) => void;
}) {
  const [internalValue, setInternalValue] = React.useState(defaultValue);
  const controlled = value !== undefined;
  const currentValue = controlled ? value : internalValue;
  const setValue = React.useCallback(
    (nextValue: boolean) => {
      if (!controlled) setInternalValue(nextValue);
      if (nextValue !== currentValue) onChange?.(nextValue);
    },
    [controlled, currentValue, onChange],
  );
  return [currentValue, setValue] as const;
}

interface DialogProps {
  children?: React.ReactNode;
  defaultOpen?: boolean;
  modal?: boolean;
  onOpenChange?: (open: boolean) => void;
  open?: boolean;
}

function Dialog({
  children,
  defaultOpen = false,
  modal = true,
  onOpenChange,
  open: controlledOpen,
}: DialogProps) {
  const [open, setOpen] = useControllableState({
    value: controlledOpen,
    defaultValue: defaultOpen,
    onChange: onOpenChange,
  });
  const reactId = React.useId().replace(/:/g, "");
  const triggerRef = React.useRef<HTMLElement>(null);
  const [titleCount, setTitleCount] = React.useState(0);
  const [descriptionCount, setDescriptionCount] = React.useState(0);
  const registerTitle = React.useCallback(() => {
    setTitleCount((count) => count + 1);
    return () => setTitleCount((count) => Math.max(0, count - 1));
  }, []);
  const registerDescription = React.useCallback(() => {
    setDescriptionCount((count) => count + 1);
    return () => setDescriptionCount((count) => Math.max(0, count - 1));
  }, []);

  const context = React.useMemo<DialogContextValue>(
    () => ({
      contentId: `dialog-content-${reactId}`,
      descriptionId: `dialog-description-${reactId}`,
      hasDescription: descriptionCount > 0,
      hasTitle: titleCount > 0,
      modal,
      onOpenChange: setOpen,
      open,
      registerDescription,
      registerTitle,
      titleId: `dialog-title-${reactId}`,
      triggerRef,
    }),
    [
      descriptionCount,
      modal,
      open,
      reactId,
      registerDescription,
      registerTitle,
      setOpen,
      titleCount,
    ],
  );

  return <DialogContext.Provider value={context}>{children}</DialogContext.Provider>;
}

interface DialogTriggerProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  asChild?: boolean;
}

const DialogTrigger = React.forwardRef<HTMLElement, DialogTriggerProps>(
  ({ asChild = false, onClick, type, ...props }, forwardedRef) => {
    const context = useDialog("DialogTrigger");
    const ref = composeRefs(forwardedRef, context.triggerRef);
    const handleClick: React.MouseEventHandler<HTMLElement> = (event) => {
      onClick?.(event as React.MouseEvent<HTMLButtonElement>);
      if (!event.defaultPrevented) context.onOpenChange(true);
    };
    const sharedProps = {
      "aria-controls": context.contentId,
      "aria-expanded": context.open,
      "aria-haspopup": "dialog" as const,
      "data-state": context.open ? "open" : "closed",
      onClick: handleClick,
      ...props,
    };

    if (asChild) {
      return (
        <Slot ref={ref} {...sharedProps}>
          {React.Children.only(props.children) as React.ReactElement}
        </Slot>
      );
    }

    return (
      <button ref={ref as React.Ref<HTMLButtonElement>} type={type ?? "button"} {...sharedProps} />
    );
  },
);
DialogTrigger.displayName = "DialogTrigger";

interface DialogPortalProps {
  children?: React.ReactNode;
  container?: HTMLElement | null;
  forceMount?: boolean;
}

function DialogPortal({ children, container }: DialogPortalProps) {
  const [portalNode, setPortalNode] = React.useState<HTMLElement | null>(container ?? null);

  React.useEffect(() => {
    if (container) {
      setPortalNode(container);
      return;
    }

    const node = document.createElement("div");
    node.dataset.uiDialogPortal = "";
    document.body.appendChild(node);
    setPortalNode(node);
    return () => node.remove();
  }, [container]);

  return portalNode ? createPortal(children, portalNode) : null;
}

function useDialogPortalNode(open: boolean) {
  const [portalNode, setPortalNode] = React.useState<HTMLElement | null>(null);
  React.useEffect(() => {
    if (!open) {
      setPortalNode(null);
      return;
    }
    const node = document.createElement("div");
    node.dataset.uiDialogPortal = "";
    document.body.appendChild(node);
    setPortalNode(node);
    return () => node.remove();
  }, [open]);
  return portalNode;
}

interface DialogCloseProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  asChild?: boolean;
}

const DialogClose = React.forwardRef<HTMLElement, DialogCloseProps>(
  ({ asChild = false, onClick, type, ...props }, ref) => {
    const context = useDialog("DialogClose");
    const handleClick: React.MouseEventHandler<HTMLElement> = (event) => {
      onClick?.(event as React.MouseEvent<HTMLButtonElement>);
      if (!event.defaultPrevented) context.onOpenChange(false);
    };
    const sharedProps = { onClick: handleClick, ...props };

    if (asChild) {
      return (
        <Slot ref={ref} {...sharedProps}>
          {React.Children.only(props.children) as React.ReactElement}
        </Slot>
      );
    }

    return (
      <button ref={ref as React.Ref<HTMLButtonElement>} type={type ?? "button"} {...sharedProps} />
    );
  },
);
DialogClose.displayName = "DialogClose";

interface DialogOverlayProps extends React.HTMLAttributes<HTMLDivElement> {
  forceMount?: boolean;
}

const DialogOverlay = React.forwardRef<HTMLDivElement, DialogOverlayProps>(
  ({ className, forceMount: _forceMount, onPointerDown, ...props }, ref) => {
    const context = useDialog("DialogOverlay");
    if (!context.open) return null;

    return (
      <div
        ref={ref}
        aria-hidden="true"
        data-state="open"
        className={cn(
          "fixed inset-0 z-50 bg-black/80 data-[state=open]:animate-in data-[state=open]:fade-in-0",
          className,
        )}
        onPointerDown={(event) => {
          onPointerDown?.(event);
          if (event.target === event.currentTarget && !event.defaultPrevented) {
            context.onOpenChange(false);
          }
        }}
        {...props}
      />
    );
  },
);
DialogOverlay.displayName = "DialogOverlay";

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "area[href]",
  "button:not([disabled])",
  "input:not([disabled]):not([type=hidden])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "iframe",
  "[tabindex]:not([tabindex='-1'])",
  "[contenteditable=true]",
].join(",");

function getFocusableElements(container: HTMLElement) {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (element) =>
      !element.hidden &&
      element.getAttribute("aria-hidden") !== "true" &&
      getComputedStyle(element).display !== "none" &&
      getComputedStyle(element).visibility !== "hidden",
  );
}

let bodyLockCount = 0;
let originalBodyOverflow = "";
const dialogStack: symbol[] = [];

function useModalEffects({
  contentRef,
  enabled,
  modal,
  onOpenChange,
  onCloseAutoFocus,
  onEscapeKeyDown,
  onOpenAutoFocus,
  open,
  triggerRef,
}: {
  contentRef: React.RefObject<HTMLDivElement | null>;
  enabled: boolean;
  modal: boolean;
  onOpenChange: (open: boolean) => void;
  onCloseAutoFocus?: (event: Event) => void;
  onEscapeKeyDown?: (event: KeyboardEvent) => void;
  onOpenAutoFocus?: (event: Event) => void;
  open: boolean;
  triggerRef: React.RefObject<HTMLElement | null>;
}) {
  React.useLayoutEffect(() => {
    if (!open || !enabled) return;

    const content = contentRef.current;
    if (!content) return;
    const stackEntry = Symbol("dialog");
    dialogStack.push(stackEntry);
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const restoreTrigger = triggerRef.current;
    const openEvent = new Event("dialog.openAutoFocus", { cancelable: true });
    onOpenAutoFocus?.(openEvent);
    if (!openEvent.defaultPrevented) {
      queueMicrotask(() => {
        const target = getFocusableElements(content)[0] ?? content;
        target.focus({ preventScroll: true });
      });
    }

    const hiddenSiblings: Array<{
      element: HTMLElement;
      ariaHidden: string | null;
      inert: boolean;
    }> = [];

    if (modal) {
      bodyLockCount += 1;
      if (bodyLockCount === 1) {
        originalBodyOverflow = document.body.style.overflow;
        document.body.style.overflow = "hidden";
      }

      const portal = content.closest<HTMLElement>("[data-ui-dialog-portal]");
      for (const child of Array.from(document.body.children)) {
        if (
          !(child instanceof HTMLElement) ||
          child === portal ||
          child.dataset.uiSelectPortal !== undefined ||
          child.dataset.uiTooltipPortal !== undefined
        ) {
          continue;
        }
        hiddenSiblings.push({
          element: child,
          ariaHidden: child.getAttribute("aria-hidden"),
          inert: child.inert,
        });
        child.setAttribute("aria-hidden", "true");
        child.inert = true;
      }
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (dialogStack.at(-1) !== stackEntry) return;
      if (event.key === "Escape") {
        onEscapeKeyDown?.(event);
        if (!event.defaultPrevented) {
          event.preventDefault();
          onOpenChange(false);
        }
        return;
      }

      if (event.key !== "Tab") return;
      const focusable = getFocusableElements(content);
      if (focusable.length === 0) {
        event.preventDefault();
        content.focus();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (
        event.shiftKey &&
        (document.activeElement === first || document.activeElement === content)
      ) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      } else if (!content.contains(document.activeElement)) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown, true);
    return () => {
      const stackIndex = dialogStack.lastIndexOf(stackEntry);
      if (stackIndex >= 0) dialogStack.splice(stackIndex, 1);
      document.removeEventListener("keydown", handleKeyDown, true);
      hiddenSiblings.forEach(({ element, ariaHidden, inert }) => {
        if (ariaHidden === null) element.removeAttribute("aria-hidden");
        else element.setAttribute("aria-hidden", ariaHidden);
        element.inert = inert;
      });
      if (modal) {
        bodyLockCount = Math.max(0, bodyLockCount - 1);
        if (bodyLockCount === 0) document.body.style.overflow = originalBodyOverflow;
      }

      const closeEvent = new Event("dialog.closeAutoFocus", { cancelable: true });
      onCloseAutoFocus?.(closeEvent);
      if (!closeEvent.defaultPrevented) {
        queueMicrotask(() => {
          const restoreTarget = restoreTrigger ?? previouslyFocused;
          if (restoreTarget?.isConnected) restoreTarget.focus({ preventScroll: true });
        });
      }
    };
  }, [
    contentRef,
    enabled,
    modal,
    onOpenChange,
    onCloseAutoFocus,
    onEscapeKeyDown,
    onOpenAutoFocus,
    open,
    triggerRef,
  ]);
}

interface DialogContentProps extends React.HTMLAttributes<HTMLDivElement> {
  forceMount?: boolean;
  onCloseAutoFocus?: (event: Event) => void;
  onEscapeKeyDown?: (event: KeyboardEvent) => void;
  onOpenAutoFocus?: (event: Event) => void;
}

const DialogContent = React.forwardRef<HTMLDivElement, DialogContentProps>(
  (
    {
      className,
      children,
      forceMount: _forceMount,
      onCloseAutoFocus,
      onEscapeKeyDown,
      onOpenAutoFocus,
      ...props
    },
    forwardedRef,
  ) => {
    const context = useDialog("DialogContent");
    const localRef = React.useRef<HTMLDivElement>(null);
    const ref = composeRefs(forwardedRef, localRef);
    const portalNode = useDialogPortalNode(context.open);
    useModalEffects({
      contentRef: localRef,
      enabled: portalNode !== null,
      modal: context.modal,
      onOpenChange: context.onOpenChange,
      onCloseAutoFocus,
      onEscapeKeyDown,
      onOpenAutoFocus,
      open: context.open,
      triggerRef: context.triggerRef,
    });

    if (!context.open || !portalNode) return null;

    return createPortal(
      <>
        <DialogOverlay />
        <div
          ref={ref}
          id={context.contentId}
          role="dialog"
          aria-modal={context.modal || undefined}
          aria-labelledby={context.hasTitle ? context.titleId : undefined}
          aria-describedby={context.hasDescription ? context.descriptionId : undefined}
          tabIndex={-1}
          data-state="open"
          className={cn(
            "fixed left-[50%] top-[50%] z-50 grid w-full max-w-lg translate-x-[-50%] translate-y-[-50%] gap-4 border border-zinc-200 bg-white p-6 shadow-lg duration-200 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[state=open]:slide-in-from-left-1/2 data-[state=open]:slide-in-from-top-[48%] dark:border-zinc-800 dark:bg-zinc-950 max-h-[90%] overflow-y-auto overscroll-none",
            className,
          )}
          {...props}
        >
          {children}
          <DialogClose className="absolute right-4 top-4 opacity-70 ring-offset-white transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-zinc-950 focus:ring-offset-2 disabled:pointer-events-none dark:ring-offset-zinc-950 dark:focus:ring-zinc-300">
            <X aria-hidden="true" className="h-4 w-4" />
            <span className="sr-only">Close</span>
          </DialogClose>
        </div>
      </>,
      portalNode,
    );
  },
);
DialogContent.displayName = "DialogContent";

const DialogHeader = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("flex flex-col space-y-1.5 text-center sm:text-left", className)} {...props} />
);
DialogHeader.displayName = "DialogHeader";

const DialogFooter = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn("flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2", className)}
    {...props}
  />
);
DialogFooter.displayName = "DialogFooter";

interface DialogTextProps extends React.HTMLAttributes<HTMLElement> {
  asChild?: boolean;
}

const DialogTitle = React.forwardRef<HTMLElement, DialogTextProps>(
  ({ asChild = false, className, ...props }, ref) => {
    const context = useDialog("DialogTitle");
    const registerTitle = context.registerTitle;
    React.useLayoutEffect(() => registerTitle(), [registerTitle]);
    const sharedProps = {
      id: context.titleId,
      className: cn("text-lg font-semibold leading-none", className),
      ...props,
    };
    if (asChild) {
      return (
        <Slot ref={ref} {...sharedProps}>
          {React.Children.only(props.children) as React.ReactElement}
        </Slot>
      );
    }
    return <h2 ref={ref as React.Ref<HTMLHeadingElement>} {...sharedProps} />;
  },
);
DialogTitle.displayName = "DialogTitle";

const DialogDescription = React.forwardRef<HTMLElement, DialogTextProps>(
  ({ asChild = false, className, ...props }, ref) => {
    const context = useDialog("DialogDescription");
    const registerDescription = context.registerDescription;
    React.useLayoutEffect(() => registerDescription(), [registerDescription]);
    const sharedProps = {
      id: context.descriptionId,
      className: cn("text-sm text-zinc-500 dark:text-zinc-400", className),
      ...props,
    };
    if (asChild) {
      return (
        <Slot ref={ref} {...sharedProps}>
          {React.Children.only(props.children) as React.ReactElement}
        </Slot>
      );
    }
    return <p ref={ref as React.Ref<HTMLParagraphElement>} {...sharedProps} />;
  },
);
DialogDescription.displayName = "DialogDescription";

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
};
