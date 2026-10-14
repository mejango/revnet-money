import { LaunchCheckNotice, LaunchedNotice } from "@/app/create/form/LaunchedNotice";
import {
  checkSavedLaunch,
  checkSavedLaunches,
  launchConfigHash,
  launchConfigOf,
  launchHoldsOf,
  launchInputOf,
  launchSalt,
  noteLaunchSent,
  recoverSavedLaunch,
  savedLaunchOf,
  settleLaunchSalt,
} from "@/app/create/helpers/launchIntent";
import { launchIntent as sdkLaunchIntent } from "@bananapus/nana-sdk-core/review";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/** The launch's SDK intent, from the form as the page builds it. */
const launchIntent = (form: unknown) =>
  sdkLaunchIntent({ chainId: 1, account: ACCOUNT, config: launchConfigOf(form) });

const ACCOUNT = "0x000000000000000000000000000000000000dEaD";
const salt = (n: number) => `0x${n.toString(16).padStart(64, "0")}` as const;

beforeEach(() => window.localStorage.clear());

describe("a launch's intent and salt", () => {
  it("is the user's config alone, whatever order its fields are in", () => {
    expect(launchIntent({ name: "Rev", stages: [{ price: "1" }] })).toEqual(
      launchIntent({ stages: [{ price: "1" }], name: "Rev" }),
    );
    expect(launchIntent({ name: "Rev" })).not.toEqual(launchIntent({ name: "Rev2" }));
  });

  it("keeps the salt of an unsettled launch across retries and reloads", () => {
    const first = launchSalt(ACCOUNT, 1, { name: "Rev" }, () => salt(1));
    expect(launchSalt(ACCOUNT, 1, { name: "Rev" }, () => salt(2))).toBe(first);
    expect(launchSalt(ACCOUNT, 10, { name: "Rev" }, () => salt(2))).toBe(salt(2));
    settleLaunchSalt(ACCOUNT, 1, { name: "Rev" });
    expect(launchSalt(ACCOUNT, 1, { name: "Rev" }, () => salt(3))).toBe(salt(3));
  });
});

describe("a saved launch on reload", () => {
  const config = { name: "Rev" };
  /** A chain whose REVDeployer logs from the saved block hold `logs`. */
  const chainWith = (logs: unknown[] | Error) => ({
    getBlockNumber: vi.fn(async () => 1_200n),
    getLogs: vi.fn(async () => {
      if (logs instanceof Error) throw logs;
      return logs;
    }),
  });
  const deployed = (deploySalt: string, caller = ACCOUNT, revnetId = 42n) => ({
    removed: false,
    args: { revnetId, configuration: { description: { salt: deploySalt } }, caller },
  });
  const save = () => {
    launchSalt(ACCOUNT, 1, config, () => salt(7));
    noteLaunchSent(ACCOUNT, 1, config, 1_000n);
  };

  it("finds a launch its salt already made, and clears the salt so nothing is sent again", async () => {
    save();
    const chain = chainWith([
      deployed(salt(7), "0x000000000000000000000000000000000000bEEF"),
      deployed(salt(7)),
    ]);
    await expect(checkSavedLaunch(chain as never, 1, ACCOUNT, config)).resolves.toEqual({
      launched: 42n,
    });
    expect(savedLaunchOf(ACCOUNT, 1, config)).toBeUndefined();
  });

  it("keeps the salt for a retry when no launch of it is found, since a scan that finds none proves nothing", async () => {
    save();
    await expect(
      checkSavedLaunch(chainWith([deployed(salt(8))]) as never, 1, ACCOUNT, config),
    ).resolves.toEqual({ launched: "unknown" });
    expect(launchSalt(ACCOUNT, 1, config, () => salt(9))).toBe(salt(7));
  });

  it("keeps the salt and blocks nothing when the chain can't be read", async () => {
    save();
    await expect(
      checkSavedLaunch(chainWith(new Error("RPC down")) as never, 1, ACCOUNT, config),
    ).resolves.toEqual({ launched: "unknown" });
    expect(savedLaunchOf(ACCOUNT, 1, config)).toMatchObject({ salt: salt(7) });
  });
});

describe("the saved-launch scan's range", () => {
  it("reads at most 500 blocks per request, stops at the first match and caps the range", async () => {
    launchSalt(ACCOUNT, 1, { name: "Rev" }, () => salt(7));
    noteLaunchSent(ACCOUNT, 1, { name: "Rev" }, 0n);
    const ranges: [bigint, bigint][] = [];
    const chain = {
      getBlockNumber: vi.fn(async () => 1_000_000n),
      getLogs: vi.fn(async ({ fromBlock, toBlock }: { fromBlock: bigint; toBlock: bigint }) => {
        ranges.push([fromBlock, toBlock]);
        return [];
      }),
    };
    await expect(checkSavedLaunch(chain as never, 1, ACCOUNT, { name: "Rev" })).resolves.toEqual({
      launched: "unknown",
    });
    expect(ranges.every(([from, to]) => to - from + 1n <= 500n)).toBe(true);
    expect(ranges.reduce((sum, [from, to]) => sum + (to - from + 1n), 0n)).toBeLessThanOrEqual(
      50_000n,
    );
  });
});

describe("a reload's saved launches", () => {
  it("finds the account's launched revnet among its saved launches, on its own chain", async () => {
    launchSalt(ACCOUNT, 11155111, { name: "Rev" }, () => salt(7));
    noteLaunchSent(ACCOUNT, 11155111, { name: "Rev" }, 1_000n);
    const chain = {
      getBlockNumber: vi.fn(async () => 1_100n),
      getLogs: vi.fn(async () => [
        {
          removed: false,
          args: {
            revnetId: 42n,
            configuration: { description: { salt: salt(7) } },
            caller: ACCOUNT,
          },
        },
      ]),
    };
    const clientFor = vi.fn(() => chain as never);
    await expect(checkSavedLaunches(clientFor, ACCOUNT)).resolves.toEqual({
      chainId: 11155111,
      revnetId: 42n,
    });
    expect(clientFor).toHaveBeenCalledWith(11155111);
    expect(savedLaunchOf(ACCOUNT, 11155111, { name: "Rev" })).toBeUndefined();
  });
});

describe("the launched notice", () => {
  it("says the revnet is already launched and links to it", () => {
    render(<LaunchedNotice chainId={11155111} revnetId={42n} />);
    expect(screen.getByText(/This revnet is already launched/)).toBeInTheDocument();
    expect(screen.getByRole("link")).toHaveAttribute("href", "/sep:42");
  });
});

describe("a launch's frozen input", () => {
  it("keeps the intent and salt of the form as submitted, whatever metadata refreshes later", () => {
    const form = { name: "Rev", customReserveAsset: { symbol: "USDC" } };
    const frozen = launchInputOf(form);
    const before = launchIntent(frozen);
    launchSalt(ACCOUNT, 1, frozen, () => salt(7));
    form.customReserveAsset.symbol = "USDC.e";
    expect(launchIntent(frozen)).toEqual(before);
    expect(savedLaunchOf(ACCOUNT, 1, frozen)).toMatchObject({ salt: salt(7) });
  });
});

// The one recovery rule (held, settled, no record, check required): a saved launch is never sent
// again while it can still have launched, and only the user's explicit check retires it.
describe("recovering a saved launch before anything is sent", () => {
  const config = { name: "Rev" };
  const SENT = `0x${"12".repeat(32)}` as const;
  const BLOCK = `0x${"bb".repeat(32)}` as const;
  const clear = (settled?: { result: "success" | "failed"; hash: `0x${string}` }) => ({
    peek: () => ({ status: "clear" as const, ...(settled ? { settled } : {}) }),
    state: async () => ({ status: "clear" as const, ...(settled ? { settled } : {}) }),
  });
  const held = {
    peek: () => ({ status: "pending-known-hash" as const }),
    state: async () => ({ status: "pending-known-hash" as const }),
  };
  /** A hold whose saved hash the chain shows went through once asked: the reload's case. */
  const settlesWhenAsked = {
    peek: () => ({ status: "pending-known-hash" as const }),
    state: async () => ({ status: "clear" as const, settled: { result: "success", hash: SENT } }),
  };
  const save = () => {
    launchSalt(ACCOUNT, 1, config, () => salt(7));
    noteLaunchSent(ACCOUNT, 1, config, 1_000n);
  };
  /** A chain whose receipt of the settled hash and DeployRevnet logs are given; the scan fails. */
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
  const deployedBy = (deploySalt: string, transactionHash: string = SENT) => ({
    removed: false,
    transactionHash,
    args: { revnetId: 42n, configuration: { description: { salt: deploySalt } }, caller: ACCOUNT },
  });

  it("consumes a settlement the hold saved while the page was closed: the revnet, never a second send", async () => {
    save();
    const recovered = await recoverSavedLaunch(
      [clear({ result: "success", hash: SENT })],
      chain({ blockLogs: [deployedBy(salt(7))] }) as never,
      1,
      ACCOUNT,
      config,
    );
    expect(recovered).toEqual({ status: "launched", revnetId: 42n });
    expect(savedLaunchOf(ACCOUNT, 1, config)).toBeUndefined();
  });

  it("asks the chain about a held attempt whose hash the hold saved before the page could: one that went through is the revnet", async () => {
    save();
    await expect(
      recoverSavedLaunch(
        [settlesWhenAsked] as never,
        chain({ blockLogs: [deployedBy(salt(7))] }) as never,
        1,
        ACCOUNT,
        config,
      ),
    ).resolves.toEqual({ status: "launched", revnetId: 42n });
  });

  it("requires a check when the settled transaction can't be read, and keeps the saved attempt", async () => {
    save();
    await expect(
      recoverSavedLaunch(
        [clear({ result: "success", hash: SENT })],
        chain({ receipt: new Error("RPC down") }) as never,
        1,
        ACCOUNT,
        config,
      ),
    ).resolves.toEqual({ status: "check" });
    expect(savedLaunchOf(ACCOUNT, 1, config)).toMatchObject({ salt: salt(7) });
  });

  it("requires a check, never a send, when the hold has no record and the event scan fails", async () => {
    save();
    await expect(
      recoverSavedLaunch([clear()], chain() as never, 1, ACCOUNT, config),
    ).resolves.toEqual({ status: "check" });
  });

  it("requires a check when the scan finds nothing, since an empty scan proves nothing", async () => {
    save();
    await expect(
      recoverSavedLaunch([clear()], chain({ scan: [] }) as never, 1, ACCOUNT, config),
    ).resolves.toEqual({ status: "check" });
  });

  it("finds a launch with no hold record by its exact salt", async () => {
    save();
    await expect(
      recoverSavedLaunch(
        [clear()],
        chain({ scan: [deployedBy(salt(7))] }) as never,
        1,
        ACCOUNT,
        config,
      ),
    ).resolves.toEqual({ status: "launched", revnetId: 42n });
  });

  it("leaves a held launch to its hold: nothing counted, nothing read", async () => {
    save();
    const client = chain();
    await expect(
      recoverSavedLaunch([clear(), held] as never, client as never, 1, ACCOUNT, config),
    ).resolves.toEqual({ status: "held" });
    expect(client.getLogs).not.toHaveBeenCalled();
  });

  it("sends a launch whose earlier attempt the hold proved reverted", async () => {
    save();
    await expect(
      recoverSavedLaunch(
        [clear({ result: "failed", hash: SENT })],
        chain() as never,
        1,
        ACCOUNT,
        config,
      ),
    ).resolves.toEqual({ status: "clear" });
  });

  it("does not count an earlier, already consumed launch's settlement as this attempt's", async () => {
    // A salt saved before a send that never happened (its pin failed): no block noted.
    launchSalt(ACCOUNT, 1, config, () => salt(7));
    await expect(
      recoverSavedLaunch(
        [clear({ result: "success", hash: SENT })],
        chain({ blockLogs: [deployedBy(salt(3))] }) as never,
        1,
        ACCOUNT,
        config,
      ),
    ).resolves.toEqual({ status: "clear" });
  });

  it("after a failed send, consumes a settlement that landed during the exit", async () => {
    save();
    const other = `0x${"34".repeat(32)}` as const;
    await expect(
      recoverSavedLaunch(
        [clear({ result: "success", hash: SENT })],
        chain({ blockLogs: [deployedBy(salt(7))] }) as never,
        1,
        ACCOUNT,
        config,
        { scan: false, ignore: other },
      ),
    ).resolves.toEqual({ status: "launched", revnetId: 42n });
  });

  it("after a failed send with nothing held, says nothing launched without scanning", async () => {
    save();
    const client = chain();
    await expect(
      recoverSavedLaunch([clear()], client as never, 1, ACCOUNT, config, { scan: false }),
    ).resolves.toEqual({ status: "clear" });
    expect(client.getLogs).not.toHaveBeenCalled();
  });

  it("is held by an attempt the main-era build left under its launch namespace", async () => {
    save();
    const { writeHolds } = await import("@/lib/write-hold");
    const { legacyIntents } = await import("@/lib/legacy-intents");
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
      request: async () => null,
    };
    const DEPLOYER = "0x0000000000000000000000000000000000001000";
    // The wallet returned a hash, then the page closed before anything else was saved.
    await writeHolds
      .open({
        chainId: 1,
        account: ACCOUNT,
        safe: false,
        namespace: legacyIntents.launch(launchConfigHash(config))[0]!,
        call: { to: DEPLOYER, data: "0x1234", value: 0n },
      })
      .send(node as never, async (gate) => {
        await gate.beforeSend();
        gate.afterSubmit(SENT);
      });
    await expect(
      recoverSavedLaunch(launchHoldsOf(1, ACCOUNT, config), chain() as never, 1, ACCOUNT, config),
    ).resolves.toEqual({ status: "held" });
  });

  it("retires the saved attempt only on the user's check, and the next launch has a fresh salt", async () => {
    save();
    const onChecked = vi.fn(() => settleLaunchSalt(ACCOUNT, 1, config));
    render(<LaunchCheckNotice onChecked={onChecked} />);
    expect(savedLaunchOf(ACCOUNT, 1, config)).toMatchObject({ salt: salt(7) });
    screen.getByRole("button", { name: "I checked it. Launch again" }).click();
    expect(onChecked).toHaveBeenCalledOnce();
    expect(launchSalt(ACCOUNT, 1, config, () => salt(9))).toBe(salt(9));
  });
});
