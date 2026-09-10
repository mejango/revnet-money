import { buildStep } from "@/lib/safe-batch";
import {
  mapTerminalToken,
  resolvePreset,
  SAFE_BATCH_PRESETS,
  stepResolverFor,
  type PresetReadClient,
} from "@/lib/safe-batch-presets";
import { NATIVE_TOKEN, USDC_ADDRESSES } from "@bananapus/nana-sdk-core";
import { getAddress, zeroAddress, type Address } from "viem";
import { describe, expect, it } from "vitest";

// wallet-action:safe-batch

const preset = SAFE_BATCH_PRESETS[0]!;
const OLD_HOOK = getAddress("0x77bee1ad2ac0ace98a9b5b58d75685c8b4d94948");
const OLD_TERMINAL = "0x5555555555555555555555555555555555555555" as Address;
const BASE_USDC = USDC_ADDRESSES[8453] as Address;

type Pools = Partial<Record<string, { twap: bigint; fee: number; tickSpacing: number }>>;

/** A fake chain: which targets have code, the project's current hook/terminal, and its pools per hook. */
function stubClient({
  deployed = [preset.targets.hook, preset.targets.terminal],
  hookOf = OLD_HOOK,
  terminalOf = OLD_TERMINAL,
  pools = {},
  carried = {},
}: {
  deployed?: Address[];
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
        case "hookOf":
          return hookOf;
        case "terminalOf":
          return terminalOf;
        case "twapWindowOf":
          if (lower(address) === lower(preset.targets.hook)) return carried[token] ?? 0n;
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
    const client = stubClient({ deployed: [preset.targets.hook] });
    await expect(resolvePreset(preset, { chainId: 8453, projectId: 6, client })).resolves.toEqual({
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
    await expect(resolvePreset(preset, { chainId: 8453, projectId: 6, client })).resolves.toEqual({
      status: "unavailable",
      message: "Could not read Base: origin not allowed",
    });
  });

  it("reports nothing to do when the hook and gateway are already current", async () => {
    const client = stubClient({ hookOf: preset.targets.hook, terminalOf: preset.targets.terminal });
    await expect(resolvePreset(preset, { chainId: 8453, projectId: 6, client })).resolves.toEqual({
      status: "nothing",
      message: "Nothing to do on Base: already on the current hook and gateway.",
    });
  });

  it("carries a native pool onto the new hook, defaulting the deployer's 48h window to 30 minutes", async () => {
    const client = stubClient({
      pools: { [zeroAddress]: { twap: 172_800n, fee: 10_000, tickSpacing: 200 } },
    });
    const result = await resolvePreset(preset, { chainId: 8453, projectId: 2, client });
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
      pools: { [BASE_USDC.toLowerCase()]: { twap: 900n, fee: 10_000, tickSpacing: 200 } },
    });
    const result = await resolvePreset(preset, { chainId: 8453, projectId: 6, client });
    if (result.status !== "ready") throw new Error(result.message);
    expect(result.steps[1]!.values).toEqual({
      fee: 10_000n,
      tickSpacing: 200n,
      twapWindow: 900n,
      terminalToken: BASE_USDC,
    });
    expect(result.notes).toEqual([]);
  });

  it("adds no setPoolFor when the project has no pool", async () => {
    const result = await resolvePreset(preset, {
      chainId: 10,
      projectId: 6,
      client: stubClient({}),
    });
    if (result.status !== "ready") throw new Error(result.message);
    expect(result.steps.map((step) => step.kind)).toEqual(["setHookFor", "setTerminalFor"]);
  });

  it("skips a pool the new hook already carries and a terminal already set", async () => {
    const client = stubClient({
      terminalOf: preset.targets.terminal,
      pools: { [zeroAddress]: { twap: 900n, fee: 3_000, tickSpacing: 60 } },
      carried: { [zeroAddress]: 900n },
    });
    const result = await resolvePreset(preset, { chainId: 8453, projectId: 2, client });
    if (result.status !== "ready") throw new Error(result.message);
    expect(result.steps.map((step) => step.kind)).toEqual(["setHookFor"]);
    expect(result.notes).toEqual(["Native pool is already registered on the new hook."]);
  });
});

describe("mirroring per-chain steps", () => {
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
