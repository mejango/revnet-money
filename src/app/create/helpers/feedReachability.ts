// Launch guard: a project whose accounting contexts and base currency need a
// JBPrices conversion that no feed can serve is bricked at runtime — USDC pays
// revert against an ETH base (JBTerminalStore converts context.currency ->
// baseCurrency), and mixed-balance cash-outs/surplus views revert as soon as
// two contexts both hold funds (the store converts every context's balance
// into the reclaimed context's currency, not the base). Feeds resolve direct
// or inverse only — never transitively — and revnet stages can never register
// project-level feeds, so a feed-less combination must be blocked BEFORE
// launch. Probing on-chain (project 0 = the default feeds a new project falls
// through to) means a later protocol-side feed registration unblocks the
// combination with no client release.
//
// Pair derivation and the probe itself live in the SDK; only the user-facing
// copy and the fail-closed policy are local.
import {
  JB_CHAINS,
  JBChainId,
  jbContractAddress,
  JBCoreContracts,
  NATIVE_TOKEN,
  USDC_ADDRESSES,
} from "@bananapus/nana-sdk-core";
import {
  BASE_CURRENCY_ETH,
  BASE_CURRENCY_USD,
  probeFeedReachability,
  requiredFeedPairs,
  type JBAccountingContext,
  type JBFeedPair,
} from "@bananapus/nana-sdk-core/v6";
import { PublicClient } from "viem";

/** Structurally the SDK's `JBAccountingContext`. */
export type FeedProbeContext = JBAccountingContext;
export type FeedPair = JBFeedPair;

export { requiredFeedPairs };

function shortAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

function currencyLabel(
  currency: number,
  contexts: readonly FeedProbeContext[],
  chainId: JBChainId,
): string {
  const context = contexts.find((candidate) => candidate.currency === currency);
  if (context) {
    if (context.token.toLowerCase() === NATIVE_TOKEN.toLowerCase()) return "ETH";
    const usdc = USDC_ADDRESSES[chainId];
    if (usdc && context.token.toLowerCase() === usdc.toLowerCase()) return "USDC";
    return shortAddress(context.token);
  }
  if (currency === BASE_CURRENCY_ETH) return "ETH";
  if (currency === BASE_CURRENCY_USD) return "USD";
  return `currency ${currency}`;
}

/**
 * Fail-closed launch gate. Probes `JBPrices.pricePerUnitOf` with project id 0
 * (the default-feed lookup a freshly launched project resolves through) for
 * every required pair on the given chain, and throws a user-facing error when
 * any pair is unreachable — or unverifiable. The thrown message names the
 * token pair and chain.
 *
 * Pairs are probed one at a time so the message can name the pair that failed:
 * the SDK's tri-state verdict reports which pairs are `missing`, but an
 * `unavailable` transport failure carries no pair.
 */
export async function assertLaunchFeedsReachable({
  chainId,
  publicClient,
  contexts,
  baseCurrency,
}: {
  chainId: JBChainId;
  publicClient: PublicClient;
  contexts: readonly FeedProbeContext[];
  baseCurrency: number;
}): Promise<void> {
  const pairs = requiredFeedPairs(contexts, baseCurrency);
  if (pairs.length === 0) return;

  const chainName = JB_CHAINS[chainId]?.name ?? `chain ${chainId}`;
  if (!jbContractAddress[6][JBCoreContracts.JBPrices][chainId]) {
    throw new Error(
      `No price contract is known on ${chainName}, so this token combination can't be verified. Remove ${chainName} or launch with a single accepted token.`,
    );
  }

  for (const pair of pairs) {
    const from = currencyLabel(pair.pricingCurrency, contexts, chainId);
    const to = currencyLabel(pair.unitCurrency, contexts, chainId);
    const verdict = await probeFeedReachability(publicClient, { chainId, pairs: [pair] });
    // `missing` is a proven on-chain revert; `unavailable` is anything the
    // chain never answered. Both block the launch, but only the first is a
    // fact about the protocol.
    if (verdict.status === "missing") {
      throw new Error(
        `No price feed on ${chainName} converts ${from} to ${to}, so a project accepting this combination would have payments and cash-outs revert on-chain. Launch with a single accepted token, or try again once the protocol registers this feed.`,
      );
    }
    if (verdict.status !== "ok") {
      throw new Error(
        `Couldn't verify the ${from} to ${to} price feed on ${chainName}. Check your connection and try again.`,
      );
    }
  }
}
