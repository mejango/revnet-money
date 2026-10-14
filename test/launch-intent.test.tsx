import { LaunchedNotice } from "@/app/create/form/LaunchedNotice";
import {
  checkSavedLaunch,
  checkSavedLaunches,
  launchIntent,
  launchSalt,
  noteLaunchSent,
  savedLaunchOf,
  settleLaunchSalt,
} from "@/app/create/helpers/launchIntent";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

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
