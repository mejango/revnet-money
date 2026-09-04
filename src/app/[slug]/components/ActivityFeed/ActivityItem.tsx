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
  | "payout"
  | "reserved"
  | "reservedSplit";

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
  /** The unformatted token count, for ordering same-tx reserved-split receipts. */
  rawTokenCount?: string;
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
  // A reserved distribution's receipts name who got what — its own
  // "distributed" fragment adds nothing beside them.
  const hasReceipts = entries.some((entry) => entry.type === "reservedSplit");
  const visible = entries.filter((entry) => {
    if (entry.type === "in") return !!entry.tokenCount && entry.tokenCount !== "0";
    if (entry.type === "reserved") return !hasReceipts;
    return true;
  });
  return visible.length ? visible : entries;
}

/** Whether the row's transaction distributed reserved tokens — its receipts then read "to <recipient>". */
function distributesReserved(event: ActivityEvent): boolean {
  return event.type === "reserved" || !!event.also?.some((entry) => entry.type === "reserved");
}

/** One sentence for a row and its same-tx companions: "bought …, and received …". */
export function combinedDescription(event: ActivityEvent, projectTokenSymbol: string): string {
  const distributed = distributesReserved(event);
  const fragments = describableEntries(event).map((entry) =>
    eventDescription(entry, projectTokenSymbol, distributed),
  );
  if (fragments.length === 1) return fragments[0];
  if (fragments.length === 2) return `${fragments[0]} and ${fragments[1]}`;
  return `${fragments.slice(0, -1).join(", ")}, and ${fragments[fragments.length - 1]}`;
}

type DescriptionParts = {
  pre: string;
  /** The token amount, slightly emphasized when rendered (same color, heavier weight). */
  strong?: string;
  post?: string;
  /** An address the sentence ends on, rendered as a profile link. */
  recipient?: Address;
};

function descriptionParts(
  event: ActivityEvent,
  projectTokenSymbol: string,
  distributed = false,
): DescriptionParts {
  const count = `${event.tokenCount} ${projectTokenSymbol}`;
  switch (event.type) {
    case "in":
      // Acquisitions read "bought <amount> <token> <source>", matching the
      // buyback fragment. A buyback-routed pay issues nothing itself — the
      // same-tx remint row carries the payer's receipt, so "bought 0" would
      // misread.
      return event.tokenCount && event.tokenCount !== "0"
        ? { pre: "bought ", strong: count, post: " from issuance" }
        : { pre: "paid in" };
    case "out":
      return { pre: "cashed out ", strong: count };
    case "addToBalance":
      return { pre: "added to balance" };
    case "mint":
      // `detail` marks the reserved-rate remint of a same-tx buyback swap.
      return event.detail
        ? { pre: "received ", strong: count, post: ` ${event.detail}` }
        : { pre: "minted ", strong: count };
    case "autoIssue":
      return { pre: "auto-issued ", strong: count };
    case "deployErc20":
      return { pre: `deployed the ${event.detail ?? projectTokenSymbol} token` };
    case "projectCreate":
      return { pre: "created the project" };
    case "projectTransfer":
      return { pre: `transferred the project${event.detail ? ` to ${event.detail}` : ""}` };
    case "operatorPermissionsSet":
      return { pre: "updated permissions" };
    case "rulesetQueued":
      return { pre: "queued a ruleset" };
    case "swapBuy":
      return { pre: "bought ", strong: count, post: " via the buyback pool" };
    case "swapSell":
      return { pre: "sold ", strong: count, post: " via the buyback pool" };
    case "buybackPool":
      return { pre: "set the buyback pool" };
    case "payout":
      return { pre: "sent payouts" };
    case "reserved":
      return { pre: "distributed reserved ", strong: count };
    case "reservedSplit":
      // Under its distribution a receipt names who got what; on its own it
      // is what the account received.
      if (!distributed) return { pre: "received ", strong: count, post: " from a reserved split" };
      return event.detail
        ? { pre: "", strong: count, post: ` to ${event.detail}` }
        : { pre: "", strong: count, post: " to ", recipient: event.beneficiary };
  }
}

function eventDescription(
  event: ActivityEvent,
  projectTokenSymbol: string,
  distributed = false,
): string {
  const parts = descriptionParts(event, projectTokenSymbol, distributed);
  const recipient = parts.recipient
    ? `${parts.recipient.slice(0, 6)}…${parts.recipient.slice(-4)}`
    : "";
  return `${parts.pre}${parts.strong ?? ""}${parts.post ?? ""}${recipient}`;
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
  // A reserved distribution leads with the count the way value flows lead
  // with the amount: "3.6M ART" tagged "reserved distro".
  const isReserved = event.type === "reserved";
  const hasTitle = !!event.baseAmount || isInflow || isOutflow || isReserved;
  const distributed = distributesReserved(event);
  // One fragment per same-tx event: a lone one reads inline, several read as bullets.
  const fragments = describableEntries(event).map((entry) => {
    const parts = descriptionParts(entry, projectTokenSymbol, distributed);
    return (
      <>
        {parts.pre}
        {parts.strong ? <span className="font-medium">{parts.strong}</span> : null}
        {parts.post}
        {parts.recipient ? <ProfileAvatar address={parts.recipient} short chain={chain} /> : null}
      </>
    );
  });
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
        <div className="flex items-center justify-between gap-2 text-xs text-zinc-500">
          {/* One shape for every row: the flow cluster left with "time on
              <chain>" right, the prefixed actor below, then the memo headline
              and the actions as fine-print bullets. The exact value is one
              hover away — `title` has no open delay, so an abbreviated or
              USD-denominated headline never hides the real number. */}
          <span className="flex min-w-0 items-center gap-2 text-sm text-zinc-500">
            {event.baseAmount && (
              <span className="truncate font-semibold text-zinc-800" title={event.exactAmount}>
                {event.baseTokenSymbol
                  ? `${event.baseAmount} ${event.baseTokenSymbol}`
                  : event.baseAmount}
              </span>
            )}
            {isReserved && (
              <span className="truncate font-semibold text-zinc-800">
                {event.tokenCount} {projectTokenSymbol}
              </span>
            )}
            {isInflow && (
              <span className="inline-flex h-5 min-w-7 items-center justify-center border border-teal-600 bg-teal-50 px-1 text-center text-[10px] leading-none text-teal-600">
                in
              </span>
            )}
            {isOutflow && (
              <span className="inline-flex h-5 min-w-7 items-center justify-center border border-orange-500 bg-orange-50 px-1 text-center text-[10px] leading-none text-orange-500">
                out
              </span>
            )}
            {isReserved && (
              <span className="inline-flex h-5 min-w-7 items-center justify-center border border-amber-600 bg-amber-50 px-1 text-center text-[10px] leading-none text-amber-600">
                reserved distro
              </span>
            )}
            {/* No amount and no flow tag = nothing for the title slot; the
                actor takes its place (bare, no "to/from/by") instead of
                leaving a blank line. */}
            {!hasTitle && (
              <span className="min-w-0 truncate text-xs">
                <ProfileAvatar address={event.beneficiary} short chain={chain} />
              </span>
            )}
          </span>
          <span className="flex shrink-0 items-center gap-1.5">
            <EtherscanLink type="tx" value={event.txHash} chain={chain}>
              <DateRelative timestamp={event.timestamp} />
            </EtherscanLink>
            <span>on</span>
            <ChainLogo chainId={event.chainId} width={14} height={14} />
          </span>
        </div>
        {hasTitle && (
          <p className="mt-1 flex min-w-0 items-center gap-1 text-xs text-zinc-500">
            {isOutflow ? "to" : isInflow ? "from" : "by"}{" "}
            <span className="min-w-0 truncate">
              <ProfileAvatar address={event.beneficiary} short chain={chain} />
            </span>
          </p>
        )}
        {event.memo && (
          <p className="text-sm text-zinc-700 break-all mt-3">
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
        <ul className={`${event.memo ? "mt-1" : "mt-3"} space-y-0.5 text-xs text-zinc-500`}>
          {/* Hand-rolled markers: the dot sits flush left while wrapped
              lines keep hanging-indent alignment with the first line's text. */}
          {fragments.map((fragment, index) => (
            <li
              key={index}
              className="relative break-words pl-3.5 before:absolute before:left-0 before:top-[5px] before:h-1.5 before:w-1.5 before:rounded-full before:bg-zinc-300 before:content-['']"
            >
              {fragment}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
