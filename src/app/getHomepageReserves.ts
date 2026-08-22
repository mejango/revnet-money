import "server-only";

import {
  AddToBalanceInflowsOperation,
  ProjectMomentsOperation,
  SuckerGroupMomentsOperation,
} from "@/lib/bendystraw/operations";
import { queryBendystraw } from "@/lib/bendystraw/query.server";
import type { AddToBalanceInflow, ProjectMoment, SuckerGroupMoment } from "@/lib/bendystraw/types";
import { mainnet } from "@/lib/chains";
import { unstable_cache } from "next/cache";
import { formatUnits } from "viem";
import { getHomepageEthPrice, getHomepageSuckerGroups } from "./getTopProjects";

export type ReservePoint = {
  timestamp: number;
  valueUsd: number;
  chains: Array<{ chainId: number; valueUsd: number }>;
};
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
  points: ReservePoint[];
  /** All-time payment volume across revnets, valued at the current ETH price. */
  passedThroughUsd: number;
  volumePoints: ReservePoint[];
  /** REV's cumulative inflows — the fees it collects from revnet cash outs and
   *  loans. Measured as the sum of REV's balance increases, so REV's own cash
   *  outs don't subtract. */
  feesUsd: number;
  feePoints: ReservePoint[];
};

const RESERVE_CHAIN_IDS = [1, 42161, 8453, 10] as const;

function downsample(points: ReservePoint[]): ReservePoint[] {
  const stride = Math.max(1, Math.ceil(points.length / 48));
  return points.filter((_, index) => index % stride === 0 || index === points.length - 1);
}

/**
 * Every `addToBalance` across V6, oldest first.
 *
 * A group's indexed `volume` counts payments only, so funds added straight to a
 * terminal — grants, returned payouts, repaid loans — never appear in it even
 * though they are money that passed through. Without them a revnet can report
 * holding more than it ever received.
 */
async function addToBalanceInflows(): Promise<AddToBalanceInflow[]> {
  const items: AddToBalanceInflow[] = [];
  let after: string | undefined;
  const cursors = new Set<string>();
  for (;;) {
    const result = await queryBendystraw(mainnet.id, AddToBalanceInflowsOperation, { after });
    items.push(...result.addToBalanceEvents.items);
    const page = result.addToBalanceEvents.pageInfo;
    after = page.hasNextPage ? (page.endCursor ?? undefined) : undefined;
    if (!after || cursors.has(after)) break;
    cursors.add(after);
  }
  return items;
}

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

// REV only has a native-token accounting context, so balances are ETH.
function feePointsFrom(
  histories: {
    group: { id: string };
    decimals: number;
    moments: { timestamp: number; balance: SuckerGroupMoment["balance"] }[];
  }[],
  feeGroupIds: Set<string>,
  ethPrice: number | null,
): ReservePoint[] {
  const events = histories
    .filter((history) => feeGroupIds.has(history.group.id))
    .flatMap((history) =>
      history.moments.map((moment) => ({
        groupId: history.group.id,
        timestamp: moment.timestamp,
        balance: Number(formatUnits(BigInt(moment.balance), history.decimals)),
      })),
    )
    .sort((a, b) => a.timestamp - b.timestamp);
  let totalEth = 0;
  const lastBalance = new Map<string, number>();
  return events.map((event) => {
    const delta = event.balance - (lastBalance.get(event.groupId) ?? 0);
    lastBalance.set(event.groupId, event.balance);
    if (delta > 0) totalEth += delta;
    return { timestamp: event.timestamp, valueUsd: totalEth * (ethPrice ?? 0), chains: [] };
  });
}

const cachedReserves = unstable_cache(
  async (): Promise<HomepageReserves> => {
    const [groups, ethPrice, inflows] = await Promise.all([
      getHomepageSuckerGroups(),
      getHomepageEthPrice(),
      addToBalanceInflows().catch(() => [] as AddToBalanceInflow[]),
    ]);
    const addedByGroup = new Map<string, bigint>();
    for (const inflow of inflows) {
      addedByGroup.set(
        inflow.suckerGroupId,
        (addedByGroup.get(inflow.suckerGroupId) ?? 0n) + BigInt(inflow.amount),
      );
    }
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
    let passedThroughUsd = 0;
    const other = new Set<string>();
    const perChain = new Map<number, { eth: number; usdc: number; otherAssets: Set<string> }>(
      RESERVE_CHAIN_IDS.map(
        (chainId) => [chainId, { eth: 0, usdc: 0, otherAssets: new Set<string>() }] as const,
      ),
    );
    for (const item of supported) {
      const value = Number(formatUnits(BigInt(item.group.balance), item.decimals));
      const volume = Number(
        formatUnits(
          BigInt(item.group.volume) + (addedByGroup.get(item.group.id) ?? 0n),
          item.decimals,
        ),
      );
      if (item.symbol === "ETH") {
        eth += value;
        passedThroughUsd += volume * (ethPrice ?? 0);
      } else if (item.symbol === "USDC") {
        usdc += value;
        passedThroughUsd += volume;
      } else other.add(item.symbol);

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
          volume: Number(formatUnits(BigInt(moment.volume), item.decimals)),
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
    const revGroupIds = new Set(
      groups
        .filter((group) => group.projects?.items.some((project) => project.projectId === 3))
        .map((group) => group.id),
    );
    const rawFeePoints = feePointsFrom(histories, revGroupIds, ethPrice);
    const latestAggregateTimestamp = events.at(-1)?.timestamp;
    const projectEvents = projectHistories
      .flatMap((project) => [
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
      ])
      .sort((a, b) => a.timestamp - b.timestamp);

    const latest = new Map<string, number>();
    const latestVolume = new Map<string, number>();
    const latestProjects = new Map<string, { chainId: number; symbol: string; amount: number }>();
    let projectEventIndex = 0;
    // The same inflows, replayed in order, so the curve reaches the headline.
    const decimalsByGroup = new Map(supported.map((item) => [item.group.id, item.decimals]));
    const inflowEvents = inflows
      .filter((inflow) => decimalsByGroup.has(inflow.suckerGroupId))
      .map((inflow) => ({
        groupId: inflow.suckerGroupId,
        timestamp: inflow.timestamp,
        amount: Number(
          formatUnits(BigInt(inflow.amount), decimalsByGroup.get(inflow.suckerGroupId)!),
        ),
      }))
      .sort((a, b) => a.timestamp - b.timestamp);
    const addedSoFar = new Map<string, number>();
    let inflowIndex = 0;
    const raw: ReservePoint[] = [];
    const rawVolumePoints: ReservePoint[] = [];
    for (const event of events) {
      latest.set(event.groupId, event.amount);
      latestVolume.set(event.groupId, event.volume);
      while (
        inflowIndex < inflowEvents.length &&
        inflowEvents[inflowIndex].timestamp <= event.timestamp
      ) {
        const inflow = inflowEvents[inflowIndex];
        addedSoFar.set(inflow.groupId, (addedSoFar.get(inflow.groupId) ?? 0) + inflow.amount);
        inflowIndex += 1;
      }
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
      let valueUsd = 0;
      let volumeUsd = 0;
      for (const item of supported) {
        const amount = latest.get(item.group.id) ?? 0;
        const volume =
          (latestVolume.get(item.group.id) ?? 0) + (addedSoFar.get(item.group.id) ?? 0);
        if (item.symbol === "ETH") {
          valueUsd += amount * (ethPrice ?? 0);
          volumeUsd += volume * (ethPrice ?? 0);
        } else if (item.symbol === "USDC") {
          valueUsd += amount;
          volumeUsd += volume;
        }
      }
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
      raw.push({ timestamp: event.timestamp, valueUsd, chains });
      rawVolumePoints.push({ timestamp: event.timestamp, valueUsd: volumeUsd, chains: [] });
    }
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
      points: downsample(raw),
      passedThroughUsd,
      volumePoints: downsample(rawVolumePoints),
      feesUsd: rawFeePoints.at(-1)?.valueUsd ?? 0,
      feePoints: downsample(rawFeePoints),
    };
  },
  ["revnet-homepage-reserves-v6"],
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
      passedThroughUsd: 0,
      volumePoints: [],
      feesUsd: 0,
      feePoints: [],
    };
  }
}
