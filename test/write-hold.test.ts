import {
  HELD_AWAY_SUCCESS_LINE,
  HELD_SEND_AGAIN_LABEL,
  HELD_SUCCESS_LINE,
  WRITE_HOLD_STALE_REVIEW_LINE,
  WriteHeldError,
  WriteHoldStaleReviewError,
  type HeldWriteView,
} from "@bananapus/nana-sdk-core/review";
import { beforeEach, describe, expect, it, vi } from "vitest";

const sdk = vi.hoisted(() => ({
  /** What each send of the fake view does, in order; once empty, it runs the flow. */
  sends: [] as (() => void)[],
  view: undefined as unknown as Record<string, ReturnType<typeof vi.fn>> & {
    shown: HeldWriteView;
    onSettled?: (settled: { result: string; hash: string }) => void;
  },
}));

vi.mock("@bananapus/nana-sdk-core/review", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@bananapus/nana-sdk-core/review")>()),
  // The SDK's own view is tested in the SDK; here, only how the app binds it.
  createHeldWriteView: (_handle: unknown, options: { onSettled?: never }) => {
    const shown: HeldWriteView = {
      phase: "clear",
      state: null,
      line: null,
      exit: false,
      adopting: false,
    };
    const view = {
      shown,
      onSettled: options.onSettled,
      get: vi.fn(() => view.shown),
      subscribe: vi.fn(() => () => undefined),
      start: vi.fn(() => () => undefined),
      check: vi.fn(async () => view.shown),
      exit: vi.fn(async () => true),
      acknowledge: vi.fn(async () => undefined),
      send: vi.fn(async (run: (gate: unknown) => Promise<string>) => {
        const next = sdk.sends.shift();
        if (next) next();
        return run(gate);
      }),
    };
    sdk.view = view as never;
    return view;
  },
}));

const gate = {
  beforeSend: vi.fn(async () => undefined),
  afterSubmit: vi.fn(),
  onRejected: vi.fn(),
};
const HASH = `0x${"12".repeat(32)}` as const;
const EXIT_STATE = {
  status: "held-no-hash",
  exit: true,
  line: "Your earlier transaction hasn't confirmed yet. Check your wallet.",
  record: { call: { to: "0x1", data: "0x", value: "0" } },
} as never;

async function load() {
  vi.resetModules();
  const [holds, choice] = await Promise.all([
    import("@/lib/write-hold"),
    import("@/lib/flow-choice"),
  ]);
  const prompt = vi.fn().mockResolvedValue(false);
  choice.registerFlowChoiceHandler(prompt);
  const run = vi.fn(async (sendGate: typeof gate) => {
    await sendGate.beforeSend();
    return HASH;
  });
  const send = () => holds.sendHeld({} as never, {} as never, run as never);
  return { holds, prompt, run, send };
}

/** The view shows `shown` once its send throws `error`. */
const refusesWith = (error: Error, shown: Partial<HeldWriteView>) => () => {
  sdk.view.shown = { ...sdk.view.shown, ...shown };
  throw error;
};

beforeEach(() => {
  sdk.sends = [];
  gate.beforeSend.mockClear();
  gate.onRejected.mockClear();
});

describe("sendHeld: one SDK held-write view per send", () => {
  it("sends straight through a clear hold and follows the write", async () => {
    const { send, prompt } = await load();
    await expect(send()).resolves.toBe(HASH);
    expect(sdk.view.start).toHaveBeenCalledOnce();
    expect(prompt).not.toHaveBeenCalled();
  });

  it("ends with the view's line, and never prompts, when the hold offers no exit", async () => {
    const { send, prompt, run } = await load();
    sdk.sends.push(
      refusesWith(new WriteHeldError(EXIT_STATE), {
        phase: "confirming",
        line: "Confirming your transaction.",
        exit: false,
      }),
    );
    await expect(send()).rejects.toThrow("Confirming your transaction.");
    expect(prompt).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
  });

  it("releases on the user's exit and reopens the review once, sending once", async () => {
    const { send, prompt, run } = await load();
    prompt.mockResolvedValue(true);
    sdk.sends.push(
      refusesWith(new WriteHeldError(EXIT_STATE), {
        phase: "held",
        state: EXIT_STATE,
        line: "Held.",
        exit: true,
      }),
    );
    await expect(send()).resolves.toBe(HASH);
    expect(sdk.view.exit).toHaveBeenCalledOnce();
    expect(run).toHaveBeenCalledOnce();
  });

  it("keeps the hold when the user declines its exit, or the chain ends it first", async () => {
    const { send, prompt, run } = await load();
    sdk.sends.push(
      refusesWith(new WriteHeldError(EXIT_STATE), {
        phase: "held",
        state: EXIT_STATE,
        line: "Held.",
        exit: true,
      }),
    );
    await expect(send()).rejects.toThrow("Held.");
    expect(sdk.view.exit).not.toHaveBeenCalled();

    prompt.mockResolvedValue(true);
    sdk.sends.push(
      refusesWith(new WriteHeldError(EXIT_STATE), {
        phase: "held",
        state: EXIT_STATE,
        line: "Held.",
        exit: true,
      }),
    );
    const { send: again } = { send };
    const pending = again();
    // The exit finds the earlier write settled: nothing is sent again.
    sdk.view.exit.mockImplementationOnce(async () => {
      sdk.view.shown = {
        ...sdk.view.shown,
        phase: "settled",
        line: HELD_SUCCESS_LINE,
        exit: false,
      };
      return false;
    });
    await expect(pending).rejects.toThrow(HELD_SUCCESS_LINE);
    expect(run).not.toHaveBeenCalled();
  });

  it("asks before sending again a success that settled while the user was away", async () => {
    const { send, prompt, run } = await load();
    const away = refusesWith(new Error(HELD_AWAY_SUCCESS_LINE), {
      phase: "succeeded",
      line: HELD_AWAY_SUCCESS_LINE,
    });
    sdk.sends.push(away);
    await expect(send()).rejects.toThrow(HELD_AWAY_SUCCESS_LINE);
    expect(prompt).toHaveBeenCalledWith(
      expect.objectContaining({ confirmLabel: HELD_SEND_AGAIN_LABEL }),
    );
    expect(sdk.view.acknowledge).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();

    prompt.mockResolvedValue(true);
    sdk.sends.push(away, () => {
      sdk.view.shown = { ...sdk.view.shown, phase: "clear", line: null };
    });
    await expect(send()).resolves.toBe(HASH);
    expect(sdk.view.acknowledge).toHaveBeenCalledOnce();
    expect(run).toHaveBeenCalledOnce();
  });

  it("asks for a fresh review when another window sent it, saying how that ended", async () => {
    const { send } = await load();
    sdk.sends.push(() => {
      throw new WriteHoldStaleReviewError();
    });
    await expect(send()).rejects.toThrow(WRITE_HOLD_STALE_REVIEW_LINE);
    sdk.sends.push(() => {
      throw new WriteHoldStaleReviewError({ result: "success", hash: HASH });
    });
    await expect(send()).rejects.toThrow(HELD_SUCCESS_LINE);
  });

  it("never sends again a success the view tells during this send's own check", async () => {
    const { send } = await load();
    // The earlier attempt settles while this send checks it: the view tells it, and its own
    // gate would let the send through.
    sdk.sends.push(() => sdk.view.onSettled?.({ result: "success", hash: HASH }));
    await expect(send()).rejects.toThrow(HELD_SUCCESS_LINE);
    expect(gate.beforeSend).not.toHaveBeenCalled();
  });
});
