import { registerFlowChoiceHandler } from "@/lib/flow-choice";
import { sendUnderHold, WENT_THROUGH } from "@/lib/write-hold";
import {
  WRITE_HOLD_REVERTED_LINE,
  WRITE_HOLD_STALE_REVIEW_LINE,
  WriteHeldError,
  WriteHoldStaleReviewError,
  type WriteHeldState,
} from "@bananapus/nana-sdk-core/review";
import { describe, expect, it, vi } from "vitest";

const RECORD = { call: { to: "0x1", data: "0x", value: "0" } };
const exitState = (line = "Check your wallet.") =>
  ({ status: "held-no-hash", record: RECORD, exit: true, line }) as unknown as WriteHeldState;
/** A checked answer with no exit: the chain was read under the call's lock. */
const noExitState = {
  status: "pending-known-hash",
  record: RECORD,
  exit: false,
  checked: true,
  line: "Still pending in your wallet. Speed it up or cancel it there.",
} as unknown as WriteHeldState;

/** A hold whose sends throw `held` the given number of times, then run. */
function holdThat(options: { held: WriteHeldState[]; exit?: unknown; state?: unknown }) {
  const queue = [...options.held];
  return {
    send: vi.fn(async (_client: unknown, run: (gate: unknown) => Promise<string>) => {
      const next = queue.shift();
      if (next) throw new WriteHeldError(next as never);
      return run({});
    }),
    exit: vi.fn(async () => options.exit ?? { released: true, state: { status: "clear" } }),
    state: vi.fn(async () => options.state ?? exitState()),
    peek: vi.fn(() => ({ status: "clear" })),
  };
}

const run = async () => "0xsent";
const client = {} as never;

describe("sendUnderHold", () => {
  it("sends straight through a clear hold", async () => {
    const hold = holdThat({ held: [] });
    await expect(sendUnderHold(hold as never, client, run)).resolves.toBe("0xsent");
    expect(hold.exit).not.toHaveBeenCalled();
  });

  it("offers no exit to a pending hold and says the SDK's line", async () => {
    const prompt = vi.fn().mockResolvedValue(true);
    registerFlowChoiceHandler(prompt);
    const hold = holdThat({ held: [noExitState] });
    await expect(sendUnderHold(hold as never, client, run)).rejects.toThrow(noExitState.line);
    expect(prompt).not.toHaveBeenCalled();
  });

  it("keeps the hold when the user declines the exit", async () => {
    registerFlowChoiceHandler(vi.fn().mockResolvedValue(false));
    const hold = holdThat({ held: [exitState("Held line.")] });
    await expect(sendUnderHold(hold as never, client, run)).rejects.toThrow("Held line.");
    expect(hold.exit).not.toHaveBeenCalled();
  });

  it("releases the exact state the user saw and sends again", async () => {
    registerFlowChoiceHandler(vi.fn().mockResolvedValue(true));
    const shown = exitState();
    const hold = holdThat({ held: [shown] });
    await expect(sendUnderHold(hold as never, client, run)).resolves.toBe("0xsent");
    expect(hold.exit).toHaveBeenCalledExactlyOnceWith(shown, { checkedWallet: true }, client);
  });

  it("does not send again when the exit finds the earlier write succeeded", async () => {
    registerFlowChoiceHandler(vi.fn().mockResolvedValue(true));
    const hold = holdThat({
      held: [exitState()],
      exit: { released: false, state: { status: "clear", settled: { result: "success" } } },
    });
    await expect(sendUnderHold(hold as never, client, run)).rejects.toThrow(WENT_THROUGH);
    expect(hold.send).toHaveBeenCalledOnce();
  });

  it("shows the state that refused the exit instead of sending", async () => {
    registerFlowChoiceHandler(vi.fn().mockResolvedValue(true));
    const hold = holdThat({
      held: [exitState()],
      exit: { released: false, state: noExitState },
    });
    await expect(sendUnderHold(hold as never, client, run)).rejects.toThrow(noExitState.line);
    expect(hold.send).toHaveBeenCalledOnce();
  });

  it("does not send when the exit finds the hold already gone", async () => {
    registerFlowChoiceHandler(vi.fn().mockResolvedValue(true));
    const hold = holdThat({
      held: [exitState()],
      exit: { released: false, state: { status: "clear" } },
    });
    await expect(sendUnderHold(hold as never, client, run)).rejects.toThrow(WENT_THROUGH);
    expect(hold.send).toHaveBeenCalledOnce();
  });

  it("passes other errors through", async () => {
    const hold = holdThat({ held: [] });
    hold.send.mockRejectedValueOnce(new Error("Wallet refused"));
    await expect(sendUnderHold(hold as never, client, run)).rejects.toThrow("Wallet refused");
  });

  it("closes an open exit when the chain settles the write, and says it went through", async () => {
    vi.useFakeTimers();
    registerFlowChoiceHandler(
      (_choice, signal) =>
        new Promise<boolean>((resolve) => signal?.addEventListener("abort", () => resolve(false))),
    );
    const hold = holdThat({
      held: [exitState()],
      state: { status: "clear", settled: { result: "success" } },
    });
    const sent = expect(sendUnderHold(hold as never, client, run)).rejects.toThrow(WENT_THROUGH);
    await vi.advanceTimersByTimeAsync(3_100);
    await sent;
  });

  it("closes an open exit on a state with no exit, and shows its line", async () => {
    vi.useFakeTimers();
    registerFlowChoiceHandler(
      (_choice, signal) =>
        new Promise<boolean>((resolve) => signal?.addEventListener("abort", () => resolve(false))),
    );
    const hold = holdThat({ held: [exitState()], state: noExitState });
    const sent = expect(sendUnderHold(hold as never, client, run)).rejects.toThrow(
      noExitState.line,
    );
    await vi.advanceTimersByTimeAsync(3_100);
    await sent;
  });

  it("does not send when the recheck finds the hold cleared without a settled result", async () => {
    vi.useFakeTimers();
    registerFlowChoiceHandler(
      (_choice, signal) =>
        new Promise<boolean>((resolve) => signal?.addEventListener("abort", () => resolve(false))),
    );
    const hold = holdThat({ held: [exitState()], state: { status: "clear" } });
    const sent = expect(sendUnderHold(hold as never, client, run)).rejects.toThrow(WENT_THROUGH);
    await vi.advanceTimersByTimeAsync(3_100);
    await sent;
    expect(hold.send).toHaveBeenCalledOnce();
  });

  it("keeps a settlement an in-flight poll returns after the user accepts, and sends nothing", async () => {
    vi.useFakeTimers();
    let answer: (accepted: boolean) => void = () => {};
    registerFlowChoiceHandler(() => new Promise<boolean>((resolve) => (answer = resolve)));
    const hold = holdThat({ held: [exitState()] });
    let finish: (state: unknown) => void = () => {};
    hold.state.mockImplementation(() => new Promise((resolve) => (finish = resolve)) as never);
    const sent = expect(sendUnderHold(hold as never, client, run)).rejects.toThrow(WENT_THROUGH);
    // The poll is in flight when the user accepts, and settles after.
    await vi.advanceTimersByTimeAsync(3_100);
    answer(true);
    await vi.advanceTimersByTimeAsync(0);
    finish({ status: "clear", settled: { result: "success" } });
    await sent;
    expect(hold.send).toHaveBeenCalledOnce();
    expect(hold.exit).not.toHaveBeenCalled();
  });

  it("shows a reverted settlement as failed, and sends nothing", async () => {
    vi.useFakeTimers();
    registerFlowChoiceHandler(
      (_choice, signal) =>
        new Promise<boolean>((resolve) => signal?.addEventListener("abort", () => resolve(false))),
    );
    const hold = holdThat({
      held: [exitState()],
      state: { status: "clear", settled: { result: "failed" } },
    });
    const sent = expect(sendUnderHold(hold as never, client, run)).rejects.toThrow(
      WRITE_HOLD_REVERTED_LINE,
    );
    await vi.advanceTimersByTimeAsync(3_100);
    await sent;
    expect(hold.send).toHaveBeenCalledOnce();
  });
});

describe("sendUnderHold with SDK 2.35", () => {
  it("asks for a fresh review when another window sent the same write while this review was open", async () => {
    const hold = holdThat({ held: [] });
    hold.send.mockRejectedValueOnce(new WriteHoldStaleReviewError());
    await expect(sendUnderHold(hold as never, client, run)).rejects.toThrow(
      WRITE_HOLD_STALE_REVIEW_LINE,
    );
  });

  it("says how the other window's write ended when the stale review carries it", async () => {
    const hold = holdThat({ held: [] });
    hold.send.mockRejectedValueOnce(
      new WriteHoldStaleReviewError({ result: "success", hash: `0x${"12".repeat(32)}` }),
    );
    await expect(sendUnderHold(hold as never, client, run)).rejects.toThrow(WENT_THROUGH);
  });

  it("shows the hold's notice with its line, in the refusal and in the exit", async () => {
    const prompt = vi.fn().mockResolvedValue(false);
    registerFlowChoiceHandler(prompt);
    const notice =
      "This browser can't remember pending transactions. Check your wallet before repeating one.";
    const refused = holdThat({ held: [{ ...noExitState, notice } as never] });
    await expect(sendUnderHold(refused as never, client, run)).rejects.toThrow(notice);
    const offered = holdThat({ held: [{ ...exitState("Held line."), notice } as never] });
    await expect(sendUnderHold(offered as never, client, run)).rejects.toThrow("Held line.");
    expect(prompt).toHaveBeenCalledWith(
      expect.objectContaining({ lines: expect.arrayContaining(["Held line.", notice]) }),
      expect.any(AbortSignal),
    );
  });
});

describe("sendUnderHold with a contended hold (checked: false)", () => {
  /** What the hold answers when another tab or flow holds the call's lock: its exit hidden. */
  const contended = { ...exitState("Held line."), exit: false, checked: false };

  it("keeps an open exit when a recheck is contended", async () => {
    vi.useFakeTimers();
    let answer: (accepted: boolean) => void = () => undefined;
    const prompt = vi.fn(
      (_choice: unknown, signal?: AbortSignal) =>
        new Promise<boolean>((resolve) => {
          answer = resolve;
          signal?.addEventListener("abort", () => resolve(false));
        }),
    );
    registerFlowChoiceHandler(prompt);
    const hold = holdThat({ held: [exitState("Held line.")], state: contended });
    const sent = sendUnderHold(hold as never, client, run);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(hold.state).toHaveBeenCalled();
    // Still open: the user's answer is the one that counts.
    answer(true);
    await expect(sent).resolves.toBe("0xsent");
    vi.useRealTimers();
  });

  it("keeps the exit the user saw when the exit itself is contended, and sends nothing", async () => {
    registerFlowChoiceHandler(vi.fn().mockResolvedValue(true));
    const hold = holdThat({
      held: [exitState("Held line.")],
      exit: { released: false, state: contended },
    });
    await expect(sendUnderHold(hold as never, client, run)).rejects.toThrow("Held line.");
    // Asked once, with no wait or retry of its own; the exit stays to take again.
    expect(hold.exit).toHaveBeenCalledOnce();
    expect(hold.send).toHaveBeenCalledOnce();
  });
});
