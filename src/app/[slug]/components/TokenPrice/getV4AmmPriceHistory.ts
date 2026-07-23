import {
  IndexedBuybackPoolsOperation,
  IndexedPoolSwapsOperation,
} from "@/lib/bendystraw/operations";
import { queryBendystraw } from "@/lib/bendystraw/query.server";
import type { IndexedBuybackPoolsQuery, IndexedPoolSwapsQuery } from "@/lib/bendystraw/types";
import { JBChainId } from "@bananapus/nana-sdk-core";
import { uniswapV4PriceFromSqrtPriceX96 } from "@bananapus/nana-sdk-core/v6";
import type { PriceDataPoint } from "./getTokenPriceChartData";

const PAGE_SIZE = 1000;
const MAX_SWAPS = 3000;

type RawPool = IndexedBuybackPoolsQuery["buybackPoolEvents"]["items"][number];
type RawSwap = IndexedPoolSwapsQuery["swapEvents"]["items"][number];

export function v4PriceFromSqrtPriceX96(
  sqrtPriceX96: string | bigint,
  projectTokenIsCurrency0: boolean,
  terminalDecimals: number,
  projectTokenDecimals = 18,
): number | null {
  const price = uniswapV4PriceFromSqrtPriceX96(
    BigInt(sqrtPriceX96),
    !projectTokenIsCurrency0,
    terminalDecimals,
  );
  if (price === null) return null;
  const adjusted = price * 10 ** (projectTokenDecimals - 18);
  return Number.isFinite(adjusted) && adjusted > 0 ? adjusted : null;
}

export async function getV4AmmPriceHistory({
  projectId,
  chainId,
  terminalToken,
  terminalDecimals,
}: {
  projectId: string;
  chainId: JBChainId;
  terminalToken: string;
  terminalDecimals: number;
}): Promise<{ data: PriceDataPoint[]; hasPool: boolean }> {
  const variables = {
    projectId: Number(projectId),
    chainId: Number(chainId),
    version: 6,
  };
  const poolResult = await queryBendystraw(chainId, IndexedBuybackPoolsOperation, variables);
  const pool = (poolResult.buybackPoolEvents?.items ?? []).find(
    (item) => item.terminalToken.toLowerCase() === terminalToken.toLowerCase(),
  );
  if (!pool) return { data: [], hasPool: false };

  const swaps: RawSwap[] = [];
  let totalCount = 0;
  while (swaps.length < MAX_SWAPS) {
    const page = await queryBendystraw(chainId, IndexedPoolSwapsOperation, {
      ...variables,
      limit: Math.min(PAGE_SIZE, MAX_SWAPS - swaps.length),
      offset: swaps.length,
    });
    const items = page.swapEvents?.items ?? [];
    totalCount = page.swapEvents?.totalCount ?? items.length;
    swaps.push(...items);
    if (items.length === 0 || swaps.length >= totalCount) break;
  }

  const data: PriceDataPoint[] = [];
  if (pool.initialSqrtPriceX96 && pool.projectTokenIsCurrency0 !== null) {
    const ammPrice = v4PriceFromSqrtPriceX96(
      pool.initialSqrtPriceX96,
      pool.projectTokenIsCurrency0,
      terminalDecimals,
    );
    if (ammPrice) data.push({ timestamp: Number(pool.timestamp), ammPrice });
  }

  for (const swap of swaps) {
    if (
      swap.direction === "mint" ||
      !swap.poolId ||
      swap.poolId.toLowerCase() !== pool.poolId.toLowerCase()
    ) {
      continue;
    }

    let ammPrice =
      swap.sqrtPriceX96 && swap.projectTokenIsCurrency0 !== null
        ? v4PriceFromSqrtPriceX96(swap.sqrtPriceX96, swap.projectTokenIsCurrency0, terminalDecimals)
        : null;
    if (!ammPrice) {
      const terminalAmount = Number(BigInt(swap.terminalTokenAmount)) / 10 ** terminalDecimals;
      const projectAmount = Number(BigInt(swap.projectTokenAmount)) / 1e18;
      ammPrice = projectAmount > 0 ? terminalAmount / projectAmount : null;
    }
    if (ammPrice && Number.isFinite(ammPrice)) {
      data.push({ timestamp: Number(swap.timestamp), ammPrice });
    }
  }

  data.sort((a, b) => a.timestamp - b.timestamp);
  return { data, hasPool: true };
}
