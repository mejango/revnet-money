import "server-only";

import {
  ProjectMomentsOperation,
  SuckerGroupMomentsOperation,
} from "@/lib/bendystraw/operations";
import { queryBendystraw } from "@/lib/bendystraw/query.server";
import type { ProjectMoment, SuckerGroupMoment } from "@/lib/bendystraw/types";
import { mainnet } from "@/lib/chains";
import { unstable_cache } from "next/cache";
import { formatUnits } from "viem";
import { getHomepageEthPrice, getHomepageSuckerGroups } from "./getTopProjects";

export type HomepageReserves = {
  eth: number;
  usdc: number;
  totalUsd: number;
  otherAssets: number;
  chains: Array<{
    chainId: number;
    eth: number;
    usdc: number;
    otherAssets: string[];
  }>;
  points: Array<{
    timestamp: number;
    valueUsd: number;
    chains: Array<{ chainId: number; valueUsd: number }>;
  }>;
};

const RESERVE_CHAIN_IDS = [1, 42161, 8453, 10] as const;

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

async function projectMomentsFor({
  projectId,
  chainId,
  version,
}: {
  projectId: number;
  chainId: number;
  version: number;
}): Promise<ProjectMoment[]> {
  const items: ProjectMoment[] = [];
  let after: string | undefined;
  const cursors = new Set<string>();
  for (;;) {
    const result = await queryBendystraw(mainnet.id, ProjectMomentsOperation, {
      projectId,
      chainId,
      version,
      after,
    });
    items.push(...result.projectMoments.items);
    const page = result.projectMoments.pageInfo;
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
    const perChain = new Map<number, { eth: number; usdc: number; otherAssets: Set<string> }>(
      RESERVE_CHAIN_IDS.map(
        (chainId) => [chainId, { eth: 0, usdc: 0, otherAssets: new Set<string>() }] as const,
      ),
    );
    for (const item of supported) {
      const value = Number(formatUnits(BigInt(item.group.balance), item.decimals));
      if (item.symbol === "ETH") eth += value;
      else if (item.symbol === "USDC") usdc += value;
      else other.add(item.symbol);

      for (const project of item.group.projects?.items ?? []) {
        const chain = perChain.get(project.chainId);
        if (!chain) continue;
        const chainValue = Number(formatUnits(BigInt(project.balance), item.decimals));
        if (item.symbol === "ETH") chain.eth += chainValue;
        else if (item.symbol === "USDC") chain.usdc += chainValue;
        else chain.otherAssets.add(item.symbol);
      }
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

    const historicalProjects = supported.flatMap((item) =>
      (item.group.projects?.items ?? []).map((project) => ({
        key: `${project.chainId}:${project.version}:${project.projectId}:${item.symbol}`,
        chainId: project.chainId,
        projectId: project.projectId,
        version: project.version,
        symbol: item.symbol,
        decimals: item.decimals,
        currentAmount: Number(formatUnits(BigInt(project.balance), item.decimals)),
      })),
    );
    const projectHistories = await Promise.all(
      historicalProjects.map(async (project) => ({
        ...project,
        moments: await projectMomentsFor(project).catch(() => []),
      })),
    );
    const latestAggregateTimestamp = events.at(-1)?.timestamp;
    const projectEvents = projectHistories
      .flatMap((project) =>
        [
          ...project.moments.map((moment) => ({
            key: project.key,
            chainId: project.chainId,
            symbol: project.symbol,
            timestamp: moment.timestamp,
            amount: Number(formatUnits(BigInt(moment.balance), project.decimals)),
          })),
          ...(latestAggregateTimestamp == null
            ? []
            : [
                {
                  key: project.key,
                  chainId: project.chainId,
                  symbol: project.symbol,
                  timestamp: latestAggregateTimestamp,
                  amount: project.currentAmount,
                },
              ]),
        ],
      )
      .sort((a, b) => a.timestamp - b.timestamp);

    const latest = new Map<string, number>();
    const latestProjects = new Map<
      string,
      { chainId: number; symbol: string; amount: number }
    >();
    let projectEventIndex = 0;
    const raw = events.map((event) => {
      latest.set(event.groupId, event.amount);
      while (
        projectEventIndex < projectEvents.length &&
        projectEvents[projectEventIndex].timestamp <= event.timestamp
      ) {
        const projectEvent = projectEvents[projectEventIndex];
        latestProjects.set(projectEvent.key, {
          chainId: projectEvent.chainId,
          symbol: projectEvent.symbol,
          amount: projectEvent.amount,
        });
        projectEventIndex += 1;
      }
      const valueUsd = supported.reduce((sum, item) => {
        const amount = latest.get(item.group.id) ?? 0;
        return (
          sum +
          (item.symbol === "ETH" ? amount * (ethPrice ?? 0) : item.symbol === "USDC" ? amount : 0)
        );
      }, 0);
      const chains =
        latestProjects.size === historicalProjects.length
          ? RESERVE_CHAIN_IDS.map((chainId) => ({
              chainId,
              valueUsd: [...latestProjects.values()].reduce((sum, project) => {
                if (project.chainId !== chainId) return sum;
                if (project.symbol === "ETH") return sum + project.amount * (ethPrice ?? 0);
                if (project.symbol === "USDC") return sum + project.amount;
                return sum;
              }, 0),
            }))
          : [];
      return { timestamp: event.timestamp, valueUsd, chains };
    });
    const stride = Math.max(1, Math.ceil(raw.length / 48));
    return {
      eth,
      usdc,
      totalUsd: eth * (ethPrice ?? 0) + usdc,
      otherAssets: other.size,
      chains: RESERVE_CHAIN_IDS.map((chainId) => {
        const chain = perChain.get(chainId)!;
        return {
          chainId,
          eth: chain.eth,
          usdc: chain.usdc,
          otherAssets: [...chain.otherAssets].sort(),
        };
      }),
      points: raw.filter((_, index) => index % stride === 0 || index === raw.length - 1),
    };
  },
  ["revnet-homepage-reserves-v4"],
  { revalidate: 600 },
);

export async function getHomepageReserves(): Promise<HomepageReserves> {
  try {
    return await cachedReserves();
  } catch {
    return {
      eth: 0,
      usdc: 0,
      totalUsd: 0,
      otherAssets: 0,
      chains: RESERVE_CHAIN_IDS.map((chainId) => ({
        chainId,
        eth: 0,
        usdc: 0,
        otherAssets: [],
      })),
      points: [],
    };
  }
}
