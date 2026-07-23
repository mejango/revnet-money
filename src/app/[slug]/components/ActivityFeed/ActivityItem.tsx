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

export type ActivityEventType =
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
  | "buybackPool";

export interface ActivityEvent {
  id: string;
  type: ActivityEventType;
  txHash: string;
  timestamp: number;
  beneficiary: Address;
  chainId: JBChainId;
  baseAmount?: string;
  baseTokenSymbol?: string;
  tokenCount?: string;
  memo?: string;
  /** Pre-formatted suffix detail, e.g. "ART" for deployErc20 or a truncated address for transfers. */
  detail?: string;
}

function eventDescription(event: ActivityEvent, projectTokenSymbol: string): string {
  switch (event.type) {
    case "in":
      return `got ${event.tokenCount} ${projectTokenSymbol}`;
    case "out":
      return `cashed out ${event.tokenCount} ${projectTokenSymbol}`;
    case "addToBalance":
      return "added to balance";
    case "mint":
      return `minted ${event.tokenCount} ${projectTokenSymbol}`;
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
    case "buybackPool":
      return "set the buyback pool";
  }
}

export function ActivityItem({ event }: { event: ActivityEvent }) {
  const { token } = useJBTokenContext();
  const chain = JB_CHAINS[event.chainId].chain;

  if (!token?.data) return null;

  const projectTokenSymbol = formatTokenSymbol(token.data.symbol);
  const isPayEvent = event.type === "in";
  const isInflow = isPayEvent || event.type === "addToBalance";
  const isOutflow = event.type === "out";
  const description = eventDescription(event, projectTokenSymbol);

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
      <ProfileAvatar
        address={event.beneficiary}
        withAvatar
        avatarProps={{ size: "sm" }}
        chain={chain}
        className="[&>*:last-child]:hidden"
      />
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between text-xs text-zinc-500">
          <EtherscanLink type="tx" value={event.txHash} chain={chain}>
            <DateRelative timestamp={event.timestamp} />
          </EtherscanLink>
          <div className="flex items-center gap-1">
            {event.baseAmount && (
              <span>
                {event.baseAmount} {event.baseTokenSymbol}
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
        <div className="text-sm mt-0.5">
          <ProfileAvatar address={event.beneficiary} short chain={chain} />
          <span className="text-zinc-600"> {description}</span>
        </div>
        {event.memo && (
          <p className="text-sm text-zinc-700 break-all mt-1">
            <button
              type="button"
              onClick={() => void handleShare()}
              className="text-left hover:underline"
              title="Share this activity"
              aria-label={`Share activity: ${event.memo}`}
            >
              {event.memo}
            </button>
          </p>
        )}
      </div>
    </div>
  );
}
