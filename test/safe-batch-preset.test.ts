import { rolloutTargets } from "@/lib/protocol-rollout";
import { buildStep, mirrorBatch } from "@/lib/safe-batch";
import {
  mapTerminalToken,
  resolvePreset,
  SAFE_BATCH_PRESETS,
  stepResolverFor,
  type PresetReadClient,
} from "@/lib/safe-batch-presets";
import { NATIVE_TOKEN, USDC_ADDRESSES } from "@bananapus/nana-sdk-core";
import { getAddress, zeroAddress, type Address } from "viem";
import { describe, expect, it, vi } from "vitest";

// wallet-action:safe-batch
// The previous hook remains here deliberately: these tests exercise migration from a retired generation.

// Model a staged rollout explicitly so future mainnet data regeneration needs no test rewrite.
vi.mock("@/lib/protocol-rollout", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/protocol-rollout")>();
  return {
    ...actual,
    rolloutTargets: (chainId: number) =>
      [84532, 11155111, 421614].includes(chainId) ? actual.rolloutTargets(chainId) : null,
  };
});

const preset = SAFE_BATCH_PRESETS[0]!;
const targets = rolloutTargets(84532)!;
const OLD_HOOK = getAddress("0x77bee1ad2ac0ace98a9b5b58d75685c8b4d94948");
const OLD_TERMINAL = "0x5555555555555555555555555555555555555555" as Address;
const BASE_USDC = USDC_ADDRESSES[8453] as Address;

type Pools = Partial<Record<string, { twap: bigint; fee: number; tickSpacing: number }>>;

/** A fake chain: which targets have code, the project's current hook/terminal, and its pools per hook. */
function stubClient({
  deployed = [targets.hook, targets.terminal],
  hookOf = OLD_HOOK,
  terminalOf = OLD_TERMINAL,
  pools = {},
  carried = {},
  allowed = true,
}: {
  deployed?: Address[];
  allowed?: boolean;
  hookOf?: Address;
  terminalOf?: Address;
  /** Pools on the current hook, keyed by the read token (address(0) for native). */
  pools?: Pools;
  /** TWAP windows already registered on the target hook. */
  carried?: Partial<Record<string, bigint>>;
}): PresetReadClient {
  const lower = (value: unknown) => String(value).toLowerCase();
  return {
    getCode: async ({ address }: { address: Address }) =>
      deployed.some((item) => lower(item) === lower(address)) ? "0x6001" : "0x",
    readContract: async ({
      address,
      functionName,
      args,
    }: {
      address: Address;
      functionName: string;
      args?: readonly unknown[];
    }) => {
      const token = lower(args?.[1]);
      switch (functionName) {
        case "isHookAllowed":
        case "isTerminalAllowed":
          return allowed;
        case "hookOf":
          return hookOf;
        case "terminalOf":
          return terminalOf;
        case "twapWindowOf":
          if (lower(address) === lower(targets.hook)) return carried[token] ?? 0n;
          return pools[token]?.twap ?? 0n;
        case "poolKeyOf": {
          const pool = pools[token];
          return {
            currency0: zeroAddress,
            currency1: zeroAddress,
            fee: pool?.fee ?? 0,
            tickSpacing: pool?.tickSpacing ?? 0,
            hooks: address,
          };
        }
        default:
          throw new Error(`unexpected read ${functionName}`);
      }
    },
  } as unknown as PresetReadClient;
}

describe("Move to buyback 1.4.0 + gateway", () => {
  it("is unavailable where either target has no code", async () => {
    const client = stubClient({ deployed: [targets.hook] });
    await expect(resolvePreset(preset, { chainId: 84532, projectId: 6, client })).resolves.toEqual({
      status: "unavailable",
      message: "Not deployed on Base Sepolia yet.",
    });
  });

  it("keeps pending mainnets unavailable until canonical deployment records land", async () => {
    await expect(
      resolvePreset(preset, { chainId: 8453, projectId: 6, client: stubClient({}) }),
    ).resolves.toEqual({
      status: "unavailable",
      message: "Not deployed on Base yet.",
    });
  });

  it("tells an unreadable chain apart from an undeployed one", async () => {
    const client = {
      ...stubClient({}),
      getCode: async () => {
        throw new Error("origin not allowed");
      },
    } as unknown as PresetReadClient;
    await expect(resolvePreset(preset, { chainId: 84532, projectId: 6, client })).resolves.toEqual({
      status: "unavailable",
      message: "Could not read Base Sepolia: origin not allowed",
    });
  });

  it.each([
    "hookOf",
    "old window",
    "target window",
    "terminalOf",
    "isHookAllowed",
    "isTerminalAllowed",
  ])("refuses migration when the required %s read fails", async (failure) => {
    const base = stubClient({
      pools: { [zeroAddress]: { twap: 900n, fee: 3000, tickSpacing: 60 } },
    });
    const client = {
      ...base,
      readContract: async (request: { address: Address; functionName: string }) => {
        const targetHook = request.address.toLowerCase() === targets.hook.toLowerCase();
        if (
          request.functionName === failure ||
          (request.functionName === "twapWindowOf" &&
            (failure === "target window" ? targetHook : failure === "old window" && !targetHook))
        ) {
          throw new Error("RPC unavailable");
        }
        return (base.readContract as (request: unknown) => Promise<unknown>)(request);
      },
    } as unknown as PresetReadClient;
    await expect(resolvePreset(preset, { chainId: 84532, projectId: 2, client })).rejects.toThrow(
      "RPC unavailable",
    );
  });

  it("does not prepare or mirror targets that the live registries disallow", async () => {
    const unavailable = await resolvePreset(preset, {
      chainId: 84532,
      projectId: 2,
      client: stubClient({ allowed: false }),
    });
    expect(unavailable.status).toBe("unavailable");
    const migration = await resolvePreset(preset, {
      chainId: 84532,
      projectId: 2,
      client: stubClient({ pools: { [zeroAddress]: { twap: 900n, fee: 3000, tickSpacing: 60 } } }),
    });
    if (migration.status !== "ready") throw new Error(migration.message);
    const mirrored = await mirrorBatch(
      migration.steps,
      84532,
      { chainId: 11155111, projectId: 2 },
      stepResolverFor(() => stubClient({ allowed: false })),
    );
    expect(mirrored.steps).toEqual([]);
    expect(mirrored.skipped).toHaveLength(3);
  });

  it("reports nothing to do when the hook and gateway are already current", async () => {
    const client = stubClient({ hookOf: targets.hook, terminalOf: targets.terminal });
    await expect(resolvePreset(preset, { chainId: 84532, projectId: 6, client })).resolves.toEqual({
      status: "nothing",
      message: "Nothing to do on Base Sepolia: already on the current hook and gateway.",
    });
  });

  it("carries a native pool onto the new hook, defaulting the deployer's 48h window to 30 minutes", async () => {
    const client = stubClient({
      pools: { [zeroAddress]: { twap: 172_800n, fee: 10_000, tickSpacing: 200 } },
    });
    const result = await resolvePreset(preset, { chainId: 84532, projectId: 2, client });
    if (result.status !== "ready") throw new Error(result.message);
    expect(result.steps.map((step) => step.kind)).toEqual([
      "setHookFor",
      "setPoolFor",
      "setTerminalFor",
    ]);
    expect(result.steps[1]!.values).toEqual({
      fee: 10_000n,
      tickSpacing: 200n,
      twapWindow: 1_800n,
      terminalToken: NATIVE_TOKEN,
    });
    expect(result.steps.map((step) => step.data)).toEqual([
      "0x779b02900000000000000000000000000000000000000000000000000000000000000002000000000000000000000000b222da5a71e8fb89a5a38b7c920eab5dfbc74b91",
      "0x345c42130000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000271000000000000000000000000000000000000000000000000000000000000000c80000000000000000000000000000000000000000000000000000000000000708000000000000000000000000000000000000000000000000000000000000eeee",
      "0xf3e37d0100000000000000000000000000000000000000000000000000000000000000020000000000000000000000004a56aef5b6a5b9742abb02ca67c5a85ba183d901",
    ]);
    expect(result.notes).toEqual([
      "Native pool: the old window was the deployer default (48h); 30 minutes will be stored.",
    ]);
  });

  it("keeps a deliberate window and writes USDC pools with the chain's USDC address", async () => {
    const client = stubClient({
      pools: {
        [USDC_ADDRESSES[84532].toLowerCase()]: { twap: 900n, fee: 10_000, tickSpacing: 200 },
      },
    });
    const result = await resolvePreset(preset, { chainId: 84532, projectId: 6, client });
    if (result.status !== "ready") throw new Error(result.message);
    expect(result.steps[1]!.values).toEqual({
      fee: 10_000n,
      tickSpacing: 200n,
      twapWindow: 900n,
      terminalToken: USDC_ADDRESSES[84532],
    });
    expect(result.notes).toEqual([]);
  });

  it("adds no setPoolFor when the project has no pool", async () => {
    const result = await resolvePreset(preset, {
      chainId: 11155111,
      projectId: 6,
      client: stubClient({}),
    });
    if (result.status !== "ready") throw new Error(result.message);
    expect(result.steps.map((step) => step.kind)).toEqual(["setHookFor", "setTerminalFor"]);
  });

  it("skips a pool the new hook already carries and a terminal already set", async () => {
    const client = stubClient({
      terminalOf: targets.terminal,
      pools: { [zeroAddress]: { twap: 900n, fee: 3_000, tickSpacing: 60 } },
      carried: { [zeroAddress]: 900n },
    });
    const result = await resolvePreset(preset, { chainId: 84532, projectId: 2, client });
    if (result.status !== "ready") throw new Error(result.message);
    expect(result.steps.map((step) => step.kind)).toEqual(["setHookFor"]);
    expect(result.notes).toEqual(["Native pool is already registered on the new hook."]);
  });
});

describe("mirroring per-chain steps", () => {
  it("cannot mirror migration selections or their dependent pool onto pending mainnets or OP Sepolia", async () => {
    const migration = await resolvePreset(preset, {
      chainId: 84532,
      projectId: 2,
      client: stubClient({ pools: { [zeroAddress]: { twap: 900n, fee: 3000, tickSpacing: 60 } } }),
    });
    if (migration.status !== "ready") throw new Error(migration.message);
    const resolver = stepResolverFor(() =>
      stubClient({ pools: { [zeroAddress]: { twap: 900n, fee: 3000, tickSpacing: 60 } } }),
    );
    for (const chainId of [1, 10, 8453, 42161, 11155420]) {
      const result = await mirrorBatch(migration.steps, 84532, { chainId, projectId: 2 }, resolver);
      expect(result.steps).toEqual([]);
      expect(result.skipped).toHaveLength(3);
    }
    const reordered = await mirrorBatch(
      [migration.steps[1]!, migration.steps[0]!, migration.steps[2]!],
      84532,
      { chainId: 8453, projectId: 2 },
      resolver,
    );
    expect(reordered.steps).toEqual([]);
    expect(reordered.skipped).toHaveLength(1);
    const available = await mirrorBatch(
      migration.steps,
      84532,
      { chainId: 11155111, projectId: 2 },
      resolver,
    );
    expect(available.steps.map((step) => step.kind)).toEqual([
      "setHookFor",
      "setPoolFor",
      "setTerminalFor",
    ]);
    expect(available.skipped).toEqual([]);
  });

  it("maps USDC to the target chain's USDC and leaves native alone", () => {
    expect(mapTerminalToken(BASE_USDC, 8453, 10)).toBe(USDC_ADDRESSES[10]);
    expect(mapTerminalToken(NATIVE_TOKEN, 8453, 10)).toBe(NATIVE_TOKEN);
    expect(mapTerminalToken(OLD_TERMINAL, 8453, 10)).toBeNull();
  });

  it("re-reads the pool key on the target chain and keeps the chosen window", async () => {
    const resolve = stepResolverFor(() =>
      stubClient({ pools: { [zeroAddress]: { twap: 600n, fee: 3_000, tickSpacing: 60 } } }),
    );
    const step = buildStep({
      kind: "setPoolFor",
      chainId: 8453,
      projectId: 2,
      values: { fee: 10_000n, tickSpacing: 200n, twapWindow: 1_800n, terminalToken: NATIVE_TOKEN },
    });
    await expect(resolve(step, 10, 7)).resolves.toEqual({
      values: { fee: 3_000n, tickSpacing: 60n, twapWindow: 1_800n, terminalToken: NATIVE_TOKEN },
    });
    const twap = buildStep({
      kind: "setTwapWindowOf",
      chainId: 8453,
      projectId: 2,
      values: { terminalToken: NATIVE_TOKEN, twapWindow: 900n },
      to: OLD_HOOK,
    });
    await expect(resolve(twap, 10, 7)).resolves.toEqual({
      to: OLD_HOOK,
      values: { terminalToken: NATIVE_TOKEN, twapWindow: 900n },
    });
  });

  it("refuses where the target chain has no such pool, and never mirrors a pool initialization", async () => {
    const resolve = stepResolverFor(() => stubClient({}));
    const step = buildStep({
      kind: "setPoolFor",
      chainId: 8453,
      projectId: 2,
      values: { fee: 10_000n, tickSpacing: 200n, twapWindow: 1_800n, terminalToken: NATIVE_TOKEN },
    });
    await expect(resolve(step, 10, 7)).resolves.toBeNull();
    const init = buildStep({
      kind: "initializePoolFor",
      chainId: 8453,
      projectId: 2,
      values: {
        fee: 10_000n,
        tickSpacing: 200n,
        twapWindow: 1_800n,
        terminalToken: NATIVE_TOKEN,
        sqrtPriceX96: 1n,
      },
    });
    await expect(resolve(init, 10, 7)).resolves.toBeNull();
  });
});
