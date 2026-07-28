"use client";

import { ProfilesProvider } from "@/components/ProfilesContext";
import { ActivityFeedSkeleton } from "@/components/loading/LoadingSkeletons";
import { ActivityEventsOperation, useBendystrawQuery } from "@/lib/bendystraw";
import type { SuckerGroupQuery } from "@/lib/bendystraw/types";
import { useState } from "react";
import { ActivityItem } from "./ActivityItem";
import { mapActivityEvents } from "./mapActivityEvents";

type Project = NonNullable<
  NonNullable<SuckerGroupQuery["suckerGroup"]>["projects"]
>["items"][number];

interface Props {
  suckerGroupId: string;
  projects: Project[];
}

const INITIAL_ITEMS = 10;
const LOAD_MORE_COUNT = 5;

export function ActivityFeed({ suckerGroupId, projects }: Props) {
  const [visibleCount, setVisibleCount] = useState(INITIAL_ITEMS);
  const { data, isLoading } = useBendystrawQuery(
    ActivityEventsOperation,
    {
      orderBy: "timestamp",
      orderDirection: "desc",
      where: { suckerGroupId },
    },
    { pollInterval: 15_000, chainId: Number(projects[0]?.chainId ?? 1) },
  );

  const items = data?.activityEvents.items ?? [];

  const events = mapActivityEvents(items, (event) => {
    const projectForChain = projects.find((p) => p.chainId === event.chainId);
    if (!projectForChain?.tokenSymbol) return null;
    return { tokenSymbol: projectForChain.tokenSymbol, decimals: projectForChain.decimals };
  });

  const visibleEvents = events.slice(0, visibleCount);
  const hasMore = events.length > visibleCount;
  const addresses = visibleEvents.map((e) => e.beneficiary);

  return (
    <div className="mt-6">
      <h3 className="text-lg font-medium mb-2">Activity</h3>
      <ProfilesProvider addresses={addresses}>
        <div className="pr-1">
          {visibleEvents.length > 0 ? (
            <div className="flex flex-col">
              {visibleEvents.map((event) => (
                <ActivityItem key={event.id} event={event} />
              ))}
            </div>
          ) : (
            <div className={isLoading ? "py-2" : "py-4 text-center"}>
              {isLoading ? (
                <ActivityFeedSkeleton />
              ) : (
                <p className="text-sm text-zinc-500">No activity yet</p>
              )}
            </div>
          )}
        </div>

        {hasMore && (
          <button
            onClick={() => setVisibleCount((prev) => prev + LOAD_MORE_COUNT)}
            className="w-full mt-3 py-2 text-sm font-medium text-zinc-600 border border-zinc-200 rounded-md hover:bg-zinc-50 transition-colors"
          >
            Load more
          </button>
        )}
      </ProfilesProvider>
    </div>
  );
}
