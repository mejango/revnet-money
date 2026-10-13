"use client";

import { ModalCloseButton, ModalDialog } from "@/components/ui/ModalShell";
import type { HeldWritePrompt } from "@/lib/held-write";

/**
 * An earlier wallet write of the same call has no confirmed result. The user
 * checks their wallet, then sends again or stops here.
 */
export function HeldWriteDialog({
  id,
  prompt,
  onFinish,
}: {
  id: number;
  prompt: HeldWritePrompt;
  onFinish: (sendAgain: boolean) => void;
}) {
  const titleId = `held-write-title-${id}`;
  const descriptionId = `held-write-description-${id}`;
  return (
    <ModalDialog
      onClose={() => onFinish(false)}
      labelledBy={titleId}
      describedBy={descriptionId}
      className="items-start justify-center px-3 py-5 sm:px-6 sm:py-10"
    >
      <div className="w-full max-w-lg overflow-hidden border border-melon-700 bg-melon-25 shadow-2xl">
        <header className="flex items-start justify-between gap-4 border-b border-melon-300 px-5 py-4 sm:px-6">
          <h2 id={titleId} className="text-xl font-medium text-zinc-900">
            Check your wallet
          </h2>
          <ModalCloseButton
            onClick={() => onFinish(false)}
            aria-label="Close"
            className="-mr-2 -mt-2"
          />
        </header>
        <div id={descriptionId} className="space-y-2 px-5 py-5 text-sm text-zinc-700 sm:px-6">
          <p>{prompt.held}</p>
          <p>{prompt.exit}</p>
        </div>
        <footer className="flex flex-wrap justify-end gap-2 border-t border-melon-300 bg-melon-50 px-5 py-4 sm:px-6">
          <button
            type="button"
            onClick={() => onFinish(false)}
            className="min-h-[44px] border border-melon-600 px-5 text-sm"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onFinish(true)}
            className="min-h-[44px] border border-melon-700 bg-melon-500 px-5 text-sm font-bold"
          >
            {prompt.confirmLabel}
          </button>
        </footer>
      </div>
    </ModalDialog>
  );
}
