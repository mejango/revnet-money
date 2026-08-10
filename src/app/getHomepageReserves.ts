import "server-only";

import { SuckerGroupMomentsOperation } from "@/lib/bendystraw/operations";
import { queryBendystraw } from "@/lib/bendystraw/query.server";
import type { SuckerGroupMoment } from "@/lib/bendystraw/types";
import { mainnet } from "@/lib/chains";
import { unstable_cache } from "next/cache";
import { formatUnits } from "viem";
import { getHomepageEthPrice, getHomepageSuckerGroups } from "./getTopProjects";

export type HomepageReserves = {
  eth: number;
  usdc: number;
  totalUsd: number;
  otherAssets: number;
  points: { timestamp: number; valueUsd: number }[];
};

async function momentsFor(suckerGroupId: string): Promise<SuckerGroupMoment[]> {
  const items: SuckerGroupMoment[] = [];
  let after: string | undefined;
  const cursors = new Set<string>();
  for (;;) {
    const result = await queryBendystraw(mainnet.id, SuckerGroupMomentsOperation, {
      suckerGroupId,
      after,
    });
    items.push(...result.suckerGroupMoments.items);
    const page = result.suckerGroupMoments.pageInfo;
    after = page.hasNextPage ? (page.endCursor ?? undefined) : undefined;
    if (!after || cursors.has(after)) break;
    cursors.add(after);
  }
  return items;
}

const cachedReserves = unstable_cache(
  async (): Promise<HomepageReserves> => {
    const [groups, ethPrice] = await Promise.all([
      getHomepageSuckerGroups(),
      getHomepageEthPrice(),
    ]);
    const supported = groups.flatMap((group) => {
      const project = group.projects?.items[0];
      if (!project?.isRevnet || project.decimals == null || !project.tokenSymbol) return [];
      return [
        {
          group,
          symbol: project.tokenSymbol.replace(/^\$+/, "").toUpperCase(),
          decimals: project.decimals,
        },
      ];
    });
    let eth = 0;
    let usdc = 0;
    const other = new Set<string>();
    for (const item of supported) {
      const value = Number(formatUnits(BigInt(item.group.balance), item.decimals));
      if (item.symbol === "ETH") eth += value;
      else if (item.symbol === "USDC") usdc += value;
      else other.add(item.symbol);
    }
    const histories = await Promise.all(
      supported.map(async (item) => ({
        ...item,
        moments: await momentsFor(item.group.id).catch(() => []),
      })),
    );
    const events = histories
      .flatMap((item) =>
        item.moments.map((moment) => ({
          groupId: item.group.id,
          symbol: item.symbol,
          timestamp: moment.timestamp,
          amount: Number(formatUnits(BigInt(moment.balance), item.decimals)),
        })),
      )
      .sort((a, b) => a.timestamp - b.timestamp);
    const latest = new Map<string, number>();
    const raw = events.map((event) => {
      latest.set(event.groupId, event.amount);
      const valueUsd = supported.reduce((sum, item) => {
        const amount = latest.get(item.group.id) ?? 0;
        return (
          sum +
          (item.symbol === "ETH" ? amount * (ethPrice ?? 0) : item.symbol === "USDC" ? amount : 0)
        );
      }, 0);
      return { timestamp: event.timestamp, valueUsd };
    });
    const stride = Math.max(1, Math.ceil(raw.length / 48));
    return {
      eth,
      usdc,
      totalUsd: eth * (ethPrice ?? 0) + usdc,
      otherAssets: other.size,
      points: raw.filter((_, index) => index % stride === 0 || index === raw.length - 1),
    };
  },
  ["revnet-homepage-reserves-v2"],
  { revalidate: 600 },
);

export async function getHomepageReserves(): Promise<HomepageReserves> {
  try {
    return await cachedReserves();
  } catch {
    return { eth: 0, usdc: 0, totalUsd: 0, otherAssets: 0, points: [] };
  }
}
