"use client";

import { ChainLogo } from "@/components/ChainLogo";
import { DateRelative } from "@/components/DateRelative";
import EtherscanLink from "@/components/EtherscanLink";
import { ProfileAvatar } from "@/components/ProfileAvatar";
import { useJBTokenContext } from "@/lib/nana/project";
import type { JBChainId } from "@/lib/nana/types";
import { formatTokenSymbol } from "@/lib/utils";
import { JB_CHAINS } from "@bananapus/nana-sdk-core";
import { Address } from "viem";

type ActivityEventType =
  | "in"
  | "out"
  | "addToBalance"
  | "mint"
  | "autoIssue"
  | "deployErc20"
  | "projectCreate"
  | "projectTransfer"
  | "operatorPermissionsSet"
  | "rulesetQueued"
  | "swapBuy"
  | "swapSell"
  | "buybackPool"
  | "payout";

export interface ActivityEvent {
  id: string;
  type: ActivityEventType;
  txHash: string;
  timestamp: number;
  beneficiary: Address;
  chainId: JBChainId;
  baseAmount?: string;
  /** The unabbreviated amount (and raw accounting amount when the headline is USD). */
  exactAmount?: string;
  baseTokenSymbol?: string;
  tokenCount?: string;
  memo?: string;
  /** Pre-formatted suffix detail, e.g. "ART" for deployErc20 or a truncated address for transfers. */
  detail?: string;
  /** Other events from the same transaction, folded into this row's sentence. */
  also?: ActivityEvent[];
}

/**
 * The group members worth describing. A zero-issuance pay's "paid in" adds
 * nothing next to the row's amount and "in" tag, so it contributes no
 * fragment when other actions exist — it still anchors the row's meta.
 */
export function describableEntries(event: ActivityEvent): ActivityEvent[] {
  const entries = [event, ...(event.also ?? [])];
  if (entries.length === 1) return entries;
  const visible = entries.filter(
    (entry) => !(entry.type === "in" && (!entry.tokenCount || entry.tokenCount === "0")),
  );
  return visible.length ? visible : entries;
}

/** One sentence for a row and its same-tx companions: "bought …, and received …". */
export function combinedDescription(event: ActivityEvent, projectTokenSymbol: string): string {
  const fragments = describableEntries(event).map((entry) =>
    eventDescription(entry, projectTokenSymbol),
  );
  if (fragments.length === 1) return fragments[0];
  if (fragments.length === 2) return `${fragments[0]} and ${fragments[1]}`;
  return `${fragments.slice(0, -1).join(", ")}, and ${fragments[fragments.length - 1]}`;
}

function eventDescription(event: ActivityEvent, projectTokenSymbol: string): string {
  switch (event.type) {
    case "in":
      // Acquisitions read "bought <amount> <token> <source>", matching the
      // buyback fragment. A buyback-routed pay issues nothing itself — the
      // same-tx remint row carries the payer's receipt, so "bought 0" would
      // misread.
      return event.tokenCount && event.tokenCount !== "0"
        ? `bought ${event.tokenCount} ${projectTokenSymbol} from issuance`
        : "paid in";
    case "out":
      return `cashed out ${event.tokenCount} ${projectTokenSymbol}`;
    case "addToBalance":
      return "added to balance";
    case "mint":
      // `detail` marks the reserved-rate remint of a same-tx buyback swap.
      return event.detail
        ? `received ${event.tokenCount} ${projectTokenSymbol} ${event.detail}`
        : `minted ${event.tokenCount} ${projectTokenSymbol}`;
    case "autoIssue":
      return `auto-issued ${event.tokenCount} ${projectTokenSymbol}`;
    case "deployErc20":
      return `deployed the ${event.detail ?? projectTokenSymbol} token`;
    case "projectCreate":
      return "created the project";
    case "projectTransfer":
      return `transferred the project${event.detail ? ` to ${event.detail}` : ""}`;
    case "operatorPermissionsSet":
      return "updated permissions";
    case "rulesetQueued":
      return "queued a ruleset";
    case "swapBuy":
      return `bought ${event.tokenCount} ${projectTokenSymbol} via the buyback pool`;
    case "swapSell":
      return `sold ${event.tokenCount} ${projectTokenSymbol} via the buyback pool`;
    case "buybackPool":
      return "set the buyback pool";
    case "payout":
      return "sent payouts";
  }
}

/** Project-page wrapper: reads the project token context for the symbol. */
export function ActivityItem({ event }: { event: ActivityEvent }) {
  const { token } = useJBTokenContext();

  if (!token?.data) return null;

  return (
    <ActivityItemRow event={event} projectTokenSymbol={formatTokenSymbol(token.data.symbol)} />
  );
}

/**
 * Context-free row renderer, usable outside a ProjectProvider (e.g. the
 * account view). When the symbol is unknown, amounts render without one.
 */
export function ActivityItemRow({
  event,
  projectTokenSymbol: symbol,
}: {
  event: ActivityEvent;
  projectTokenSymbol?: string;
}) {
  const chain = JB_CHAINS[event.chainId].chain;

  const projectTokenSymbol = symbol ?? "tokens";
  const isPayEvent = event.type === "in";
  const isInflow = isPayEvent || event.type === "addToBalance" || event.type === "swapBuy";
  const isOutflow = event.type === "out" || event.type === "swapSell";
  // One fragment per same-tx event: a lone one reads inline, several read as bullets.
  const fragments = describableEntries(event).map((entry) =>
    eventDescription(entry, projectTokenSymbol),
  );
  const description = combinedDescription(event, projectTokenSymbol);

  const handleShare = async () => {
    const embedUrl = typeof window !== "undefined" ? window.location.href : "";
    const handle = `${event.beneficiary.slice(0, 6)}…`;
    const shareText = isPayEvent
      ? `⏩ ${handle} paid ${event.baseAmount} ${event.baseTokenSymbol} and received ${event.tokenCount} ${projectTokenSymbol} — "${event.memo}"`
      : event.type === "out"
        ? `⏩ ${handle} cashed out ${event.tokenCount} ${projectTokenSymbol} for ${event.baseAmount} ${event.baseTokenSymbol}`
        : `⏩ ${handle} ${description}`;
    if (navigator.share) {
      try {
        await navigator.share({ text: shareText, url: embedUrl });
        return;
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
      }
    }

    const composer = new URL("https://farcaster.xyz/~/compose");
    composer.searchParams.set("text", shareText);
    composer.searchParams.append("embeds[]", embedUrl);
    window.open(composer, "_blank", "noopener,noreferrer");
  };

  return (
    <div className="py-3 border-b border-zinc-200 last:border-b-0 flex gap-2">
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between text-xs text-zinc-500">
          {/* One shape for every row: time | actor, then the memo headline,
              then the actions as fine-print bullets. */}
          <span className="flex min-w-0 items-center gap-1.5">
            <EtherscanLink type="tx" value={event.txHash} chain={chain}>
              <DateRelative timestamp={event.timestamp} />
            </EtherscanLink>
            <span aria-hidden>|</span>
            <ProfileAvatar address={event.beneficiary} short chain={chain} />
          </span>
          <div className="flex items-center gap-2">
            {event.baseAmount && (
              // The exact value is one hover away — `title` has no open delay, so an
              // abbreviated or USD-denominated headline never hides the real number.
              <span title={event.exactAmount}>
                {event.baseTokenSymbol
                  ? `${event.baseAmount} ${event.baseTokenSymbol}`
                  : event.baseAmount}
              </span>
            )}
            {isInflow && (
              <span className="border border-teal-600 bg-teal-50 text-teal-600 text-[10px] px-1 py-0.5">
                in
              </span>
            )}
            {isOutflow && (
              <span className="border border-orange-500 bg-orange-50 text-orange-500 text-[10px] px-1 py-0.5">
                out
              </span>
            )}
            <ChainLogo chainId={event.chainId} width={14} height={14} />
          </div>
        </div>
        {event.memo && (
          <p className="text-sm text-zinc-700 break-all mt-0.5">
            <button
              type="button"
              onClick={() => void handleShare()}
              className="text-left hover:underline"
              title="Share this activity"
              aria-label={`Share activity: ${event.memo}`}
            >
              “{event.memo}”
            </button>
          </p>
        )}
        <ul className="mt-0.5 space-y-0.5 text-xs text-zinc-500">
          {/* Hand-rolled markers: the dot sits flush left while wrapped
              lines keep hanging-indent alignment with the first line's text. */}
          {fragments.map((fragment, index) => (
            <li
              key={index}
              className="relative break-words pl-3.5 before:absolute before:left-0 before:text-zinc-300 before:content-['•']"
            >
              {fragment}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
