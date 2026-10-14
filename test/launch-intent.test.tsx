import {
  LaunchCheckNotice,
  LaunchConfirmingNotice,
  LaunchedNotice,
} from "@/app/create/form/LaunchedNotice";
import {
  launchConfigHash,
  launchConfigOf,
  launchInputOf,
  launchKeyOf,
  launchNamespacesOf,
  recoverLaunch,
  releaseLaunch,
  retireLaunch,
  saveLaunchAttempt,
  savedLaunchAt,
  savedLaunchKeys,
} from "@/app/create/helpers/launchIntent";
import { legacyIntents } from "@/lib/legacy-intents";
import { launchIntent as sdkLaunchIntent } from "@bananapus/nana-sdk-core/review";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/** The launch's SDK intent, from the form as the page builds it. */
const launchIntent = (form: unknown) =>
  sdkLaunchIntent({ chainId: 1, account: ACCOUNT, config: launchConfigOf(form) });

const ACCOUNT = "0x000000000000000000000000000000000000dEaD";
const salt = (n: number) => `0x${n.toString(16).padStart(64, "0")}` as const;
const SENT = `0x${"12".repeat(32)}` as const;
const EARLIER = `0x${"34".repeat(32)}` as const;
const BLOCK = `0x${"bb".repeat(32)}` as const;
const config = { name: "Rev" };
const key = () => launchKeyOf(ACCOUNT, 1, config);

beforeEach(() => window.localStorage.clear());

describe("a launch's intent", () => {
  it("is the user's config alone, whatever order its fields are in", () => {
    expect(launchIntent({ name: "Rev", stages: [{ price: "1" }] })).toEqual(
      launchIntent({ stages: [{ price: "1" }], name: "Rev" }),
    );
    expect(launchIntent({ name: "Rev" })).not.toEqual(launchIntent({ name: "Rev2" }));
  });

  it("is held by its SDK intent and the namespace the main-era build held it by", () => {
    expect(launchNamespacesOf(1, ACCOUNT, config)).toEqual([
      launchIntent(config),
      ...legacyIntents.launch(launchConfigHash(config)),
    ]);
  });
});

/** A hold that reads `state`; `asked` is what the chain says once asked. */
const holdOf = (state: object, asked: object = state) => ({
  peek: () => state,
  state: vi.fn(async () => asked),
});
const clear = (settled?: { result: "success" | "failed"; hash: `0x${string}` }) =>
  holdOf({ status: "clear", ...(settled ? { settled } : {}) });
const held = holdOf({ status: "pending-known-hash", exit: false, line: "Held." });
const open = (...holds: object[]) => vi.fn(() => holds as never);

/** A chain with the settled hash's receipt and block logs, whose event scan fails by default. */
const chain = ({
  receipt = { status: "success", blockHash: BLOCK, transactionHash: SENT } as unknown,
  blockLogs = [] as unknown[],
  scan = new Error("RPC down") as unknown[] | Error,
} = {}) => ({
  getBlockNumber: vi.fn(async () => 1_200n),
  getTransactionReceipt: vi.fn(async () => {
    if (receipt instanceof Error) throw receipt;
    return receipt;
  }),
  getLogs: vi.fn(async (args: { blockHash?: string }) => {
    if (args.blockHash) return blockLogs;
    if (scan instanceof Error) throw scan;
    return scan;
  }),
});
const deployedBy = (deploySalt: string, transactionHash: string = SENT, caller = ACCOUNT) => ({
  removed: false,
  transactionHash,
  args: { revnetId: 42n, configuration: { description: { salt: deploySalt } }, caller },
});
/** The journal the page writes once the hold reserved the wallet. */
const save = (attempt: { fromBlock?: bigint; before?: `0x${string}`[] } = { fromBlock: 1_000n }) =>
  saveLaunchAttempt(key(), {
    salt: salt(7),
    namespaces: launchNamespacesOf(1, ACCOUNT, config),
    before: [],
    ...attempt,
  });
const recover = (holds: ReturnType<typeof open>, client: object) =>
  recoverLaunch(key(), ACCOUNT, client as never, holds);

describe("recovering a saved launch: held, settled, no record, check required", () => {
  it("has nothing to recover with no saved launch", async () => {
    await expect(recover(open(clear()), chain())).resolves.toEqual({ status: "none" });
  });

  it("consumes a settlement the hold saved while the page was closed: the revnet, never a second send", async () => {
    save();
    await expect(
      recover(
        open(clear({ result: "success", hash: SENT })),
        chain({ blockLogs: [deployedBy(salt(7))] }),
      ),
    ).resolves.toEqual({ status: "launched", revnetId: 42n });
    expect(savedLaunchAt(key())).toBeUndefined();
  });

  it("asks the chain about an attempt whose hash only the SDK saved: one that went through is the revnet", async () => {
    save();
    const settles = holdOf(
      { status: "pending-known-hash" },
      { status: "clear", settled: { result: "success", hash: SENT } },
    );
    await expect(
      recover(open(settles), chain({ blockLogs: [deployedBy(salt(7))] })),
    ).resolves.toEqual({ status: "launched", revnetId: 42n });
  });

  it.each([
    ["its receipt can't be read", { receipt: new Error("RPC down") }],
    ["its block's logs come back empty", { blockLogs: [] }],
    ["its event names another salt", { blockLogs: [deployedBy(salt(3))] }],
    ["its event is another transaction's", { blockLogs: [deployedBy(salt(7), EARLIER)] }],
  ])(
    "journals a settled success before reading it, and keeps following it when %s: never a discard or resend",
    async (_case, reads) => {
      for (const fromBlock of [1_000n, undefined]) {
        window.localStorage.clear();
        save({ fromBlock });
        await expect(
          recover(open(clear({ result: "success", hash: SENT })), chain({ ...reads, scan: [] })),
        ).resolves.toEqual({ status: "confirming", hash: SENT });
        expect(savedLaunchAt(key())).toMatchObject({
          salt: salt(7),
          settled: { result: "success", hash: SENT },
        });
        // The hold forgets it (a later reservation, another browser's storage): still followed.
        await expect(recover(open(clear()), chain({ ...reads, scan: [] }))).resolves.toEqual({
          status: "confirming",
          hash: SENT,
        });
      }
    },
  );

  it("names the revnet once the journaled success's event can be read", async () => {
    save();
    await recover(open(clear({ result: "success", hash: SENT })), chain({ blockLogs: [] }));
    await expect(
      recover(open(clear()), chain({ blockLogs: [deployedBy(salt(7))] })),
    ).resolves.toEqual({ status: "launched", revnetId: 42n });
    expect(savedLaunchAt(key())).toBeUndefined();
  });

  it("never lets a later failed read downgrade a settled success", async () => {
    save();
    await expect(
      recover(
        open(clear({ result: "success", hash: SENT }), clear({ result: "failed", hash: EARLIER })),
        chain({ blockLogs: [] }),
      ),
    ).resolves.toEqual({ status: "confirming", hash: SENT });
    await expect(
      recover(open(clear({ result: "failed", hash: EARLIER })), chain()),
    ).resolves.toEqual({ status: "confirming", hash: SENT });
    expect(savedLaunchAt(key())).toBeDefined();
  });

  it("ignores a settlement older than the attempt, then requires a check with no other evidence", async () => {
    save({ before: [EARLIER] });
    await expect(
      recover(open(clear({ result: "success", hash: EARLIER })), chain()),
    ).resolves.toEqual({ status: "check" });
  });

  it.each([
    ["the scan fails", new Error("RPC down")],
    ["the scan finds nothing", []],
  ])("requires a check when the hold has no record and %s", async (_case, scan) => {
    save();
    await expect(recover(open(clear()), chain({ scan }))).resolves.toEqual({ status: "check" });
  });

  it("requires a check when the hold has no record and no sent block was saved", async () => {
    save({ fromBlock: undefined });
    await expect(recover(open(clear()), chain({ scan: [] }))).resolves.toEqual({ status: "check" });
  });

  it("finds a launch with no hold record by its exact salt", async () => {
    save();
    await expect(
      recover(open(clear()), chain({ scan: [deployedBy(salt(7), EARLIER)] })),
    ).resolves.toEqual({ status: "launched", revnetId: 42n });
    expect(savedLaunchAt(key())).toBeUndefined();
  });

  it("leaves a held launch to its hold, with the state its exit is offered on", async () => {
    save();
    const client = chain();
    const holds = open(clear(), held);
    await expect(recover(holds, client)).resolves.toMatchObject({
      status: "held",
      state: { status: "pending-known-hash" },
    });
    expect(client.getLogs).not.toHaveBeenCalled();
  });

  it("retires an attempt the hold proved reverted at a final block", async () => {
    save();
    await expect(recover(open(clear({ result: "failed", hash: SENT })), chain())).resolves.toEqual({
      status: "clear",
    });
    expect(savedLaunchAt(key())).toBeUndefined();
  });

  it("requires a check, never a throw, when recovery itself fails", async () => {
    save();
    const broken = vi.fn(() => {
      throw new Error("storage");
    });
    await expect(recover(broken as never, chain())).resolves.toEqual({ status: "check" });
  });

  it("reads at most 500 blocks per request and caps the range", async () => {
    save({ fromBlock: 0n });
    const ranges: [bigint, bigint][] = [];
    const client = {
      ...chain(),
      getBlockNumber: vi.fn(async () => 1_000_000n),
      getLogs: vi.fn(async ({ fromBlock, toBlock }: { fromBlock: bigint; toBlock: bigint }) => {
        ranges.push([fromBlock, toBlock]);
        return [];
      }),
    };
    await expect(recover(open(clear()), client)).resolves.toEqual({ status: "check" });
    expect(ranges.every(([from, to]) => to - from + 1n <= 500n)).toBe(true);
    expect(ranges.reduce((sum, [from, to]) => sum + (to - from + 1n), 0n)).toBeLessThanOrEqual(
      50_000n,
    );
  });
});

describe("a main-era saved launch", () => {
  const node = {
    getChainId: async () => 1,
    getBlockNumber: async () => 100n,
    getBlock: async () => ({ number: 100n, hash: BLOCK }),
    getTransactionCount: async () => 3,
    getTransaction: async () => {
      throw new Error("not found");
    },
    getTransactionReceipt: async () => {
      throw new Error("not found");
    },
    getLogs: async () => {
      throw new Error("RPC down");
    },
    request: async () => null,
  };

  it("is held by the attempt that build left under its launch namespace", async () => {
    // That build saved only the salt and the block; the wallet returned a hash, then the page closed.
    window.localStorage.setItem(key(), JSON.stringify({ salt: salt(7), fromBlock: "1000" }));
    const { writeHolds } = await import("@/lib/write-hold");
    await writeHolds
      .open({
        chainId: 1,
        account: ACCOUNT,
        safe: false,
        namespace: legacyIntents.launch(launchConfigHash(config))[0]!,
        call: { to: "0x0000000000000000000000000000000000001000", data: "0x1234", value: 0n },
      })
      .send(node as never, async (gate) => {
        await gate.beforeSend();
        gate.afterSubmit(SENT);
      });
    await expect(recoverLaunch(key(), ACCOUNT, node as never)).resolves.toMatchObject({
      status: "held",
    });
  });

  it("requires a check when that build left no hold and the chain can't be scanned", async () => {
    window.localStorage.setItem(key(), JSON.stringify({ salt: salt(7), fromBlock: "1000" }));
    await expect(recoverLaunch(key(), ACCOUNT, node as never)).resolves.toEqual({
      status: "check",
    });
  });
});

describe("the saved launches of an account", () => {
  it("are listed by key, each with its own chain", () => {
    save();
    saveLaunchAttempt(launchKeyOf(ACCOUNT, 10, config), {
      salt: salt(8),
      namespaces: [],
      before: [],
    });
    expect(savedLaunchKeys(ACCOUNT).sort()).toEqual(
      [key(), launchKeyOf(ACCOUNT, 10, config)].sort(),
    );
    expect(savedLaunchKeys("0x000000000000000000000000000000000000bEEF")).toEqual([]);
  });
});

describe("the launch notices", () => {
  it("says the revnet is already launched and links to it", () => {
    render(<LaunchedNotice chainId={11155111} revnetId={42n} />);
    expect(screen.getByText(/This revnet is already launched/)).toBeInTheDocument();
    expect(screen.getByRole("link")).toHaveAttribute("href", "/sep:42");
  });

  it("offers a launch that went through only a fresh look, never a discard", () => {
    const onCheckAgain = vi.fn();
    render(<LaunchConfirmingNotice onCheckAgain={onCheckAgain} />);
    expect(screen.queryByRole("button", { name: /I checked it/ })).toBeNull();
    screen.getByRole("button", { name: "Check again" }).click();
    expect(onCheckAgain).toHaveBeenCalledOnce();
  });

  it("never releases a journaled success on a check or an exit", async () => {
    save();
    await recover(open(clear({ result: "success", hash: SENT })), chain({ blockLogs: [] }));
    expect(releaseLaunch(key())).toBe(false);
    expect(savedLaunchAt(key())).toMatchObject({ settled: { result: "success", hash: SENT } });
    window.localStorage.clear();
    save();
    expect(releaseLaunch(key())).toBe(true);
    expect(savedLaunchAt(key())).toBeUndefined();
  });

  it("retires the saved attempt only on the user's check", () => {
    save();
    const onChecked = vi.fn(() => retireLaunch(key()));
    render(<LaunchCheckNotice onChecked={onChecked} />);
    expect(savedLaunchAt(key())).toMatchObject({ salt: salt(7) });
    screen.getByRole("button", { name: "I checked it. Launch again" }).click();
    expect(onChecked).toHaveBeenCalledOnce();
    expect(savedLaunchAt(key())).toBeUndefined();
  });
});

describe("a launch's frozen input", () => {
  it("keeps the intent and key of the form as submitted, whatever metadata refreshes later", () => {
    const form = { name: "Rev", customReserveAsset: { symbol: "USDC" } };
    const frozen = launchInputOf(form);
    const before = [launchIntent(frozen), launchKeyOf(ACCOUNT, 1, frozen)];
    form.customReserveAsset.symbol = "USDC.e";
    expect([launchIntent(frozen), launchKeyOf(ACCOUNT, 1, frozen)]).toEqual(before);
  });
});
