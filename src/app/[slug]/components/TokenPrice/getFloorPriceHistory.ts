import {
  CashOutTaxSnapshotsOperation,
  SuckerGroupMomentsOperation,
} from "@/lib/bendystraw/operations";
import { queryBendystraw } from "@/lib/bendystraw/query.server";
import type { CashOutTaxSnapshot, SuckerGroupMoment } from "@/lib/bendystraw/types";
import { JB_TOKEN_DECIMALS } from "@bananapus/nana-sdk-core";
import { formatUnits, parseUnits } from "viem";
import type { PriceDataPoint } from "./getTokenPriceChartData";
import { explainCashOutChange } from "./explainCashOutChange";

type FloorPriceOptions = {
  suckerGroupId: string;
  chainId: number;
  baseTokenDecimals: number;
  currentCashOutTax?: number;
  projectStart: number;
};

const MAX_HISTORY_PAGES = 20;

async function fetchAllTaxSnapshots(
  chainId: number,
  suckerGroupId: string,
): Promise<CashOutTaxSnapshot[]> {
  const allItems: CashOutTaxSnapshot[] = [];
  let cursor: string | undefined;
  const seenCursors = new Set<string>();

  for (let page = 0; page < MAX_HISTORY_PAGES; page += 1) {
    const result = await queryBendystraw(chainId, CashOutTaxSnapshotsOperation, {
      suckerGroupId,
      after: cursor,
    });

    allItems.push(...(result.cashOutTaxSnapshots?.items ?? []));

    const pageInfo = result.cashOutTaxSnapshots?.pageInfo;
    cursor = pageInfo?.hasNextPage ? (pageInfo.endCursor ?? undefined) : undefined;
    if (!cursor || seenCursors.has(cursor)) break;
    seenCursors.add(cursor);
  }

  return allItems;
}

async function fetchAllMoments(
  chainId: number,
  suckerGroupId: string,
): Promise<SuckerGroupMoment[]> {
  const allItems: SuckerGroupMoment[] = [];
  let cursor: string | undefined;
  const seenCursors = new Set<string>();

  for (let page = 0; page < MAX_HISTORY_PAGES; page += 1) {
    const result = await queryBendystraw(chainId, SuckerGroupMomentsOperation, {
      suckerGroupId,
      after: cursor,
    });

    allItems.push(...(result.suckerGroupMoments?.items ?? []));

    const pageInfo = result.suckerGroupMoments?.pageInfo;
    cursor = pageInfo?.hasNextPage ? (pageInfo.endCursor ?? undefined) : undefined;
    if (!cursor || seenCursors.has(cursor)) break;
    seenCursors.add(cursor);
  }

  return allItems;
}

export async function getFloorPriceHistory(options: FloorPriceOptions): Promise<PriceDataPoint[]> {
  const { suckerGroupId, chainId, baseTokenDecimals, currentCashOutTax, projectStart } = options;

  try {
    const [taxSnapshots, moments] = await Promise.all([
      fetchAllTaxSnapshots(chainId, suckerGroupId),
      fetchAllMoments(chainId, suckerGroupId),
    ]);

    const dataPoints: PriceDataPoint[] = [];
    const orderedMoments = [...moments].sort((a, b) => a.timestamp - b.timestamp);

    const firstMomentTimestamp =
      orderedMoments.length > 0 ? orderedMoments[0].timestamp : undefined;
    if (projectStart && (!firstMomentTimestamp || firstMomentTimestamp > projectStart)) {
      dataPoints.push({ timestamp: projectStart, floorPrice: 0 });
    }

    if (orderedMoments.length === 0) {
      return dataPoints;
    }

    let previous:
      | {
          balance: bigint;
          tokenSupply: bigint;
          cashOutTax: number;
          price: number;
        }
      | undefined;
    for (const moment of orderedMoments) {
      const cashOutTax = findApplicableTaxRate(moment.timestamp, taxSnapshots, currentCashOutTax);

      if (cashOutTax === undefined) continue;

      const balance = BigInt(moment.balance);
      const tokenSupply = BigInt(moment.tokenSupply);
      const floorPrice = calculateFloorPrice(
        balance,
        tokenSupply,
        cashOutTax,
        baseTokenDecimals,
      );
      const minimumCashOutPrice = calculateMinimumCashOutPrice(
        balance,
        tokenSupply,
        cashOutTax,
        baseTokenDecimals,
      );
      const current = {
        balance,
        tokenSupply,
        cashOutTax,
        price: floorPrice,
      };

      dataPoints.push({
        timestamp: moment.timestamp,
        floorPrice,
        minimumCashOutPrice,
        cashOutChangeReason: explainCashOutChange(previous, current),
        totalSupply: String(moment.tokenSupply),
        totalBalance: String(moment.balance),
        cashOutTaxRate: cashOutTax,
      });
      previous = current;
    }

    return dataPoints;
  } catch {
    return [];
  }
}

/**
 * Formula: y = (o * x / s) * ((1 - r) + (r * x / s))
 *
 * Where:
 * - r = cash out tax rate (0 to 1)
 * - o = surplus (balance in base token smallest unit)
 * - s = total token supply
 * - x = amount of tokens to cash out
 * - y = base token returned
 */
function calculateFloorPrice(
  balance: bigint,
  tokenSupply: bigint,
  cashOutTax: number,
  baseTokenDecimals: number,
  tokenAmount = parseUnits("1", JB_TOKEN_DECIMALS),
): number {
  if (tokenSupply === 0n || balance === 0n) return 0;

  const r = cashOutTax / 10000;
  const o = Number(balance);
  const s = Number(tokenSupply);
  const x = Number(tokenAmount);

  const y = ((o * x) / s) * (1 - r + (r * x) / s);

  return y / 10 ** baseTokenDecimals;
}

/**
 * The asymptotic minimum per-token cash-out price:
 * (1 - tax) × balance ÷ supply.
 *
 * A one-token cash-out quote sits slightly above this line because its
 * quadratic term includes that token's share of supply. As supply grows, the
 * live quote approaches this minimum. Payments can raise it; payouts can
 * lower it.
 */
export function calculateMinimumCashOutPrice(
  balance: bigint,
  tokenSupply: bigint,
  cashOutTax: number,
  baseTokenDecimals: number,
): number {
  if (tokenSupply === 0n || balance === 0n) return 0;

  const tax = BigInt(Math.max(0, Math.min(10_000, cashOutTax)));
  const oneToken = parseUnits("1", JB_TOKEN_DECIMALS);
  const rawPrice =
    (balance * oneToken * (10_000n - tax)) /
    (tokenSupply * 10_000n);

  return Number(formatUnits(rawPrice, baseTokenDecimals));
}

function findApplicableTaxRate(
  timestamp: number,
  snapshots: CashOutTaxSnapshot[],
  fallback?: number,
): number | undefined {
  let applicableTax: number | undefined = fallback;

  for (const snapshot of snapshots) {
    const start = Number(snapshot.start);
    if (start <= timestamp) {
      applicableTax = snapshot.cashOutTax;
    } else {
      break;
    }
  }

  return applicableTax;
}
