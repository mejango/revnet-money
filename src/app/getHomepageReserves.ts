import "server-only";

import { usdFromScaled } from "@/app/[slug]/components/v6/extras/projectPayers";
import { usdRateOf } from "@/lib/baseCurrencyRate";
import {
  AddToBalanceInflowsOperation,
  SuckerGroupMomentsOperation,
} from "@/lib/bendystraw/operations";
import { queryBendystraw } from "@/lib/bendystraw/query.server";
import { fetchProjectTokenBalanceMoments } from "@/lib/bendystraw/tokenBalanceMoments.server";
import type {
  AddToBalanceInflow,
  ProjectTokenBalanceMoment,
  SuckerGroupMoment,
} from "@/lib/bendystraw/types";
import { mainnet } from "@/lib/chains";
import { tokenSymbolOf } from "@/lib/project-link-preview";
import { unstable_cache } from "next/cache";
import { formatUnits } from "viem";
import { getHomepageSuckerGroups } from "./getTopProjects";

type ReservePoint = {
  timestamp: number;
  valueUsd: number;
  chains: Array<{ chainId: number; valueUsd: number }>;
};
export type HomepageReserves = {
  /** Every revnet's holdings, each token at its latest indexed USD rate. */
  totalUsd: number;
  chains: Array<{
    chainId: number;
    eth: number;
    usdc: number;
    otherAssets: string[];
  }>;
  points: ReservePoint[];
  /** All-time payment and add-to-balance volume across revnets, in USD at the time. */
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

/** An 18-decimal indexer figure as a plain number; a missing figure counts as nothing. */
function usd(value: SuckerGroupMoment["balanceUsd"] | undefined): number {
  return usdFromScaled(value) ?? 0;
}

/**
 * REV's cumulative inflows: the sum of its balance increases, each token valued at its
 * latest indexed rate so a price move is never counted as a fee. REV's own cash outs don't
 * subtract.
 */
function feePointsFrom(
  histories: { key: string; rate: number; moments: ProjectTokenBalanceMoment[] }[],
): ReservePoint[] {
  const events = histories
    .flatMap((history) =>
      history.moments.map((moment) => ({
        key: history.key,
        timestamp: moment.timestamp,
        valueUsd: Number(formatUnits(BigInt(moment.balance), moment.decimals)) * history.rate,
      })),
    )
    .sort((a, b) => a.timestamp - b.timestamp);
  let totalUsd = 0;
  const latest = new Map<string, number>();
  return events.map((event) => {
    const delta = event.valueUsd - (latest.get(event.key) ?? 0);
    latest.set(event.key, event.valueUsd);
    if (delta > 0) totalUsd += delta;
    return { timestamp: event.timestamp, valueUsd: totalUsd, chains: [] };
  });
}

const cachedReserves = unstable_cache(
  async (): Promise<HomepageReserves> => {
    const [groups, inflows] = await Promise.all([
      getHomepageSuckerGroups(),
      addToBalanceInflows().catch(() => [] as AddToBalanceInflow[]),
    ]);
    const supported = groups.filter((group) => group.projects?.items[0]?.isRevnet);
    const supportedIds = new Set(supported.map((group) => group.id));
    const addedByGroup = new Map<string, number>();
    for (const inflow of inflows) {
      if (!supportedIds.has(inflow.suckerGroupId)) continue;
      addedByGroup.set(
        inflow.suckerGroupId,
        (addedByGroup.get(inflow.suckerGroupId) ?? 0) + usd(inflow.amountUsd),
      );
    }
    let totalUsd = 0;
    let passedThroughUsd = 0;
    const perChain = new Map<number, { eth: number; usdc: number; otherAssets: Set<string> }>(
      RESERVE_CHAIN_IDS.map(
        (chainId) => [chainId, { eth: 0, usdc: 0, otherAssets: new Set<string>() }] as const,
      ),
    );
    for (const group of supported) {
      totalUsd += usd(group.balanceUsd);
      passedThroughUsd += usd(group.volumeUsd) + (addedByGroup.get(group.id) ?? 0);
      for (const project of group.projects?.items ?? []) {
        const chain = perChain.get(project.chainId);
        if (!chain) continue;
        for (const row of project.projectTokenBalances?.items ?? []) {
          const amount = Number(formatUnits(BigInt(row.balance), row.decimals));
          if (!(amount > 0)) continue;
          const symbol = (tokenSymbolOf(row) ?? "?").replace(/^\$+/, "").toUpperCase();
          if (symbol === "ETH") chain.eth += amount;
          else if (symbol === "USDC") chain.usdc += amount;
          else chain.otherAssets.add(symbol);
        }
      }
    }
    const histories = await Promise.all(
      supported.map(async (group) => ({
        groupId: group.id,
        moments: await momentsFor(group.id).catch(() => []),
      })),
    );
    const events = histories
      .flatMap((history) =>
        history.moments.map((moment) => ({
          groupId: history.groupId,
          timestamp: moment.timestamp,
          valueUsd: usd(moment.balanceUsd),
          volumeUsd: usd(moment.volumeUsd),
        })),
      )
      .sort((a, b) => a.timestamp - b.timestamp);

    const projectHistories = await Promise.all(
      supported.flatMap((group) =>
        (group.projects?.items ?? []).map(async (project) => ({
          groupId: group.id,
          chainId: project.chainId,
          version: project.version,
          projectId: project.projectId,
          rows: project.projectTokenBalances?.items ?? [],
          moments: await fetchProjectTokenBalanceMoments(mainnet.id, project).catch(() => null),
        })),
      ),
    );
    // One history per (deployment, token), each token valued in its own decimals.
    const tokenHistories = projectHistories.flatMap((project) => {
      const projectMoments = project.moments ?? [];
      const tokens = new Set([
        ...project.rows.map((row) => row.token.toLowerCase()),
        ...projectMoments.map((moment) => moment.token.toLowerCase()),
      ]);
      return [...tokens].map((token) => {
        const row = project.rows.find((item) => item.token.toLowerCase() === token);
        const moments = projectMoments.filter((moment) => moment.token.toLowerCase() === token);
        return {
          groupId: project.groupId,
          chainId: project.chainId,
          key: `${project.chainId}:${project.version}:${project.projectId}:${token}`,
          moments,
          currentUsd: row ? usd(row.balanceUsd) : null,
          rate:
            usdRateOf(row?.usdRate) ??
            moments.map((moment) => usdRateOf(moment.tokenUsdRate)).findLast((rate) => rate) ??
            0,
        };
      });
    });
    const revGroupIds = new Set(
      groups
        .filter((group) => group.projects?.items.some((project) => project.projectId === 3))
        .map((group) => group.id),
    );
    const rawFeePoints = feePointsFrom(
      tokenHistories.filter((history) => revGroupIds.has(history.groupId)),
    );
    const latestAggregateTimestamp = events.at(-1)?.timestamp;
    const projectEvents = tokenHistories
      .flatMap((history) => {
        // An unpriced moment carries the token's last known rate, else its latest one.
        let rate = history.rate;
        const points = history.moments.map((moment) => {
          rate = usdRateOf(moment.tokenUsdRate) ?? rate;
          return {
            key: history.key,
            chainId: history.chainId,
            timestamp: moment.timestamp,
            valueUsd: Number(formatUnits(BigInt(moment.balance), moment.decimals)) * rate,
          };
        });
        // A token without a current row keeps its last moment instead of reading as zero.
        return latestAggregateTimestamp == null || history.currentUsd === null
          ? points
          : [
              ...points,
              {
                key: history.key,
                chainId: history.chainId,
                timestamp: latestAggregateTimestamp,
                valueUsd: history.currentUsd,
              },
            ];
      })
      .sort((a, b) => a.timestamp - b.timestamp);

    // A token with no moments only ever gets its synthetic current-balance point, so its
    // history would silently read as zero. Only break out per-chain values when every token
    // either reported moments or holds nothing. An unpriced token counts as nothing, as it does
    // in the indexer's USD balance.
    const chainHistoryIsComplete =
      projectHistories.every((project) => project.moments !== null) &&
      tokenHistories.every((history) => history.moments.length > 0 || !history.currentUsd);
    const latest = new Map<string, number>();
    const latestVolume = new Map<string, number>();
    const latestProjects = new Map<string, { chainId: number; valueUsd: number }>();
    let projectEventIndex = 0;
    // The same inflows, replayed in order, so the curve reaches the headline.
    const inflowEvents = inflows
      .filter((inflow) => supportedIds.has(inflow.suckerGroupId))
      .map((inflow) => ({
        groupId: inflow.suckerGroupId,
        timestamp: inflow.timestamp,
        amount: usd(inflow.amountUsd),
      }))
      .sort((a, b) => a.timestamp - b.timestamp);
    const addedSoFar = new Map<string, number>();
    let inflowIndex = 0;
    const raw: ReservePoint[] = [];
    const rawVolumePoints: ReservePoint[] = [];
    for (const event of events) {
      latest.set(event.groupId, event.valueUsd);
      latestVolume.set(event.groupId, event.volumeUsd);
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
        latestProjects.set(projectEvent.key, projectEvent);
        projectEventIndex += 1;
      }
      let valueUsd = 0;
      let volumeUsd = 0;
      for (const group of supported) {
        valueUsd += latest.get(group.id) ?? 0;
        volumeUsd += (latestVolume.get(group.id) ?? 0) + (addedSoFar.get(group.id) ?? 0);
      }
      const chains = chainHistoryIsComplete
        ? RESERVE_CHAIN_IDS.map((chainId) => ({
            chainId,
            valueUsd: [...latestProjects.values()].reduce(
              (sum, project) => (project.chainId === chainId ? sum + project.valueUsd : sum),
              0,
            ),
          }))
        : [];
      raw.push({ timestamp: event.timestamp, valueUsd, chains });
      rawVolumePoints.push({ timestamp: event.timestamp, valueUsd: volumeUsd, chains: [] });
    }
    return {
      totalUsd,
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
  ["revnet-homepage-reserves-v7"],
  { revalidate: 600 },
);

export async function getHomepageReserves(): Promise<HomepageReserves> {
  try {
    return await cachedReserves();
  } catch {
    return {
      totalUsd: 0,
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
