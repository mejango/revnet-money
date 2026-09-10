import { chainDisplayName } from "@/app/constants";
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
  /** The same addresses on every chain (CREATE2). */
  targets: { hook: Address; terminal: Address };
  steps: readonly ("setHookFor" | "setPoolFor" | "setTerminalFor")[];
};

export const SAFE_BATCH_PRESETS: readonly SafeBatchPreset[] = [
  {
    id: "buyback-1-4-0-gateway",
    title: "Move to buyback 1.4.0 + gateway",
    description:
      "Points the project at the current buyback hook and router gateway, carrying its live pool onto the new hook.",
    targets: {
      hook: "0xB222Da5A71e8FB89a5A38b7c920EaB5DfbC74B91",
      terminal: "0x4a56AEf5b6A5b9742AbB02cA67C5a85ba183D901",
    },
    steps: ["setHookFor", "setPoolFor", "setTerminalFor"],
  },
];

/** `JBBuybackHook.MAX_TWAP_WINDOW`: the deployer default, which the hook stores as 30 minutes. */
export const MAX_TWAP_WINDOW = 172_800n;
const DEFAULT_TWAP_WINDOW = 1_800n;

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

async function twapWindowOn(
  client: PresetReadClient,
  hook: Address,
  projectId: bigint,
  token: Address,
): Promise<bigint> {
  return client
    .readContract({
      address: hook,
      abi: jbBuybackHookAbi,
      functionName: "twapWindowOf",
      args: [projectId, token],
    })
    .catch(() => 0n);
}

async function currentHookOf(
  client: PresetReadClient,
  chainId: number,
  projectId: bigint,
): Promise<Address | null> {
  const registry = contractAddressOn("JBBuybackHookRegistry", chainId);
  if (!registry) return null;
  const hook = await client
    .readContract({
      address: registry,
      abi: jbBuybackHookRegistryAbi,
      functionName: "hookOf",
      args: [projectId],
    })
    .catch(() => null);
  return hook && !isAddressEqual(hook, zeroAddress) ? getAddress(hook) : null;
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
  // An RPC that cannot answer is not "no code": say which so nobody waits on a deployment.
  let deployed: boolean;
  try {
    const [hook, terminal] = await Promise.all([
      hasCode(client, preset.targets.hook),
      hasCode(client, preset.targets.terminal),
    ]);
    deployed = hook && terminal;
  } catch (cause) {
    return {
      status: "unavailable",
      message: `Could not read ${chain}: ${(cause as { shortMessage?: string; message?: string }).shortMessage ?? (cause as Error).message}`,
    };
  }
  if (!deployed) return { status: "unavailable", message: `Not deployed on ${chain} yet.` };

  const pid = BigInt(projectId);
  const steps: BatchStep[] = [];
  const notes: string[] = [];

  const currentHook = await currentHookOf(client, chainId, pid);
  const onTargetHook = !!currentHook && isAddressEqual(currentHook, preset.targets.hook);
  if (preset.steps.includes("setHookFor") && !onTargetHook) {
    steps.push(
      buildStep({
        kind: "setHookFor",
        chainId,
        projectId,
        values: { hook: getAddress(preset.targets.hook) },
      }),
    );
  }

  if (preset.steps.includes("setPoolFor") && currentHook && !onTargetHook) {
    for (const probe of tokenProbes(chainId)) {
      const oldWindow = await twapWindowOn(client, currentHook, pid, probe.read);
      if (oldWindow <= 0n) continue;
      const carried = await twapWindowOn(client, preset.targets.hook, pid, probe.read);
      if (carried > 0n) {
        notes.push(`${probe.label} pool is already registered on the new hook.`);
        continue;
      }
      const key = await client.readContract({
        address: currentHook,
        abi: jbBuybackHookAbi,
        functionName: "poolKeyOf",
        args: [pid, probe.read],
      });
      const values: BatchStepValues = {
        fee: BigInt(key.fee),
        tickSpacing: BigInt(key.tickSpacing),
        twapWindow: oldWindow === MAX_TWAP_WINDOW ? DEFAULT_TWAP_WINDOW : oldWindow,
        terminalToken: probe.write,
      };
      if (oldWindow === MAX_TWAP_WINDOW) {
        notes.push(
          `${probe.label} pool: the old window was the deployer default (48h); 30 minutes will be stored.`,
        );
      }
      steps.push(buildStep({ kind: "setPoolFor", chainId, projectId, values }));
    }
  }

  if (preset.steps.includes("setTerminalFor")) {
    const routerRegistry = contractAddressOn("JBRouterTerminalRegistry", chainId);
    const terminal = routerRegistry
      ? await client
          .readContract({
            address: routerRegistry,
            abi: jbRouterTerminalRegistryAbi,
            functionName: "terminalOf",
            args: [pid],
          })
          .catch(() => null)
      : null;
    if (!terminal || !isAddressEqual(terminal, preset.targets.terminal)) {
      steps.push(
        buildStep({
          kind: "setTerminalFor",
          chainId,
          projectId,
          values: { terminal: getAddress(preset.targets.terminal) },
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
 * from the target chain's live pool, the hook target from its registry, and a
 * pool initialization (chain-specific price) is refused outright.
 */
export function stepResolverFor(clientFor: (chainId: number) => PresetReadClient): StepResolver {
  return async (step, chainId, projectId) => {
    const client = clientFor(chainId);
    const pid = BigInt(projectId);
    if (step.kind === "initializePoolFor") return null;
    const token = mapTerminalToken(step.values.terminalToken as Address, step.chainId, chainId);
    if (!token) return null;
    const hook = await currentHookOf(client, chainId, pid);
    if (!hook) return null;
    const read = isAddressEqual(token, NATIVE_TOKEN) ? zeroAddress : token;
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
