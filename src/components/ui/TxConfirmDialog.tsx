"use client";

import { ButtonWithWallet } from "@/components/ButtonWithWallet";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { TxSteps } from "@/components/ui/TxSteps";
import type { JBChainId } from "@bananapus/nana-sdk-core";
import type { ComponentProps } from "react";

/**
 * The Pay confirm's shell, for every write: a title, label/value rows, the
 * wallet-prompt queue, then one right-aligned action. Closing is the way back
 * to the form; a flow mid-signature cannot be closed.
 */
export function TxConfirmDialog({
  open,
  onOpenChange,
  title,
  chainId,
  steps,
  activeIndex,
  stepsIntro,
  action,
  onConfirm,
  busy = false,
  status,
  error,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  chainId: JBChainId;
  steps: ComponentProps<typeof TxSteps>["steps"];
  /** Index of the step the wallet is on; -1 before the first prompt. */
  activeIndex: number;
  /** Replaces the "Your wallet will ask for N actions" line. */
  stepsIntro?: string;
  action: string;
  onConfirm: () => void;
  busy?: boolean;
  status?: string | null;
  error?: string | null;
  children?: React.ReactNode;
}) {
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (busy) return;
        onOpenChange(next);
      }}
    >
      <DialogContent className="max-w-lg">
        <DialogHeader className="text-left">
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription asChild>
            <div className="text-left">
              <div className="flex flex-col gap-3 py-2">
                {children}
                <TxSteps steps={steps} activeIndex={activeIndex} intro={stepsIntro} />
                {status ? <p className="text-sm text-zinc-500">{status}</p> : null}
                {error ? <p className="text-sm text-red-600">{error}</p> : null}
              </div>
              <div className="flex justify-end">
                <ButtonWithWallet
                  targetChainId={chainId}
                  loading={busy}
                  disabled={busy}
                  onClick={onConfirm}
                  connectWalletText="Connect Wallet"
                  className="bg-teal-500 text-melon-950 hover:bg-teal-600"
                >
                  {action}
                </ButtonWithWallet>
              </div>
            </div>
          </DialogDescription>
        </DialogHeader>
      </DialogContent>
    </Dialog>
  );
}

/** The pay confirm's row grammar: a label on the left, the value on the right. */
export function SummaryRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <span className="shrink-0 text-sm text-zinc-500">{label}</span>
      <span className="text-right text-sm text-zinc-900">{children}</span>
    </div>
  );
}
