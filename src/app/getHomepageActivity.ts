import "server-only";

import { ActivityEventsOperation } from "@/lib/bendystraw/operations";
import { queryBendystraw } from "@/lib/bendystraw/query.server";
import type { ActivityEventsQuery } from "@/lib/bendystraw/types";
import { mainnet } from "@/lib/chains";
import { getIssuanceFingerprint } from "@/lib/issuanceFingerprint.server";
import type { JBChainId } from "@bananapus/nana-sdk-core";

export type HomepageRawActivity = ActivityEventsQuery["activityEvents"]["items"][number] & {
  issuanceFingerprint?: number[];
};

function relevant(event: HomepageRawActivity) {
  return !!(
    event.project?.isRevnet &&
    (event.payEvent ||
      event.cashOutTokensEvent ||
      event.swapEvent ||
      event.sendPayoutsEvent ||
      event.rulesetQueuedEvent ||
      event.projectCreateEvent ||
      event.addToBalanceEvent)
  );
}

export async function getHomepageActivityPage(limit = 8, offset = 0) {
  try {
    const wanted = offset + limit;
    const matches: HomepageRawActivity[] = [];
    let sourceOffset = 0;
    let totalCount = Number.POSITIVE_INFINITY;
    while (matches.length < wanted && sourceOffset < totalCount) {
      const data = await queryBendystraw(mainnet.id, ActivityEventsOperation, {
        where: { version: 6 },
        orderBy: "timestamp",
        orderDirection: "desc",
        limit: 100,
        offset: sourceOffset,
      });
      const items = data.activityEvents.items ?? [];
      totalCount = data.activityEvents.totalCount ?? sourceOffset + items.length;
      matches.push(...items.filter(relevant));
      sourceOffset += items.length;
      if (!items.length) break;
    }
    const fingerprints = new Map<string, Promise<number[]>>();
    return Promise.all(
      matches.slice(offset, wanted).map(async (event) => {
        const key = `${event.chainId}:${event.project?.projectId ?? 0}`;
        if (event.project && !fingerprints.has(key)) {
          fingerprints.set(
            key,
            getIssuanceFingerprint(event.project.projectId, event.chainId as JBChainId),
          );
        }
        return {
          ...event,
          issuanceFingerprint: (await fingerprints.get(key)) ?? [],
        };
      }),
    );
  } catch {
    return [];
  }
}
