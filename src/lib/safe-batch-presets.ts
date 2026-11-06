import { chainDisplayName } from "@/app/constants";
import {
  migratedPoolKey,
  poolMove,
  poolSqrtPriceX96,
  poolTwapSqrtPriceX96,
  type V4PoolKey,
} from "@/lib/buyback-pool-migration";
import { rolloutAddress, rolloutTargets } from "@/lib/protocol-rollout";
import {
  buildStep,
  contractAddressOn,
  type BatchStep,
  type BatchStepValues,
  type StepResolver,
} from "@/lib/safe-batch";
import {
  jbBuybackHookAbi,
  jbBuybackHookRegistryAbi,
  jbRouterTerminalRegistryAbi,
  NATIVE_TOKEN,
  USDC_ADDRESSES,
} from "@bananapus/nana-sdk-core";
import { getAddress, isAddressEqual, zeroAddress, type Address, type PublicClient } from "viem";

export type SafeBatchPreset = {
  id: string;
  title: string;
  description: string;
  steps: readonly ("setHookFor" | "setPoolFor" | "setTerminalFor")[];
};

export const SAFE_BATCH_PRESETS: readonly SafeBatchPreset[] = [
  {
    id: "buyback-2-0-0-gateway",
    title: "Move to buyback 2.0.0 + gateway",
    description:
      "Points the project at the current buyback hook and router gateway, and opens its pool on the new hook at the old pool's price.",
    steps: ["setHookFor", "setPoolFor", "setTerminalFor"],
  },
];

/** `JBBuybackHook.MAX_TWAP_WINDOW`: the deployer default, which the hook stores as 30 minutes. */
export const MAX_TWAP_WINDOW = 172_800n;
/**
 * The window every migrated pool is registered with, whatever the old hook held.
 * Must match juicebox-money's preset: Safe co-signers on either client only meet on identical calldata.
 */
const PRESET_TWAP_WINDOW = 1_800n;

export type PresetResolution =
  | { status: "unavailable"; message: string }
  | { status: "nothing"; message: string }
  | { status: "ready"; steps: BatchStep[]; notes: string[] };

export type PresetReadClient = Pick<PublicClient, "getCode" | "readContract">;

type TokenProbe = { label: string; read: Address; write: Address };

/** Native reads as address(0) and writes as the 0xEEEe sentinel; USDC is its chain address. */
function tokenProbes(chainId: number): TokenProbe[] {
  const probes: TokenProbe[] = [{ label: "Native", read: zeroAddress, write: NATIVE_TOKEN }];
  const usdc = USDC_ADDRESSES[chainId as keyof typeof USDC_ADDRESSES];
  if (usdc) probes.push({ label: "USDC", read: getAddress(usdc), write: getAddress(usdc) });
  return probes;
}

async function hasCode(client: PresetReadClient, address: Address): Promise<boolean> {
  const code = await client.getCode({ address });
  return !!code && code !== "0x";
}

async function selectionAllowed(
  client: PresetReadClient,
  chainId: number,
  kind: "hook" | "terminal",
  target: Address,
): Promise<boolean> {
  if (kind === "hook") {
    const registry = contractAddressOn("JBBuybackHookRegistry", chainId);
    return (
      !!registry &&
      (await client.readContract({
        address: registry,
        abi: jbBuybackHookRegistryAbi,
        functionName: "isHookAllowed",
        args: [target],
      }))
    );
  }
  const registry = contractAddressOn("JBRouterTerminalRegistry", chainId);
  return (
    !!registry &&
    (await client.readContract({
      address: registry,
      abi: jbRouterTerminalRegistryAbi,
      functionName: "isTerminalAllowed",
      args: [target],
    }))
  );
}

async function twapWindowOn(
  client: PresetReadClient,
  hook: Address,
  projectId: bigint,
  token: Address,
): Promise<bigint> {
  return client.readContract({
    address: hook,
    abi: jbBuybackHookAbi,
    functionName: "twapWindowOf",
    args: [projectId, token],
  });
}

async function currentHookOf(
  client: PresetReadClient,
  chainId: number,
  projectId: bigint,
): Promise<Address | null> {
  const registry = contractAddressOn("JBBuybackHookRegistry", chainId);
  if (!registry) return null;
  const hook = await client.readContract({
    address: registry,
    abi: jbBuybackHookRegistryAbi,
    functionName: "hookOf",
    args: [projectId],
  });
  return hook && !isAddressEqual(hook, zeroAddress) ? getAddress(hook) : null;
}

type PoolStep =
  | { kind: "setPoolFor" | "initializePoolFor"; values: BatchStepValues; notes: string[] }
  | { kind: "skip"; notes: string[] };

/**
 * One terminal token's pool carried onto the target hook, from this chain's own state: registered
 * when its new pool exists, opened at the old pool's TWAP otherwise. Null when the old hook has
 * no pool for the token.
 */
async function poolStepOn(
  client: PresetReadClient,
  chainId: number,
  pid: bigint,
  currentHook: Address,
  targetHook: Address,
  poolHook: Address,
  probe: TokenProbe,
): Promise<PoolStep | null> {
  const oldWindow = await twapWindowOn(client, currentHook, pid, probe.read);
  if (oldWindow <= 0n) return null;
  const carried = await twapWindowOn(client, targetHook, pid, probe.read);
  if (carried > 0n) {
    return { kind: "skip", notes: [`${probe.label} pool is already registered on the new hook.`] };
  }
  const oldKey = (await client.readContract({
    address: currentHook,
    abi: jbBuybackHookAbi,
    functionName: "poolKeyOf",
    args: [pid, probe.read],
  })) as V4PoolKey;
  const newKey = migratedPoolKey(oldKey, poolHook);
  const [reference, newPrice] = await Promise.all([
    poolTwapSqrtPriceX96(client, chainId, oldKey, Number(PRESET_TWAP_WINDOW)),
    poolSqrtPriceX96(client, chainId, newKey),
  ]);
  const move = poolMove(reference.sqrtPriceX96, newPrice);
  if (move.kind === "none") {
    return {
      kind: "skip",
      notes: [`${probe.label} pool has no price to carry; set it up on the new hook directly.`],
    };
  }
  const notes: string[] = [];
  if (oldWindow === MAX_TWAP_WINDOW) {
    notes.push(
      `${probe.label} pool: the old window was the deployer default (48h); 30 minutes will be stored.`,
    );
  } else if (oldWindow !== PRESET_TWAP_WINDOW) {
    notes.push(`${probe.label} pool: the old window was ${oldWindow}s; 30 minutes will be stored.`);
  }
  if (move.kind === "initializePoolFor") {
    notes.push(
      reference.twap
        ? `${probe.label} pool: starts at the old pool's 30-minute average price with no TWAP history; LPs move their own liquidity.`
        : `${probe.label} pool: the old pool has no price history, so it starts at the old spot price; LPs move their own liquidity.`,
    );
  }
  return {
    kind: move.kind,
    notes,
    values: {
      fee: BigInt(newKey.fee),
      tickSpacing: BigInt(newKey.tickSpacing),
      twapWindow: PRESET_TWAP_WINDOW,
      terminalToken: probe.write,
      ...(move.kind === "initializePoolFor" ? { sqrtPriceX96: move.sqrtPriceX96 } : {}),
    },
  };
}

/**
 * Resolve the preset against one chain's live state: skip what is already
 * applied, carry each existing pool onto the target hook, and say plainly
 * when the targets are not deployed there or nothing is left to do.
 */
export async function resolvePreset(
  preset: SafeBatchPreset,
  { chainId, projectId, client }: { chainId: number; projectId: number; client: PresetReadClient },
): Promise<PresetResolution> {
  const chain = chainDisplayName(chainId);
  const targets = rolloutTargets(chainId);
  if (!targets) return { status: "unavailable", message: `Not deployed on ${chain} yet.` };
  // An RPC that cannot answer is not "no code": say which so nobody waits on a deployment.
  let deployed: boolean;
  try {
    const [hook, terminal] = await Promise.all([
      hasCode(client, targets.hook),
      hasCode(client, targets.terminal),
    ]);
    deployed = hook && terminal;
  } catch (cause) {
    return {
      status: "unavailable",
      message: `Could not read ${chain}: ${(cause as { shortMessage?: string; message?: string }).shortMessage ?? (cause as Error).message}`,
    };
  }
  if (!deployed) return { status: "unavailable", message: `Not deployed on ${chain} yet.` };

  const allowed = await Promise.all([
    selectionAllowed(client, chainId, "hook", targets.hook),
    selectionAllowed(client, chainId, "terminal", targets.terminal),
  ]);
  if (!allowed.every(Boolean))
    return {
      status: "unavailable",
      message: `The migration targets are not allowlisted on ${chain}.`,
    };

  const pid = BigInt(projectId);
  const steps: BatchStep[] = [];
  const notes: string[] = [];

  const currentHook = await currentHookOf(client, chainId, pid);
  const poolHook = rolloutAddress("JBUniswapV4Hook", chainId);
  const onTargetHook = !!currentHook && isAddressEqual(currentHook, targets.hook);
  if (preset.steps.includes("setHookFor") && !onTargetHook) {
    steps.push(
      buildStep({
        kind: "setHookFor",
        chainId,
        projectId,
        values: { hook: getAddress(targets.hook) },
      }),
    );
  }

  if (preset.steps.includes("setPoolFor") && currentHook && !onTargetHook) {
    if (!poolHook) {
      return { status: "unavailable", message: `The current V4 hook is not recorded on ${chain}.` };
    }
    for (const probe of tokenProbes(chainId)) {
      const pool = await poolStepOn(
        client,
        chainId,
        pid,
        currentHook,
        targets.hook,
        poolHook,
        probe,
      );
      if (!pool) continue;
      notes.push(...pool.notes);
      if (pool.kind !== "skip") {
        steps.push(buildStep({ kind: pool.kind, chainId, projectId, values: pool.values }));
      }
    }
  }

  if (preset.steps.includes("setTerminalFor")) {
    const routerRegistry = contractAddressOn("JBRouterTerminalRegistry", chainId);
    const terminal = routerRegistry
      ? await client.readContract({
          address: routerRegistry,
          abi: jbRouterTerminalRegistryAbi,
          functionName: "terminalOf",
          args: [pid],
        })
      : null;
    if (!terminal || !isAddressEqual(terminal, targets.terminal)) {
      steps.push(
        buildStep({
          kind: "setTerminalFor",
          chainId,
          projectId,
          values: { terminal: getAddress(targets.terminal) },
        }),
      );
    }
  }

  if (!steps.length) {
    return {
      status: "nothing",
      message: `Nothing to do on ${chain}: already on the current hook and gateway.`,
    };
  }
  return { status: "ready", steps, notes };
}

/** The same token class on another chain: native stays native, USDC becomes that chain's USDC. */
export function mapTerminalToken(
  token: Address,
  fromChainId: number,
  toChainId: number,
): Address | null {
  if (isAddressEqual(token, NATIVE_TOKEN) || isAddressEqual(token, zeroAddress)) return token;
  const from = USDC_ADDRESSES[fromChainId as keyof typeof USDC_ADDRESSES];
  const to = USDC_ADDRESSES[toChainId as keyof typeof USDC_ADDRESSES];
  if (from && to && isAddressEqual(token, from)) return getAddress(to);
  return null;
}

/**
 * How "Same on every chain" rebuilds a per-chain step: pool parameters come
 * from the target chain's live pool and the hook target from its registry. A
 * pool step after a mirrored move to the current hook is resolved from the
 * target chain's own pools, so its kind and price can differ from the source.
 */
export function stepResolverFor(clientFor: (chainId: number) => PresetReadClient): StepResolver {
  return async (step, chainId, projectId, prior = []) => {
    const client = clientFor(chainId);
    const pid = BigInt(projectId);
    if (step.kind === "setHookFor" || step.kind === "setTerminalFor") {
      const source = rolloutTargets(step.chainId);
      const target = rolloutTargets(chainId);
      if (!source || !target) return null;
      const key = step.kind === "setHookFor" ? "hook" : "terminal";
      const selected = step.values[key];
      // Custom selections require an explicit edit on each target network.
      if (typeof selected !== "string" || !isAddressEqual(selected, source[key])) return null;
      if (!(await hasCode(client, target[key]))) return null;
      if (!(await selectionAllowed(client, chainId, key, target[key]))) return null;
      return { values: { ...step.values, [key]: target[key] } };
    }
    const token = mapTerminalToken(step.values.terminalToken as Address, step.chainId, chainId);
    if (!token) return null;
    const hook = await currentHookOf(client, chainId, pid);
    if (!hook) return null;
    const read = isAddressEqual(token, NATIVE_TOKEN) ? zeroAddress : token;
    const targets = rolloutTargets(chainId);
    const poolHook = rolloutAddress("JBUniswapV4Hook", chainId);
    const migrating =
      (step.kind === "setPoolFor" || step.kind === "initializePoolFor") &&
      !!targets &&
      !isAddressEqual(hook, targets.hook) &&
      prior.some(
        (earlier) =>
          earlier.kind === "setHookFor" &&
          typeof earlier.values.hook === "string" &&
          isAddressEqual(earlier.values.hook, targets.hook),
      );
    if (migrating) {
      if (!poolHook) return null;
      const label = isAddressEqual(token, NATIVE_TOKEN) ? "Native" : "USDC";
      const pool = await poolStepOn(client, chainId, pid, hook, targets!.hook, poolHook, {
        label,
        read,
        write: token,
      });
      return pool && pool.kind !== "skip" ? { kind: pool.kind, values: pool.values } : null;
    }
    if (step.kind === "initializePoolFor") return null;
    const window = await twapWindowOn(client, hook, pid, read);
    if (window <= 0n) return null;
    if (step.kind === "setTwapWindowOf") {
      return { to: hook, values: { ...step.values, terminalToken: token } };
    }
    if (step.kind === "setPoolFor") {
      const key = await client.readContract({
        address: hook,
        abi: jbBuybackHookAbi,
        functionName: "poolKeyOf",
        args: [pid, read],
      });
      return {
        values: {
          ...step.values,
          fee: BigInt(key.fee),
          tickSpacing: BigInt(key.tickSpacing),
          terminalToken: token,
        },
      };
    }
    return null;
  };
}
