"use client";

import {
  relayrDiscardLine,
  WRITE_EXIT_LABEL,
  writeExitMessage,
  writeHeldMessage,
} from "@bananapus/nana-sdk-core/review";

/** A choice a flow asks for mid-action: a short title, its lines, and the one way on. */
export type FlowChoice = {
  title: string;
  lines: string[];
  confirmLabel: string;
};

type FlowChoiceHandler = (choice: FlowChoice) => Promise<boolean>;

let handler: FlowChoiceHandler | null = null;

/** The app's dialog provider answers flow choices. Returns the unregister. */
export function registerFlowChoiceHandler(next: FlowChoiceHandler): () => void {
  handler = next;
  return () => {
    if (handler === next) handler = null;
  };
}

/** True only when the user took the way on; false without a dialog provider. */
async function chooseInFlow(choice: FlowChoice): Promise<boolean> {
  return handler ? handler(choice) : false;
}

/**
 * An earlier write of this exact call has no confirmed result. True only when
 * the user checked their wallet and chose to send again.
 */
export function confirmHeldWriteExit(call: { value?: bigint | string }): Promise<boolean> {
  return chooseInFlow({
    title: "Check your wallet",
    lines: [writeHeldMessage(), writeExitMessage(call)],
    confirmLabel: WRITE_EXIT_LABEL,
  });
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
