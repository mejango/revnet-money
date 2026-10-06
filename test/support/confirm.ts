import { fireEvent, waitFor, within } from "@testing-library/react";
import { expect } from "vitest";

/**
 * The open confirm: the section TxConfirmDialog renders, in its own dialog or
 * in place of the content of the dialog that hosts it.
 */
export async function findConfirm(): Promise<HTMLElement> {
  await waitFor(() => expect(document.querySelector("[data-tx-confirm]")).not.toBeNull());
  return document.querySelector<HTMLElement>("[data-tx-confirm]")!;
}

/** Whether a confirm is on screen. */
export function confirmIsOpen(): boolean {
  return document.querySelector("[data-tx-confirm]") !== null;
}

/**
 * Tries every way out of a confirm whose send is in flight: its Cancel and ×,
 * Escape, and a press on the backdrop of the dialog it sits in. Each must be
 * refused, so the confirm and its send stay on screen.
 */
export function expectEveryWayOutRefused(confirm: HTMLElement) {
  const cancel = within(confirm).getByRole("button", { name: "Cancel" });
  const close = within(confirm).getByRole("button", { name: "Close" });
  expect(cancel).toBeDisabled();
  expect(close).toBeDisabled();
  fireEvent.click(cancel);
  fireEvent.click(close);
  fireEvent.keyDown(document, { key: "Escape" });
  const dialog = confirm.closest("dialog");
  expect(dialog).not.toBeNull();
  fireEvent.pointerDown(dialog!);
  expect(confirm.isConnected).toBe(true);
  expect(dialog!.open).toBe(true);
}
