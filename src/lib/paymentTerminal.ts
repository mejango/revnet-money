import { routerEntriesFor } from "@/lib/protocol-rollout";
import {
  getJBContractAddress,
  JBChainId,
  jbMultiTerminalAbi,
  JBRouterTerminalContracts,
  jbRouterTerminalRegistryAbi,
  jbV6ContractAddress,
} from "@bananapus/nana-sdk-core";
import {
  PaySwapQuoteFailedError,
  prepareUserPay,
  type PreparedUserPay,
} from "@bananapus/nana-sdk-core/v6";
import { Address, PublicClient } from "viem";

type PaymentTerminalType = "multi" | "swap";

type PaymentTerminal = {
  address: Address;
  abi: typeof jbMultiTerminalAbi | typeof jbRouterTerminalRegistryAbi;
  type: PaymentTerminalType;
};

export type V6PayRoute = PaymentTerminal & PreparedUserPay;

/**
 * Resolve the best v6 pay route by preparing the payment on both the multi terminal and the
 * router terminal registry, keeping whichever gives the beneficiary the most project tokens.
 * Candidates whose preview reverts (e.g. no accounting context for the token) are
 * skipped, so a surviving route always carries a live quote. When none survives and a swap
 * quote failed, that failure is thrown so the payer can retry the quote.
 */
export async function resolveBestV6PayRoute(args: {
  client: PublicClient;
  chainId: JBChainId;
  projectId: bigint;
  token: Address;
  amount: bigint;
  beneficiary: Address;
  attachedTerminals?: readonly Address[];
  /** The payer's tolerance on the SDK's quote and minimum; the SDK default when unset. */
  slippageBps?: bigint;
}): Promise<V6PayRoute | null> {
  const { client, chainId, projectId, token, amount, beneficiary, slippageBps } = args;

  let swapQuoteFailure: PaySwapQuoteFailedError | undefined;
  const previews = await Promise.all(
    v6PayRouteCandidates(chainId, args.attachedTerminals).map(async (route) => {
      try {
        const prepared = await prepareUserPay(client, {
          chainId,
          terminal: route.address,
          projectId,
          token,
          amount,
          beneficiary,
          ...(slippageBps !== undefined ? { slippageBps } : {}),
        });
        return { ...route, ...prepared };
      } catch (error) {
        if (error instanceof PaySwapQuoteFailedError) swapQuoteFailure = error;
        return null;
      }
    }),
  );

  let best: V6PayRoute | null = null;
  for (const route of previews) {
    if (!route) continue;
    if (!best || v6PayRouteIsBetter(route, best)) best = route;
  }
  if (!best && swapQuoteFailure) throw swapQuoteFailure;
  return best;
}

function v6PayRouteCandidates(
  chainId: JBChainId,
  attachedTerminals?: readonly Address[],
): PaymentTerminal[] {
  const routes: PaymentTerminal[] = [];

  if (attachedTerminals) {
    routes.push(
      ...routerEntriesFor(chainId, attachedTerminals).map((address) => ({
        address,
        abi: jbRouterTerminalRegistryAbi,
        type: "swap" as const,
      })),
    );
  } else
    try {
      routes.push({
        address: getJBContractAddress(
          JBRouterTerminalContracts.JBRouterTerminalRegistry,
          6,
          chainId,
        ),
        abi: jbRouterTerminalRegistryAbi,
        type: "swap",
      });
    } catch {
      // Router registry not deployed on this chain.
    }

  const multi = jbV6ContractAddress.JBMultiTerminal[chainId];
  if (
    multi &&
    (!attachedTerminals ||
      attachedTerminals.some((address) => address.toLowerCase() === multi.toLowerCase())) &&
    !routes.some((route) => route.address.toLowerCase() === multi.toLowerCase())
  ) {
    routes.push({ address: multi, abi: jbMultiTerminalAbi, type: "multi" });
  }

  return routes;
}

function v6PayRouteIsBetter(candidate: V6PayRoute, current: V6PayRoute): boolean {
  if (candidate.preview.beneficiaryTokenCount !== current.preview.beneficiaryTokenCount) {
    return candidate.preview.beneficiaryTokenCount > current.preview.beneficiaryTokenCount;
  }
  const candidateTotal =
    candidate.preview.beneficiaryTokenCount + candidate.preview.reservedTokenCount;
  const currentTotal = current.preview.beneficiaryTokenCount + current.preview.reservedTokenCount;
  if (candidateTotal !== currentTotal) return candidateTotal > currentTotal;

  // Prefer the direct multi terminal over the router when quotes tie.
  return candidate.type === "multi" && current.type !== "multi";
}
