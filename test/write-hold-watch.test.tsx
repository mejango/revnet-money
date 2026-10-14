import { useWriteHoldWatch } from "@/hooks/useWriteHoldWatch";
import type { WriteHoldState } from "@bananapus/nana-sdk-core/review";
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const RECORD = { call: { to: "0x1", data: "0x", value: "0" } };
const exitShown = {
  status: "held-unchecked",
  record: RECORD,
  exit: true,
  line: "Check your wallet.",
} as unknown as WriteHoldState;
const pending = {
  status: "pending-known-hash",
  record: RECORD,
  exit: false,
  line: "Still pending in your wallet.",
} as unknown as WriteHoldState;

/** A hold whose state() emits `emitted` to its subscribers, then returns `returned`. */
function holdAnswering(emitted: WriteHoldState, returned: WriteHoldState) {
  let listener: (state: WriteHoldState) => void = () => undefined;
  return {
    emit: (state: WriteHoldState) => listener(state),
    subscribe: (next: (state: WriteHoldState) => void) => ((listener = next), () => undefined),
    state: vi.fn(async () => {
      listener(emitted);
      return returned;
    }),
  };
}

describe("useWriteHoldWatch", () => {
  it("removes a shown exit once a checked answer finds the transaction pending", async () => {
    // The SDK emits the state, then returns it with `checked` set.
    const hold = holdAnswering(pending, { ...pending, checked: true });
    const onState = vi.fn();
    const { result } = renderHook(() => useWriteHoldWatch(hold as never, {} as never, onState));
    act(() => hold.emit(exitShown));
    await act(async () => result.current());
    expect(onState).toHaveBeenLastCalledWith(expect.objectContaining({ exit: false }));
  });

  it("keeps a shown exit when the answer is contended", async () => {
    const hold = holdAnswering(pending, { ...pending, checked: false });
    const onState = vi.fn();
    const { result } = renderHook(() => useWriteHoldWatch(hold as never, {} as never, onState));
    act(() => hold.emit(exitShown));
    await act(async () => result.current());
    expect(onState).toHaveBeenLastCalledWith(exitShown);
  });
});
