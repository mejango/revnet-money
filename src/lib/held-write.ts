"use client";

import {
  WRITE_EXIT_LABEL,
  writeExitMessage,
  writeHeldMessage,
} from "@bananapus/nana-sdk-core/review";

/** What the held-write prompt shows: the SDK's held line and what sending again does. */
export type HeldWritePrompt = {
  held: string;
  exit: string;
  confirmLabel: string;
};

type HeldWriteHandler = (prompt: HeldWritePrompt) => Promise<boolean>;

let handler: HeldWriteHandler | null = null;

/** The app's dialog provider answers held-write prompts. Returns the unregister. */
export function registerHeldWriteHandler(next: HeldWriteHandler): () => void {
  handler = next;
  return () => {
    if (handler === next) handler = null;
  };
}

/** The prompt for an earlier write of this exact call that has no confirmed result. */
export function heldWritePrompt(call: { value?: bigint | string }): HeldWritePrompt {
  return {
    held: writeHeldMessage(),
    exit: writeExitMessage(call),
    confirmLabel: WRITE_EXIT_LABEL,
  };
}

/**
 * Asks the user whether they checked their wallet for the earlier write. True
 * only when they chose to send again; false without a dialog provider.
 */
export async function confirmHeldWriteExit(call: { value?: bigint | string }): Promise<boolean> {
  return handler ? handler(heldWritePrompt(call)) : false;
}
