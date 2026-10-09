"use client";

import { LoadingText } from "@/components/ui/LoadingText";
import {
  ModalCloseButton,
  ModalDialog,
  useEnclosingModalCard,
  useHoldEnclosingModal,
} from "@/components/ui/ModalShell";
import { TxSteps } from "@/components/ui/TxSteps";
import { formatTransactionMessage } from "@/lib/utils";
import { useEffect, useId, type ComponentProps, type ReactNode } from "react";
import { createPortal } from "react-dom";

export type TxConfirmRow = {
  label: ReactNode;
  value: ReactNode;
  /** Render the value in a monospace face (addresses, hashes). */
  mono?: boolean;
  /** Emphasize the value (the amount that leaves the wallet). */
  strong?: boolean;
};

/**
 * The one review surface for every wallet write: a frozen plan (label/value
 * rows), the wallet-prompt queue, then a single action. Closing is refused
 * while `busy`; once `complete` the footer collapses to Done.
 */
export function TxConfirmDialog({
  open,
  onClose,
  eyebrow = "Review",
  title,
  rows,
  children,
  steps,
  activeIndex,
  stepsIntro,
  action,
  actionDisabled = false,
  cancelLabel = "Cancel",
  onConfirm,
  busy = false,
  complete = false,
  preparing = false,
  status,
  error,
  footerContent,
}: {
  open: boolean;
  onClose: () => void;
  eyebrow?: string;
  title: ReactNode;
  rows?: readonly TxConfirmRow[];
  /** Extra body content under the rows (warnings, notes, custom grids). */
  children?: ReactNode;
  steps: ComponentProps<typeof TxSteps>["steps"];
  activeIndex: number;
  stepsIntro?: string;
  /** Null while a read-only phase advances automatically; dismissal remains available. */
  action: string | null;
  actionDisabled?: boolean;
  cancelLabel?: string;
  onConfirm: () => void;
  busy?: boolean;
  complete?: boolean;
  /** Rows and steps are still being read; `status` says what is happening. */
  preparing?: boolean;
  status?: ReactNode;
  error?: ReactNode;
  /** Controls tied to the final action, after the review's rows and steps. */
  footerContent?: ReactNode;
}) {
  const titleId = useId();
  // Inside a ModalShell already, the confirm replaces that card's content in
  // place: one scrim, one card, and closing brings the form back.
  const host = useEnclosingModalCard();
  // Hosted, the confirm has no dialog of its own: while busy it keeps the
  // enclosing shell open, or Escape there would drop a send in flight.
  useHoldEnclosingModal(open && busy);
  useEffect(() => {
    if (!host || !open) return;
    const hidden = Array.from(host.children).filter(
      (child): child is HTMLElement =>
        child instanceof HTMLElement && !child.hasAttribute("data-tx-confirm") && !child.hidden,
    );
    hidden.forEach((child) => (child.hidden = true));
    return () => hidden.forEach((child) => (child.hidden = false));
  }, [host, open]);
  if (!open) return null;
  const statusText = typeof status === "string" ? formatTransactionMessage(status) : status;
  const errorText = typeof error === "string" ? formatTransactionMessage(error) : error;
  const section = (
    <section
      data-tx-confirm
      className={
        host
          ? "w-full bg-melon-25"
          : "w-full max-w-lg overflow-hidden border border-melon-700 bg-melon-25 shadow-2xl sm:my-auto"
      }
    >
      <header className="flex items-start justify-between gap-4 border-b border-melon-300 bg-melon-25 px-5 py-4">
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-wide text-amber-700">{eyebrow}</p>
          <h2 id={titleId} className="mt-1 text-xl font-medium text-zinc-900">
            {title}
          </h2>
        </div>
        <ModalCloseButton
          onClick={onClose}
          disabled={busy}
          aria-label="Close"
          className="-mr-2 -mt-2 transition-transform hover:scale-110 hover:bg-transparent disabled:opacity-40"
        />
      </header>
      <div className="space-y-4 px-5 py-5">
        {preparing ? (
          <p className="py-2 text-sm text-amber-900" role="status">
            {typeof statusText === "string" ? (
              <LoadingText text={statusText} active />
            ) : (
              (statusText ?? <LoadingText text="Preparing…" />)
            )}
          </p>
        ) : (
          <>
            {rows && rows.length > 0 ? (
              <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
                {rows.map((row, index) => (
                  <TxConfirmRowItem key={index} row={row} />
                ))}
              </div>
            ) : null}
            {children}
            <TxSteps
              steps={steps}
              activeIndex={complete ? steps.length : activeIndex}
              intro={stepsIntro}
              className="border border-melon-200 bg-melon-50 p-3"
            />
            {status ? (
              <p className="text-sm text-amber-900" role="status">
                {typeof statusText === "string" ? (
                  <LoadingText text={statusText} active={busy || action === null || undefined} />
                ) : (
                  statusText
                )}
              </p>
            ) : null}
          </>
        )}
        {error ? (
          <p role="alert" className="wrap-anywhere text-sm text-red-600">
            {errorText}
          </p>
        ) : null}
      </div>
      {complete || action || footerContent ? (
        <footer className="flex flex-wrap items-end justify-end gap-2 border-t border-melon-300 bg-melon-25 px-5 py-4">
          {complete ? (
            <button
              type="button"
              className="min-h-[44px] border border-melon-700 bg-melon-500 px-5 text-sm font-bold disabled:cursor-not-allowed disabled:opacity-40"
              onClick={onClose}
            >
              Done
            </button>
          ) : (
            <>
              {footerContent ? <div className="w-full">{footerContent}</div> : null}
              {action ? (
                <>
                  <button
                    type="button"
                    className="min-h-[44px] border border-melon-600 px-5 text-sm disabled:cursor-not-allowed disabled:opacity-40"
                    disabled={busy}
                    onClick={onClose}
                  >
                    {cancelLabel}
                  </button>
                  <button
                    type="button"
                    className="min-h-[44px] border border-melon-700 bg-melon-500 px-5 text-sm font-bold disabled:cursor-not-allowed disabled:opacity-40"
                    disabled={busy || preparing || actionDisabled}
                    aria-busy={preparing || undefined}
                    onClick={onConfirm}
                  >
                    {action}
                  </button>
                </>
              ) : null}
            </>
          )}
        </footer>
      ) : null}
    </section>
  );
  if (host) return createPortal(section, host);
  return (
    <ModalDialog
      onClose={onClose}
      dismissible={!busy}
      labelledBy={titleId}
      className="items-start justify-center px-3 py-6"
    >
      {section}
    </ModalDialog>
  );
}

function TxConfirmRowItem({ row }: { row: TxConfirmRow }) {
  return (
    <>
      <span className="text-zinc-500">{row.label}</span>
      <span
        className={`min-w-0 text-right text-zinc-900 ${
          row.mono ? "break-all font-mono text-xs" : "break-words"
        } ${row.strong ? "font-medium" : ""}`}
      >
        {row.value}
      </span>
    </>
  );
}

/** The pay confirm's row grammar: a label on the left, the value on the right. */
export function SummaryRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <span className="shrink-0 text-sm text-zinc-500">{label}</span>
      <span className="min-w-0 wrap-anywhere text-right text-sm text-zinc-900">{children}</span>
    </div>
  );
}
