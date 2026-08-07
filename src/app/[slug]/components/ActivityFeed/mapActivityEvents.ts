import type { ActivityEventsQuery } from "@/lib/bendystraw/types";
import type { JBChainId } from "@/lib/nana/types";
import { formatDecimals, prettyNumber } from "@/lib/number";
import { JBProjectToken } from "@bananapus/nana-sdk-core";
import { Address, formatUnits } from "viem";
import { formatCompact, exactNumber } from "@/lib/number";
import { formatUsd, usdFromScaled } from "../v6/extras/projectPayers";
import type { ActivityEvent } from "./ActivityItem";

export type ActivityEventItem = ActivityEventsQuery["activityEvents"]["items"][number];

/** Holder permission grants are account history, not project activity. */
export function isProjectFeedActivityEvent(event: ActivityEventItem): boolean {
  return !event.operatorPermissionsSetEvent;
}

/**
 * The token denomination for one event's amounts. Return null to skip the row
 * entirely (the project feed's behavior for chains it can't denominate);
 * return a context without a tokenSymbol to keep the row and omit the symbol
 * gracefully (the account feed's behavior for arbitrary projects).
 */
export type ActivityTokenContext = {
  tokenSymbol?: string | null;
  decimals?: number | null;
  /**
   * Denominate flow amounts in the indexer's 18-decimal USD figures instead of
   * the chain's accounting token. The ecosystem convention: token amounts only
   * when the project has exactly one accounting-token kind across its chains.
   */
  denominateInUsd?: boolean;
} | null;

/**
 * Project-feed denomination policy over the sucker group's per-chain rows:
 * token amounts when every chain shares one accounting-token kind, USD when
 * the chains disagree on symbol or decimals.
 */
export function projectFeedTokenContext(
  projects: ReadonlyArray<{
    chainId: number;
    tokenSymbol: string | null;
    decimals: number | null;
  }>,
): (item: ActivityEventItem) => ActivityTokenContext {
  const tokenKinds = new Set(
    projects
      .filter((project) => project.tokenSymbol)
      .map((project) => `${project.tokenSymbol}:${project.decimals ?? 18}`),
  );
  const denominateInUsd = tokenKinds.size > 1;

  return (event) => {
    const projectForChain = projects.find((project) => project.chainId === event.chainId);
    // No accounting context for this chain — the project exists but has no ruleset/terminal
    // there, or the row wasn't fetched. The activity still HAPPENED, so keep the row and let
    // `flowAmount` decide what it can honestly show; dropping it silently denied the event.
    if (!projectForChain?.tokenSymbol) {
      return { tokenSymbol: undefined, decimals: undefined, denominateInUsd: true };
    }
    return {
      tokenSymbol: projectForChain.tokenSymbol,
      decimals: projectForChain.decimals,
      denominateInUsd,
    };
  };
}

function truncateAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

/**
 * Maps raw bendystraw activity-event rows to renderable ActivityEvent rows.
 * Extracted from the project ActivityFeed so it also works without a sucker
 * group: `tokenContextFor` decides each row's denomination (and whether the
 * row is kept at all).
 */
export function mapActivityEvents(
  items: ReadonlyArray<ActivityEventItem | null | undefined>,
  tokenContextFor: (item: ActivityEventItem) => ActivityTokenContext,
): ActivityEvent[] {
  // mintTokensOf fires alongside pays, manual mints, and auto-issuance, each of which
  // already gets its own row — only surface mintTokensEvent rows for txs none of those
  // cover (e.g. bridge receipts). Same idea for manual mints inside auto-issue txs.
  const mintCoveredTxs = new Set<string>();
  const autoIssueTxs = new Set<string>();
  for (const event of items) {
    if (!event) continue;
    const key = `${event.chainId}:${event.txHash}`;
    if (event.payEvent || event.manualMintTokensEvent || event.autoIssueEvent) {
      mintCoveredTxs.add(key);
    }
    if (event.autoIssueEvent) autoIssueTxs.add(key);
  }

  const events: ActivityEvent[] = [];
  for (const event of items) {
    if (!event) continue;

    const chainId = event.chainId as JBChainId;
    const tokenContext = tokenContextFor(event);
    if (!tokenContext) continue;

    const baseTokenSymbol = tokenContext.tokenSymbol ?? undefined;
    const baseTokenDecimals = tokenContext.decimals ?? 18;
    const txKey = `${event.chainId}:${event.txHash}`;

    // In USD mode a missing/zero indexed figure falls back to the chain's
    // token so the row still shows a meaningful amount.
    const flowAmount = (tokenAmount: string | number, usdAmount?: string | number | null) => {
      const usd = tokenContext.denominateInUsd ? usdFromScaled(usdAmount) : null;
      if (usd) {
        // USD is the headline; the raw accounting amount is what a hover reveals. It can
        // only be shown when the context's decimals are known.
        const exact =
          tokenContext.decimals == null
            ? undefined
            : `${exactNumber(formatUnits(BigInt(tokenAmount), baseTokenDecimals))}${
                baseTokenSymbol ? ` ${baseTokenSymbol}` : ""
              }`;
        return { baseAmount: formatUsd(usd), baseTokenSymbol: undefined, exactAmount: exact };
      }
      // Without the accounting context's decimals the raw amount cannot be scaled — showing
      // it at an assumed 18 would be off by 1e12 on a 6-decimal token. Keep the row and omit
      // the amount rather than invent a magnitude.
      if (tokenContext.decimals == null) {
        return { baseAmount: undefined, baseTokenSymbol: undefined, exactAmount: undefined };
      }
      const whole = formatUnits(BigInt(tokenAmount), baseTokenDecimals);
      return {
        baseAmount: formatCompact(whole),
        baseTokenSymbol,
        exactAmount: `${exactNumber(whole)}${baseTokenSymbol ? ` ${baseTokenSymbol}` : ""}`,
      };
    };

    if (event.payEvent) {
      const tokenCount = new JBProjectToken(BigInt(event.payEvent.newlyIssuedTokenCount)).format(6);

      events.push({
        id: event.id,
        type: "in",
        txHash: event.payEvent.txHash,
        timestamp: event.payEvent.timestamp,
        beneficiary: event.payEvent.beneficiary as Address,
        chainId,
        ...flowAmount(event.payEvent.amount, event.payEvent.amountUsd),
        tokenCount,
        memo: event.payEvent.memo || undefined,
      });
    } else if (event.cashOutTokensEvent) {
      const tokenCount = new JBProjectToken(BigInt(event.cashOutTokensEvent.cashOutCount)).format(
        6,
      );

      events.push({
        id: event.id,
        type: "out",
        txHash: event.cashOutTokensEvent.txHash,
        timestamp: event.cashOutTokensEvent.timestamp,
        beneficiary: event.cashOutTokensEvent.beneficiary as Address,
        chainId,
        ...flowAmount(
          event.cashOutTokensEvent.reclaimAmount,
          event.cashOutTokensEvent.reclaimAmountUsd,
        ),
        tokenCount,
      });
    } else if (event.addToBalanceEvent) {
      const e = event.addToBalanceEvent;
      events.push({
        id: event.id,
        type: "addToBalance",
        txHash: e.txHash,
        timestamp: e.timestamp,
        beneficiary: e.from as Address,
        chainId,
        baseAmount: formatDecimals(Number(formatUnits(BigInt(e.amount), baseTokenDecimals))),
        baseTokenSymbol,
        memo: e.memo || undefined,
      });
    } else if (event.mintTokensEvent) {
      if (mintCoveredTxs.has(txKey)) continue;
      const e = event.mintTokensEvent;
      events.push({
        id: event.id,
        type: "mint",
        txHash: e.txHash,
        timestamp: e.timestamp,
        beneficiary: e.beneficiary as Address,
        chainId,
        tokenCount: new JBProjectToken(BigInt(e.beneficiaryTokenCount)).format(6),
        memo: e.memo || undefined,
      });
    } else if (event.manualMintTokensEvent) {
      if (autoIssueTxs.has(txKey)) continue;
      const e = event.manualMintTokensEvent;
      events.push({
        id: event.id,
        type: "mint",
        txHash: e.txHash,
        timestamp: e.timestamp,
        beneficiary: e.beneficiary as Address,
        chainId,
        tokenCount: new JBProjectToken(BigInt(e.beneficiaryTokenCount)).format(6),
        memo: e.memo || undefined,
      });
    } else if (event.autoIssueEvent) {
      const e = event.autoIssueEvent;
      events.push({
        id: event.id,
        type: "autoIssue",
        txHash: e.txHash,
        timestamp: e.timestamp,
        beneficiary: e.beneficiary as Address,
        chainId,
        tokenCount: new JBProjectToken(BigInt(e.count)).format(6),
      });
    } else if (event.deployErc20Event) {
      const e = event.deployErc20Event;
      events.push({
        id: event.id,
        type: "deployErc20",
        txHash: e.txHash,
        timestamp: e.timestamp,
        beneficiary: e.from as Address,
        chainId,
        detail: e.symbol.replace(/^\$+/, ""),
      });
    } else if (event.projectCreateEvent) {
      const e = event.projectCreateEvent;
      events.push({
        id: event.id,
        type: "projectCreate",
        txHash: e.txHash,
        timestamp: e.timestamp,
        beneficiary: e.from as Address,
        chainId,
      });
    } else if (event.projectTransferEvent) {
      const e = event.projectTransferEvent;
      events.push({
        id: event.id,
        type: "projectTransfer",
        txHash: e.txHash,
        timestamp: e.timestamp,
        beneficiary: e.previousOwner as Address,
        chainId,
        detail: truncateAddress(e.owner),
      });
    } else if (event.operatorPermissionsSetEvent) {
      const e = event.operatorPermissionsSetEvent;
      events.push({
        id: event.id,
        type: "operatorPermissionsSet",
        txHash: e.txHash,
        timestamp: e.timestamp,
        beneficiary: e.from as Address,
        chainId,
      });
    } else if (event.rulesetQueuedEvent) {
      const e = event.rulesetQueuedEvent;
      events.push({
        id: event.id,
        type: "rulesetQueued",
        txHash: e.txHash,
        timestamp: e.timestamp,
        beneficiary: e.from as Address,
        chainId,
      });
    } else if (event.swapEvent) {
      const e = event.swapEvent;
      const isSell = e.direction.toLowerCase() === "sell";
      events.push({
        id: event.id,
        type: isSell ? "swapSell" : "swapBuy",
        txHash: e.txHash,
        timestamp: e.timestamp,
        // PoolManager is the indexed caller; `from` is the payer/seller whose
        // wallet should be attributed in the human activity feed.
        beneficiary: e.from as Address,
        chainId,
        ...flowAmount(e.terminalTokenAmount),
        tokenCount: prettyNumber(new JBProjectToken(BigInt(e.projectTokenAmount)).format(6)),
      });
    } else if (event.buybackPoolEvent) {
      const e = event.buybackPoolEvent;
      events.push({
        id: event.id,
        type: "buybackPool",
        txHash: e.txHash,
        timestamp: e.timestamp,
        beneficiary: e.from as Address,
        chainId,
      });
    }
  }
  return events;
}
