"use server";

import { getRulesets } from "@/app/[slug]/terms/getRulesets";
import { getCurrentCashOutTax } from "@/lib/cashOutTax";
import { minimumCashOutPriceAtIssuancePrice } from "@/lib/minimumCashOutPrice";
import { getStartTimeForRange, getTimeRangeConfig, TimeRange } from "@/lib/timeRange";
import { getTokenAddress } from "@/lib/token";
import { JBChainId, NATIVE_TOKEN } from "@bananapus/nana-sdk-core";
import { BASE_CURRENCY_ETH, BASE_CURRENCY_USD, tokenCurrencyId } from "@bananapus/nana-sdk-core/v6";
import {
  fetchPayEventRates,
  rateAt,
  toBaseAxis,
  type BaseRatePoint,
} from "@/lib/baseCurrencyRate";
import type { Address } from "viem";
import { calculateIssuancePriceHistory } from "./calculateIssuancePriceHistory";
import { getFloorPriceHistory } from "./getFloorPriceHistory";
import { getV4AmmPriceHistory } from "./getV4AmmPriceHistory";

export type PriceDataPoint = {
  timestamp: number;
  issuancePrice?: number;
  ammPrice?: number;
  floorPrice?: number;
  minimumCashOutPrice?: number;
  cashOutChangeReason?: string;
  // Floor price calculation inputs (for debugging)
  totalSupply?: string;
  totalBalance?: string;
  cashOutTaxRate?: number;
};

/**
 * Is the accounting token already the axis unit?
 *
 * The axis is the ruleset's `baseCurrency` (see lib/baseCurrencyRate.ts for the full
 * contract). When the accounting token IS that currency — a token-keyed base currency, or
 * ETH against a native terminal — the AMM and cash-out series are already on-axis and no
 * rate is needed. `JBPrices.pricePerUnitOf` returns exactly 1e18 for that case too.
 */
export function accountingIsAxisUnit(
  baseCurrency: number | undefined,
  accountingToken: string,
): boolean {
  if (baseCurrency === undefined) return false;
  if (baseCurrency === tokenCurrencyId(accountingToken as Address)) return true;
  return (
    baseCurrency === BASE_CURRENCY_ETH &&
    accountingToken.toLowerCase() === NATIVE_TOKEN.toLowerCase()
  );
}

/** Does this base currency price things in USD? Only then is the payEvent ratio the rate. */
export function baseIsUsd(baseCurrency: number | undefined): boolean {
  return baseCurrency === BASE_CURRENCY_USD;
}

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
  // Every stage shares the project's denomination; stage 0 decides the axis.
  const baseCurrency = rulesets[0]?.baseCurrency;
  // Issuance is 1/weight — ALREADY in base-currency units, and exact. It is the AMM and
  // cash-out series (accounting-token denominated) that move onto the axis.
  const issuanceData = calculateIssuancePriceHistory(rulesets, range);

  const projectTokenAddress = await getTokenAddress(chainId, Number(projectId));
  if (!projectTokenAddress || projectTokenAddress === NATIVE_TOKEN) {
    throw new Error("Could not get project token address");
  }

  // V6 buyback pools are Uniswap V4 pools identified by bytes32 pool IDs.
  const currentCashOutTax = await getCurrentCashOutTax(projectId, chainId);
  const [v4Result, floorResult] = await Promise.allSettled([
    getV4AmmPriceHistory({
      projectId,
      chainId,
      terminalToken: baseToken.address,
      terminalDecimals: baseToken.decimals,
    }),
    getFloorPriceHistory({
      suckerGroupId,
      chainId,
      baseTokenDecimals: baseToken.decimals,
      currentCashOutTax,
      projectStart,
    }),
  ]);
  const v4History = v4Result.status === "fulfilled" ? v4Result.value : null;
  const rawAmmData = v4History?.hasPool ? v4History.data : [];
  const rawFloorData = floorResult.status === "fulfilled" ? floorResult.value : [];

  // Move the accounting-denominated series onto the base-currency axis. A no-op (and no
  // network call) whenever the accounting token already IS the axis unit, which is the
  // common case. Otherwise every point needs the rate in force at ITS OWN timestamp;
  // converting history at today's rate would restate the past.
  const onAxis = accountingIsAxisUnit(baseCurrency, baseToken.address);
  let rates: BaseRatePoint[] = [];
  if (!onAxis && baseIsUsd(baseCurrency)) {
    rates = await fetchPayEventRates(chainId, Number(projectId), baseToken.decimals);
  }
  const convertible = onAxis || rates.length > 0;
  const rateFor = (timestamp: number) => (onAxis ? 1 : rateAt(rates, timestamp));

  const ammData = onAxis
    ? rawAmmData
    : rawAmmData
        .map((point) => ({
          ...point,
          ammPrice: toBaseAxis(point.ammPrice, rateFor(point.timestamp)),
        }))
        .filter((point) => point.ammPrice !== undefined);
  const floorData = onAxis
    ? rawFloorData
    : rawFloorData
        .map((point) => ({
          ...point,
          floorPrice: toBaseAxis(point.floorPrice, rateFor(point.timestamp)),
          minimumCashOutPrice: toBaseAxis(
            point.minimumCashOutPrice,
            rateFor(point.timestamp),
          ),
        }))
        .filter((point) => point.floorPrice !== undefined);

  const { interval } = getTimeRangeConfig(range);
  const data = mergeDataPoints(issuanceData, ammData, floorData, interval);

  return {
    chartData: range === "all" ? data : data.filter((d) => d.timestamp >= startTime),
    hasPool: !!v4History?.hasPool,
    /** The axis unit: the ruleset's base currency, which issuance is denominated in. */
    baseCurrency,
    /**
     * Market/cash-out lines were converted onto the axis from the accounting token using
     * indexed pay-event valuations, so they are approximate — say so in the UI.
     */
    convertedToBase: !onAxis && convertible,
    /** No rate was derivable, so the accounting-denominated lines are omitted entirely. */
    marketSeriesUnavailable: !onAxis && !convertible,
    unavailableSources: [
      ...(v4Result.status === "rejected" ? ["pool"] : []),
      ...(floorResult.status === "rejected" ? ["cash out"] : []),
    ],
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
      existing.minimumCashOutPrice = point.minimumCashOutPrice;
      existing.cashOutChangeReason = point.cashOutChangeReason;
      existing.totalSupply = point.totalSupply;
      existing.totalBalance = point.totalBalance;
      existing.cashOutTaxRate = point.cashOutTaxRate;
    } else {
      merged.set(dayTs, {
        timestamp: dayTs,
        floorPrice: point.floorPrice,
        minimumCashOutPrice: point.minimumCashOutPrice,
        cashOutChangeReason: point.cashOutChangeReason,
        totalSupply: point.totalSupply,
        totalBalance: point.totalBalance,
        cashOutTaxRate: point.cashOutTaxRate,
      });
    }
  }

  const sorted = Array.from(merged.values()).sort((a, b) => a.timestamp - b.timestamp);

  let lastAmmPrice: number | undefined;
  let lastIssuancePrice: number | undefined;
  let lastFloorPrice: number | undefined;
  let lastTotalSupply: string | undefined;
  let lastTotalBalance: string | undefined;
  let lastCashOutTaxRate: number | undefined;

  for (const point of sorted) {
    if (point.issuancePrice !== undefined) {
      lastIssuancePrice = point.issuancePrice;
    } else if (lastIssuancePrice !== undefined) {
      point.issuancePrice = lastIssuancePrice;
    }

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

    if (point.issuancePrice !== undefined && point.cashOutTaxRate !== undefined) {
      point.minimumCashOutPrice = minimumCashOutPriceAtIssuancePrice(
        point.issuancePrice,
        point.cashOutTaxRate,
      );
    }
  }

  return sorted;
}

function normalizeToInterval(timestamp: number, interval: number): number {
  return Math.floor(timestamp / interval) * interval;
}
