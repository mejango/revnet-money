"use client";

import {
  relayrDiscardLine,
  WRITE_EXIT_LABEL,
  writeExitMessage,
} from "@bananapus/nana-sdk-core/review";

/** A choice a flow asks for mid-action: a short title, its lines, and the one way on. */
export type FlowChoice = {
  title: string;
  lines: string[];
  confirmLabel: string;
};

/** `signal` closes the choice unanswered, as when the chain answers it first. */
type FlowChoiceHandler = (choice: FlowChoice, signal?: AbortSignal) => Promise<boolean>;

let handler: FlowChoiceHandler | null = null;

/** The app's dialog provider answers flow choices. Returns the unregister. */
export function registerFlowChoiceHandler(next: FlowChoiceHandler): () => void {
  handler = next;
  return () => {
    if (handler === next) handler = null;
  };
}

/** True only when the user took the way on; false without a dialog provider. */
async function chooseInFlow(choice: FlowChoice, signal?: AbortSignal): Promise<boolean> {
  if (signal?.aborted) return false;
  if (!handler) return false;
  return signal ? handler(choice, signal) : handler(choice);
}

/**
 * An earlier write of this exact call has no confirmed result: the hold's own
 * line, then what sending again does. True only when the user checked their
 * wallet and chose to send again.
 */
export function confirmHeldWriteExit(
  held: { line: string; warning?: string; record: { call: { value?: bigint | string } } },
  signal?: AbortSignal,
): Promise<boolean> {
  return chooseInFlow(
    {
      title: "Check your wallet",
      lines: [
        held.line,
        writeExitMessage(held.record.call),
        ...(held.warning ? [held.warning] : []),
      ],
      confirmLabel: WRITE_EXIT_LABEL,
    },
    signal,
  );
}

/**
 * An earlier signature of this action may already have run. True only when
 * the user chose to discard it after checking the revnet.
 */
export function confirmRelayrDiscard(): Promise<boolean> {
  return chooseInFlow({
    title: "Check the revnet",
    lines: [relayrDiscardLine("ran", { subject: "revnet" })],
    confirmLabel: "Discard",
  });
}
