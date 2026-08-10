"use client";

import { ChainLogo } from "@/components/ChainLogo";
import { DateRelative } from "@/components/DateRelative";
import { IpfsImage } from "@/components/IpfsImage";
import { IssuanceFingerprint } from "@/components/IssuanceFingerprint";
import { ProjectLink } from "@/components/ProjectLink";
import { useInfiniteScroll } from "@/hooks/useInfiniteScroll";
import { formatEthAddress } from "@/lib/utils";
import { JB_CHAINS, type JBChainId } from "@bananapus/nana-sdk-core";
import { useCallback, useMemo, useState } from "react";
import {
  mapActivityEvents,
  type ActivityEventItem,
} from "./[slug]/components/ActivityFeed/mapActivityEvents";
import type { HomepageRawActivity } from "./getHomepageActivity";

type HomepageActivity = ReturnType<typeof mapActivityEvents>[number];

function description(event: HomepageActivity, symbol: string) {
  switch (event.type) {
    case "in":
      return `got ${event.tokenCount} ${symbol}`;
    case "out":
      return `cashed out ${event.tokenCount} ${symbol}`;
    case "addToBalance":
      return "added to balance";
    case "swapBuy":
      return `bought ${event.tokenCount} ${symbol} through the market`;
    case "swapSell":
      return `sold ${event.tokenCount} ${symbol} through the market`;
    case "payout":
      return "sent payouts";
    case "rulesetQueued":
      return "reconfigured the revnet";
    case "projectCreate":
      return "created the revnet";
    case "buybackPool":
      return "set the buyback pool";
    default:
      return event.type === "autoIssue"
        ? `auto-issued ${event.tokenCount} ${symbol}`
        : "updated the revnet";
  }
}

export function HomepageActivityFeed({
  initialEvents,
  initialHasMore,
}: {
  initialEvents: HomepageRawActivity[];
  initialHasMore: boolean;
}) {
  const [events, setEvents] = useState(initialEvents);
  const [hasMore, setHasMore] = useState(initialHasMore);
  const [loading, setLoading] = useState(false);
  const mappedById = useMemo(
    () =>
      new Map(
        mapActivityEvents(events as ActivityEventItem[], (event) => ({
          tokenSymbol: event.project?.tokenSymbol,
          decimals: event.project?.decimals,
          denominateInUsd: false,
        })).map((event) => [event.id, event]),
      ),
    [events],
  );

  const loadMore = useCallback(async () => {
    if (!hasMore || loading) return;
    setLoading(true);
    try {
      const response = await fetch(`/api/homepage-activity?limit=8&offset=${events.length}`);
      if (!response.ok) throw new Error("Activity unavailable");
      const data = (await response.json()) as { events: HomepageRawActivity[]; hasMore: boolean };
      setEvents((current) => {
        const ids = new Set(current.map((event) => event.id));
        return [...current, ...data.events.filter((event) => !ids.has(event.id))];
      });
      setHasMore(data.hasMore);
    } finally {
      setLoading(false);
    }
  }, [events.length, hasMore, loading]);
  const markerRef = useInfiniteScroll(loadMore, hasMore && !loading);

  if (!events.length)
    return (
      <p className="flex min-h-[420px] items-center justify-center px-6 text-center text-sm text-zinc-500">
        No recent activity yet.
      </p>
    );
  return (
    <ol className="divide-y divide-teal-100">
      {events.map((event, index) => {
        const project = event.project;
        const activity = mappedById.get(event.id);
        if (!project || !activity) return null;
        const chainId = event.chainId as JBChainId;
        const name = project.name ?? `Project #${project.projectId}`;
        const href = `/${JB_CHAINS[chainId]?.slug ?? "eth"}:${project.projectId}`;
        const explorer = JB_CHAINS[chainId]?.chain.blockExplorers?.default.url;
        const isIn =
          activity.type === "in" || activity.type === "addToBalance" || activity.type === "swapBuy";
        const isOut = activity.type === "out" || activity.type === "swapSell";
        const symbol = project.tokenSymbol?.replace(/^\$+/, "") ?? "tokens";
        return (
          <li key={event.id} className="relative h-28 overflow-hidden px-4 py-3">
            <IssuanceFingerprint values={event.issuanceFingerprint} />
            <div className="relative z-10 flex items-start gap-3">
              <ProjectLink
                href={href}
                projectHint={{
                  name,
                  logoUri: project.logoUri ?? null,
                  tagline: project.projectTagline ?? null,
                }}
                className="shrink-0"
              >
                <IpfsImage
                  src={project.logoUri}
                  alt=""
                  width={46}
                  height={46}
                  loading={index < 4 ? "eager" : "lazy"}
                  fetchPriority={index < 4 ? "high" : "auto"}
                  className="size-[46px] object-cover"
                  fallback={<div className="size-[46px] bg-teal-100" />}
                />
              </ProjectLink>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2 text-xs text-zinc-500">
                  <DateRelative timestamp={event.timestamp} />
                  <div className="flex items-center gap-2">
                    {activity.baseAmount ? (
                      <span title={activity.exactAmount}>
                        {activity.baseAmount}
                        {activity.baseTokenSymbol ? ` ${activity.baseTokenSymbol}` : ""}
                      </span>
                    ) : null}
                    {isIn ? (
                      <span className="border border-teal-600 px-1 py-0.5 text-[10px] text-teal-600">
                        in
                      </span>
                    ) : null}
                    {isOut ? (
                      <span className="border border-orange-500 px-1 py-0.5 text-[10px] text-orange-500">
                        out
                      </span>
                    ) : null}
                    <ChainLogo chainId={chainId} width={14} height={14} />
                  </div>
                </div>
                <ProjectLink
                  href={href}
                  projectHint={{
                    name,
                    logoUri: project.logoUri ?? null,
                    tagline: project.projectTagline ?? null,
                  }}
                  className="mt-1 block truncate text-sm font-medium text-teal-700 hover:underline"
                >
                  {name}
                </ProjectLink>
                <div className="mt-1 line-clamp-2 text-sm">
                  {explorer ? (
                    <a
                      href={`${explorer}/address/${activity.beneficiary}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline decoration-zinc-400 underline-offset-2 hover:text-teal-700"
                    >
                      {formatEthAddress(activity.beneficiary)}
                    </a>
                  ) : (
                    <span>{formatEthAddress(activity.beneficiary)}</span>
                  )}
                  <span className="text-zinc-700"> {description(activity, symbol)}</span>
                </div>
              </div>
            </div>
          </li>
        );
      })}
      {hasMore || loading ? (
        <li className="h-12" aria-hidden>
          <div ref={markerRef} className="h-px" />
        </li>
      ) : null}
    </ol>
  );
}
