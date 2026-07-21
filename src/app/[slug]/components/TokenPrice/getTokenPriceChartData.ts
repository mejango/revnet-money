"use server";

import { getRulesets } from "@/app/[slug]/terms/getRulesets";
import { getCurrentCashOutTax } from "@/lib/cashOutTax";
import { getStartTimeForRange, getTimeRangeConfig, TimeRange } from "@/lib/timeRange";
import { getTokenAddress } from "@/lib/token";
import { JBChainId, NATIVE_TOKEN } from "@bananapus/nana-sdk-core";
import { calculateIssuancePriceHistory } from "./calculateIssuancePriceHistory";
import { getFloorPriceHistory } from "./getFloorPriceHistory";
import { getV4AmmPriceHistory } from "./getV4AmmPriceHistory";

export type PriceDataPoint = {
  timestamp: number;
  issuancePrice?: number;
  ammPrice?: number;
  floorPrice?: number;
  // Floor price calculation inputs (for debugging)
  totalSupply?: string;
  totalBalance?: string;
  cashOutTaxRate?: number;
};

export async function getTokenPriceChartData(params: {
  projectId: string;
  chainId: JBChainId;
  range: TimeRange;
  suckerGroupId: string;
  baseToken: { address: string; symbol: string; decimals: number };
}) {
  const { projectId, chainId, baseToken, suckerGroupId, range } = params;
  const startTime = getStartTimeForRange(range);

  const rulesets = await getRulesets(projectId, chainId);
  const projectStart = rulesets.length > 0 ? rulesets[0].start : 0;
  const issuanceData = calculateIssuancePriceHistory(rulesets, range);

  const projectTokenAddress = await getTokenAddress(chainId, Number(projectId));
  if (!projectTokenAddress || projectTokenAddress === NATIVE_TOKEN) {
    throw new Error("Could not get project token address");
  }

  // V6 buyback pools are Uniswap V4 pools identified by bytes32 pool IDs.
  const v4History = await getV4AmmPriceHistory({
    projectId,
    chainId,
    terminalToken: baseToken.address,
    terminalDecimals: baseToken.decimals,
  }).catch(() => null);

  const ammData = v4History?.hasPool ? v4History.data : [];

  const currentCashOutTax = await getCurrentCashOutTax(projectId, chainId);

  const floorData = await getFloorPriceHistory({
    suckerGroupId,
    chainId,
    baseTokenDecimals: baseToken.decimals,
    currentCashOutTax,
    projectStart,
  });

  const { interval } = getTimeRangeConfig(range);
  const data = mergeDataPoints(issuanceData, ammData, floorData, interval);

  return {
    chartData: range === "all" ? data : data.filter((d) => d.timestamp >= startTime),
    hasPool: !!v4History?.hasPool,
    stages: rulesets.map((ruleset, index) => ({
      name: `Stage ${index + 1}`,
      timestamp: normalizeToInterval(ruleset.start, interval),
    })),
    todayTimestamp: normalizeToInterval(Math.floor(Date.now() / 1000), interval),
  };
}

function mergeDataPoints(
  issuanceData: PriceDataPoint[],
  ammData: PriceDataPoint[],
  floorData: PriceDataPoint[],
  interval: number,
): PriceDataPoint[] {
  const merged = new Map<number, PriceDataPoint>();

  for (const point of issuanceData) {
    const dayTs = normalizeToInterval(point.timestamp, interval);
    const existing = merged.get(dayTs);
    if (existing) {
      existing.issuancePrice = point.issuancePrice;
    } else {
      merged.set(dayTs, { timestamp: dayTs, issuancePrice: point.issuancePrice });
    }
  }

  for (const point of ammData) {
    const dayTs = normalizeToInterval(point.timestamp, interval);
    const existing = merged.get(dayTs);
    if (existing) {
      existing.ammPrice = point.ammPrice;
    } else {
      merged.set(dayTs, { timestamp: dayTs, ammPrice: point.ammPrice });
    }
  }

  for (const point of floorData) {
    const dayTs = normalizeToInterval(point.timestamp, interval);
    const existing = merged.get(dayTs);
    if (existing) {
      existing.floorPrice = point.floorPrice;
      existing.totalSupply = point.totalSupply;
      existing.totalBalance = point.totalBalance;
      existing.cashOutTaxRate = point.cashOutTaxRate;
    } else {
      merged.set(dayTs, {
        timestamp: dayTs,
        floorPrice: point.floorPrice,
        totalSupply: point.totalSupply,
        totalBalance: point.totalBalance,
        cashOutTaxRate: point.cashOutTaxRate,
      });
    }
  }

  const sorted = Array.from(merged.values()).sort((a, b) => a.timestamp - b.timestamp);

  let lastAmmPrice: number | undefined;
  let lastFloorPrice: number | undefined;
  let lastTotalSupply: string | undefined;
  let lastTotalBalance: string | undefined;
  let lastCashOutTaxRate: number | undefined;

  for (const point of sorted) {
    if (point.ammPrice !== undefined) {
      lastAmmPrice = point.ammPrice;
    } else if (lastAmmPrice !== undefined) {
      point.ammPrice = lastAmmPrice;
    }

    if (point.floorPrice !== undefined) {
      lastFloorPrice = point.floorPrice;
      lastTotalSupply = point.totalSupply;
      lastTotalBalance = point.totalBalance;
      lastCashOutTaxRate = point.cashOutTaxRate;
    } else if (lastFloorPrice !== undefined) {
      point.floorPrice = lastFloorPrice;
      point.totalSupply = lastTotalSupply;
      point.totalBalance = lastTotalBalance;
      point.cashOutTaxRate = lastCashOutTaxRate;
    }
  }

  return sorted;
}

function normalizeToInterval(timestamp: number, interval: number): number {
  return Math.floor(timestamp / interval) * interval;
}
