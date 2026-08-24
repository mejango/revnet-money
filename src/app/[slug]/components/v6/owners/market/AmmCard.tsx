"use client";

import { ParticipantsPieChart } from "@/app/[slug]/owners/components/ParticipantsPieChart";
import { ChainLogo } from "@/components/ChainLogo";
import { EthereumAddress } from "@/components/EthereumAddress";
import { ExternalLink } from "@/components/ExternalLink";
import { Revalidating } from "@/components/ui/Revalidating";
import { SkeletonLines } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { TxSteps } from "@/components/ui/TxSteps";
import { useAllowance } from "@/hooks/useAllowance";
import {
  isSafeConnection,
  submittedViaSafe,
  useWaitForTransactionReceipt,
  useWriteContract,
} from "@/hooks/useReviewedWriteContract";
import { cachedQuery } from "@/lib/query-persist";
import { explorerBaseUrl } from "@/lib/utils";
import { waitForReceiptWithRetry } from "@/lib/waitForReceipt";
import {
  uniswapV4AmountsForLiquidity,
  uniswapV4DefaultPriceRange,
  uniswapV4SqrtPriceX96AtTick,
} from "@bananapus/nana-sdk-core/v6";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import {
  erc20Abi,
  formatUnits,
  parseUnits,
  zeroAddress,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";
import { useAccount, useConfig, usePublicClient } from "wagmi";
import {
  chainName,
  ChainProject,
  chainProjectsKey,
  explorerAddressUrl,
  fmtUnits,
} from "../settlement/lib";
import {
  describeAddLiquidityPlan,
  liquidityFormView,
  type LiquidityFormMode,
  type LiquidityFormSide,
} from "./formView";
import {
  AmmChainState,
  encodeAddLiquidityCall,
  fetchAmmStates,
  lpDeadline,
  PERMIT2_ABI,
  PERMIT2_ADDRESS,
  permit2AllowanceCovers,
  permit2ApprovalArgs,
  POSITION_MANAGER_ABI,
  POSITION_MANAGER_BY_CHAIN,
  prepareAddLiquidity,
  prepareCollectLpFees,
  prepareRemoveLiquidity,
  readLpPositionFees,
  readPoolLpPositions,
  readUserLpPositions,
  refreshUserLpPosition,
  reverifyAddLiquidity,
  type AddLiquidityPlan,
  type PoolComposition,
  type PoolSnapshot,
  type UserLpPosition,
} from "./lib";
import { LiquidityRangePreview } from "./LiquidityRangePreview";

function formatPrice(price: number): string {
  if (!isFinite(price) || price <= 0) return "—";
  if (price < 0.0001) return price.toExponential(2);
  return Intl.NumberFormat("en", { maximumFractionDigits: price >= 1 ? 4 : 8 }).format(price);
}

function MarketChainRow({
  state,
  tokenSymbol,
  pending = false,
}: {
  state: AmmChainState;
  tokenSymbol: string;
  /** Restored from a previous read and still confirming. */
  pending?: boolean;
}) {
  const { pool } = state;
  const explorer = pool ? explorerAddressUrl(state.chainId, pool.poolManager) : null;
  const inverse = pool?.price ? 1 / pool.price : null;
  const { issuance, cashOut } = state.reference;
  return (
    <div className="border-b border-zinc-50 py-3 last:border-b-0">
      <div className="flex items-center gap-2 text-sm font-medium text-zinc-900">
        <ChainLogo chainId={state.chainId} width={16} height={16} />
        {chainName(state.chainId)}
        {explorer ? (
          <a
            href={explorer}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs font-normal text-zinc-400 underline decoration-dotted hover:text-zinc-600"
          >
            PoolManager ↗
          </a>
        ) : null}
      </div>
      {!state.hook ? (
        <p className="text-sm text-zinc-400 mt-1">No buyback hook configured on this chain.</p>
      ) : !pool ? (
        <p className="text-sm text-zinc-400 mt-1">
          Buyback hook configured, but its pool is not initialized yet.
        </p>
      ) : (
        <>
          <p className="mt-2 text-lg font-medium text-zinc-900">
            1 {tokenSymbol} = {formatPrice(pool.price ?? 0)} {pool.pair.symbol}
          </p>
          <p className="text-sm text-zinc-500">
            1 {pool.pair.symbol} = {inverse ? formatPrice(inverse) : "—"} {tokenSymbol}
          </p>
          {issuance || cashOut ? (
            <dl className="mt-4 space-y-1.5 border-t border-zinc-100 pt-3 text-sm">
              {issuance ? (
                <div className="flex items-baseline justify-between gap-3">
                  <dt className="text-zinc-500">Current issuance price</dt>
                  <dd className="font-medium text-zinc-900">
                    <Revalidating pending={pending}>
                      {formatPrice(issuance)} {pool.pair.symbol}
                    </Revalidating>
                  </dd>
                </div>
              ) : null}
              {cashOut ? (
                <div className="flex items-baseline justify-between gap-3">
                  <dt className="text-zinc-500">Current cash out price</dt>
                  <dd className="font-medium text-zinc-900">
                    <Revalidating pending={pending}>
                      {formatPrice(cashOut)} {pool.pair.symbol}
                    </Revalidating>
                  </dd>
                </div>
              ) : null}
            </dl>
          ) : null}
          <p className="mt-3 text-xs text-zinc-400">
            Uniswap V4 pool, {pool.key.fee / 10_000}% fee.
          </p>
        </>
      )}
    </div>
  );
}

const DEPTH_WIDTH = 320;
const DEPTH_BANDS = 48;

/** Inverse of {@link tickPrice}: the raw tick at a pair/token price. */
function priceTick(pool: PoolSnapshot, price: number): number {
  const decimalScale = 10 ** (18 - pool.pair.decimals);
  const rawPrice = pool.pairIsC0 ? decimalScale / price : price / decimalScale;
  return Math.log(rawPrice) / Math.log(1.0001);
}

function tickPrice(pool: PoolSnapshot, tick: number): number {
  const decimalScale = 10 ** (18 - pool.pair.decimals);
  const rawPrice = 1.0001 ** tick;
  return (pool.pairIsC0 ? 1 / rawPrice : rawPrice) * decimalScale;
}

/**
 * Who supplies this pool: the owner breakdown's own pie and table, sized by the
 * pair-token value of each provider's positions, so the two read as one family.
 * The positions come from the index where it has them and the onchain scan
 * otherwise, which is why this can render before the depth chart resolves.
 */
function LiquidityProviders({ pool, tokenSymbol }: { pool: PoolSnapshot; tokenSymbol: string }) {
  const positions = useQuery({
    queryKey: ["revnetPoolLpProviders", pool.chainId, pool.poolId],
    retry: 0,
    staleTime: 60_000,
    queryFn: () => readPoolLpPositions(pool),
  });

  const owners = useMemo(() => {
    const byOwner = new Map<
      string,
      { address: Address; pair: bigint; token: bigint; positions: number; value: number }
    >();
    for (const position of positions.data ?? []) {
      const key = position.owner.toLowerCase();
      const current = byOwner.get(key) ?? {
        address: position.owner,
        pair: 0n,
        token: 0n,
        positions: 0,
        value: 0,
      };
      current.pair += position.pairAmount;
      current.token += position.tokenAmount;
      current.positions += 1;
      current.value =
        Number(formatUnits(current.pair, pool.pair.decimals)) +
        (pool.price ?? 0) * Number(formatUnits(current.token, 18));
      byOwner.set(key, current);
    }
    return [...byOwner.values()].sort((a, b) => b.value - a.value);
  }, [positions.data, pool]);

  if (positions.isLoading) {
    return <p className="mt-2 text-sm text-zinc-400">Reading liquidity providers…</p>;
  }
  if (!owners.length) return null;

  const total = owners.reduce((sum, owner) => sum + owner.value, 0);
  // The pie is the owner chart's, fed the providers' pair-token value as its
  // balance so the slices are sized the same way.
  const participants = owners.map((owner) => ({
    address: owner.address,
    balance: owner.pair.toString(),
    volume: "0",
    chains: [Number(pool.chainId)],
  }));
  const totalPair = owners.reduce((sum, owner) => sum + owner.pair, 0n);

  return (
    <div className="mb-6">
      <div className="grid items-start gap-8 lg:grid-cols-[minmax(280px,0.72fr)_minmax(360px,1.28fr)]">
        <div className="min-w-0">
          <ParticipantsPieChart
            participants={participants}
            totalSupply={totalPair}
            token={null}
            showOwnerCount
          />
        </div>
        <div className="w-full min-w-0 overflow-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Account</TableHead>
                <TableHead className="text-right">{pool.pair.symbol}</TableHead>
                <TableHead className="text-right">{tokenSymbol}</TableHead>
                <TableHead className="text-right">Share</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {owners.map((owner) => (
                <TableRow key={owner.address}>
                  <TableCell>
                    <EthereumAddress address={owner.address} short withEnsAvatar withEnsName />
                    {owner.positions > 1 ? (
                      <span className="block text-xs text-zinc-500">
                        {owner.positions} positions
                      </span>
                    ) : null}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {fmtUnits(owner.pair, pool.pair.decimals)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {fmtUnits(owner.token, 18)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums font-medium">
                    {total > 0 ? `${((owner.value / total) * 100).toFixed(1)}%` : "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>
    </div>
  );
}

function LiquidityVisualization({
  pool,
  composition,
  tokenSymbol,
}: {
  pool: PoolSnapshot;
  composition: PoolComposition;
  tokenSymbol: string;
}) {
  const model = useMemo(() => {
    const pairAmount = Number(formatUnits(composition.pairAmount, pool.pair.decimals));
    const tokenAmount = Number(formatUnits(composition.tokenAmount, 18));
    const tokenValue = pool.price == null ? 0 : tokenAmount * pool.price;
    const totalValue = pairAmount + tokenValue;
    const pairPercent = totalValue > 0 ? (pairAmount / totalValue) * 100 : 0;
    const tokenPercent = totalValue > 0 ? (tokenValue / totalValue) * 100 : 0;

    const ranges = composition.ranges
      .map((range) => {
        const a = tickPrice(pool, range.tickLower);
        const b = tickPrice(pool, range.tickUpper);
        return {
          tickLower: range.tickLower,
          tickUpper: range.tickUpper,
          liquidityRaw: range.liquidity,
          low: Math.min(a, b),
          high: Math.max(a, b),
          liquidity: Number(range.liquidity),
        };
      })
      .filter(
        (range) =>
          range.low > 0 &&
          range.high > range.low &&
          Number.isFinite(range.low) &&
          Number.isFinite(range.high) &&
          Number.isFinite(range.liquidity),
      );

    if (ranges.length === 0 || pool.price == null || pool.price <= 0) {
      return { pairAmount, tokenAmount, pairPercent, tokenPercent, depth: null };
    }

    const low = Math.min(...ranges.map((range) => range.low), pool.price);
    const high = Math.max(...ranges.map((range) => range.high), pool.price);
    if (!(high > low)) {
      return { pairAmount, tokenAmount, pairPercent, tokenPercent, depth: null };
    }

    const logLow = Math.log(low);
    const logHigh = Math.log(high);
    const span = logHigh - logLow;
    const bands = Array.from({ length: DEPTH_BANDS }, (_, index) => {
      const mid = Math.exp(logLow + ((index + 0.5) / DEPTH_BANDS) * span);
      const bandLow = Math.exp(logLow + (index / DEPTH_BANDS) * span);
      const bandHigh = Math.exp(logLow + ((index + 1) / DEPTH_BANDS) * span);
      // Pair/token price falls with tick when the pair is currency0 and rises
      // when it is currency1, so normalize both orientations before
      // intersecting a band with a position's range.
      const bandTicks = [priceTick(pool, bandLow), priceTick(pool, bandHigh)];
      const bandTickLow = Math.min(...bandTicks);
      const bandTickHigh = Math.max(...bandTicks);

      let liquidity = 0;
      let pair = 0n;
      let token = 0n;
      for (const range of ranges) {
        if (mid >= range.low && mid <= range.high) liquidity += range.liquidity;
        const overlapLow = Math.max(bandTickLow, range.tickLower);
        const overlapHigh = Math.min(bandTickHigh, range.tickUpper);
        if (overlapLow >= overlapHigh) continue;
        const amounts = uniswapV4AmountsForLiquidity(
          pool.sqrtP,
          uniswapV4SqrtPriceX96AtTick(Math.round(overlapLow)),
          uniswapV4SqrtPriceX96AtTick(Math.round(overlapHigh)),
          range.liquidityRaw,
        );
        pair += pool.pairIsC0 ? amounts.amount0 : amounts.amount1;
        token += pool.pairIsC0 ? amounts.amount1 : amounts.amount0;
      }
      return { mid, liquidity, pair, token };
    });
    const maxLiquidity = Math.max(...bands.map((band) => band.liquidity), 1);
    const priceX = ((Math.log(pool.price) - logLow) / span) * DEPTH_WIDTH;

    return {
      pairAmount,
      tokenAmount,
      pairPercent,
      tokenPercent,
      depth: { bands, maxLiquidity, low, high, priceX },
    };
  }, [composition, pool]);

  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  // With nothing hovered, report the band holding the current price.
  const priceIndex = useMemo(() => {
    const bands = model.depth?.bands;
    if (!bands?.length || pool.price == null) return null;
    let nearest = 0;
    bands.forEach((band, index) => {
      if (Math.abs(band.mid - pool.price!) < Math.abs(bands[nearest].mid - pool.price!)) {
        nearest = index;
      }
    });
    return nearest;
  }, [model.depth, pool.price]);
  const shownIndex = hoverIndex ?? priceIndex;
  const shownBand = shownIndex == null ? null : (model.depth?.bands[shownIndex] ?? null);

  return (
    <div className="mt-3 space-y-5">
      <div>
        <div className="text-xs text-zinc-500">Composition</div>
        {model.pairPercent + model.tokenPercent > 0 ? (
          <>
            <div
              className="mt-2 flex h-3 w-full overflow-hidden bg-teal-100"
              aria-label={`${pool.pair.symbol} ${model.pairPercent.toFixed(1)}%, ${tokenSymbol} ${model.tokenPercent.toFixed(1)}%`}
            >
              <div className="bg-teal-400" style={{ width: `${model.pairPercent}%` }} />
              <div className="bg-amber-400" style={{ width: `${model.tokenPercent}%` }} />
            </div>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-700">
              <span className="flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 bg-teal-400" aria-hidden="true" />
                {pool.pair.symbol} {fmtUnits(composition.pairAmount, pool.pair.decimals)} (
                {model.pairPercent.toFixed(1)}%)
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 bg-amber-400" aria-hidden="true" />
                {tokenSymbol} {fmtUnits(composition.tokenAmount, 18)} (
                {model.tokenPercent.toFixed(1)}%)
              </span>
            </div>
          </>
        ) : (
          <p className="mt-1 text-sm text-zinc-400">The pool has no active reserves.</p>
        )}
      </div>

      {model.depth ? (
        <div>
          <div className="text-xs text-zinc-500">Depth</div>
          <svg
            viewBox={`0 0 ${DEPTH_WIDTH} 128`}
            className="mt-2 h-auto w-full cursor-crosshair touch-none"
            role="img"
            aria-label={`${tokenSymbol} liquidity depth from ${formatPrice(model.depth.low)} to ${formatPrice(model.depth.high)} ${pool.pair.symbol}`}
            onPointerMove={(event) => {
              const rect = event.currentTarget.getBoundingClientRect();
              const x = ((event.clientX - rect.left) / rect.width) * DEPTH_WIDTH;
              const index = Math.floor(x / (DEPTH_WIDTH / DEPTH_BANDS));
              setHoverIndex(index >= 0 && index < DEPTH_BANDS ? index : null);
            }}
            onPointerLeave={() => setHoverIndex(null)}
          >
            {model.depth.bands.map((band, index) => {
              if (band.liquidity <= 0) return null;
              const width = DEPTH_WIDTH / DEPTH_BANDS;
              const height = (band.liquidity / model.depth!.maxLiquidity) * 78;
              return (
                <rect
                  key={index}
                  x={(index * width).toFixed(1)}
                  y={(98 - height).toFixed(1)}
                  width={Math.max(0.5, width - 0.6).toFixed(1)}
                  height={height.toFixed(1)}
                  fill={band.mid < pool.price! ? "#99f6e4" : "#fcd34d"}
                  opacity={index === shownIndex ? 0.95 : 0.6}
                />
              );
            })}
            <line x1="1" y1="20" x2="1" y2="98" stroke="#71717a" strokeDasharray="3 2" />
            <line
              x1={model.depth.priceX.toFixed(1)}
              y1="20"
              x2={model.depth.priceX.toFixed(1)}
              y2="98"
              stroke="#f59e0b"
              strokeWidth="1.5"
              strokeDasharray="3 2"
            />
            <line x1="319" y1="20" x2="319" y2="98" stroke="#14b8a6" strokeDasharray="3 2" />
            <text x="1" y="13" fontSize="8" fill="#71717a">
              floor
            </text>
            {/* ponytail: measured at 8px in the page font, "floor" and the
                centered "price" are 24.3 wide and "ceiling" 34.1 — so the
                centered label collides with an end label outside this band.
                Drop it there rather than print over them: the amber line still
                marks the price and the readout below the chart names it. */}
            {model.depth.priceX > 42 && model.depth.priceX < DEPTH_WIDTH - 52 ? (
              <text
                x={model.depth.priceX.toFixed(1)}
                y="13"
                fontSize="8"
                fill="#71717a"
                textAnchor="middle"
              >
                price
              </text>
            ) : null}
            <text x="319" y="13" fontSize="8" fill="#71717a" textAnchor="end">
              ceiling
            </text>
            <text x="1" y="119" fontSize="8" fill="#71717a">
              {formatPrice(model.depth.low)}
            </text>
            <text x="319" y="119" fontSize="8" fill="#71717a" textAnchor="end">
              {formatPrice(model.depth.high)}
            </text>
          </svg>
          <p className="mt-1 text-xs text-zinc-600" aria-live="polite">
            {shownBand ? (
              <>
                <span className="font-medium text-zinc-900">
                  ~{formatPrice(shownBand.mid)} {pool.pair.symbol}/{tokenSymbol}
                </span>{" "}
                | {shownBand.mid < pool.price! ? "buy-side" : "sell-side"} —{" "}
                {fmtUnits(shownBand.token, 18)} {tokenSymbol} +{" "}
                {fmtUnits(shownBand.pair, pool.pair.decimals)} {pool.pair.symbol}
              </>
            ) : (
              <>
                ~{formatPrice(pool.price!)} {pool.pair.symbol}/{tokenSymbol}
              </>
            )}
          </p>
        </div>
      ) : null}
    </div>
  );
}

function LiquidityChainRow({ state, tokenSymbol }: { state: AmmChainState; tokenSymbol: string }) {
  const { pool, composition } = state;
  return (
    <div className="border-b border-zinc-50 py-3 last:border-b-0">
      <div className="flex items-center gap-2 text-sm font-medium text-zinc-900">
        <ChainLogo chainId={state.chainId} width={16} height={16} />
        {chainName(state.chainId)}
      </div>
      {!state.hook ? (
        <p className="mt-1 text-sm text-zinc-400">No buyback hook configured on this chain.</p>
      ) : !pool ? (
        <p className="mt-1 text-sm text-zinc-400">This pool is not initialized yet.</p>
      ) : composition == null ? (
        <p className="mt-2 text-sm text-zinc-400">
          The RPC could not return the complete pool history, so liquidity is unavailable.
        </p>
      ) : (
        <>
          <LiquidityProviders pool={pool} tokenSymbol={tokenSymbol} />
          <LiquidityVisualization pool={pool} composition={composition} tokenSymbol={tokenSymbol} />
        </>
      )}
    </div>
  );
}

// Viem stuffs the whole request envelope into `message`; `shortMessage` is the
// one sentence a reader can act on.
function txMessage(cause: unknown, fallback: string): string {
  const error = cause as { shortMessage?: string; message?: string } | null;
  return error?.shortMessage || error?.message || fallback;
}

/**
 * A wallet prompt this add will actually raise. Deciding the sequence while
 * reviewing — not while executing — is what lets the signer see the whole queue
 * before the first prompt, and keeps the list from naming approvals it skips.
 */
type LiquidityStep = {
  title: string;
  detail: string;
  approval?: { kind: "erc20" | "permit2"; currency: Address; max: bigint };
};

export function AddLiquidityForm({
  state,
  tokenSymbol,
}: {
  state: AmmChainState;
  tokenSymbol: string;
}) {
  const { address } = useAccount();
  const wagmiConfig = useConfig();
  const chainId = Number(state.chainId);
  const publicClient = usePublicClient({ chainId });
  const { ensureAllowance, isApproving } = useAllowance(chainId);
  const { writeContractAsync, isPending } = useWriteContract();
  const [mode, setMode] = useState<LiquidityFormMode>("amounts");
  const [minText, setMinText] = useState("");
  const [maxText, setMaxText] = useState("");
  const [pairText, setPairText] = useState("");
  const [tokenText, setTokenText] = useState("");
  const [driver, setDriver] = useState<LiquidityFormSide>("token");
  const [reviewed, setReviewed] = useState<{
    plan: AddLiquidityPlan;
    steps: LiquidityStep[];
    snapshot: string;
  } | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [stepIndex, setStepIndex] = useState(0);
  const [minted, setMinted] = useState<Hex | null>(null);
  const [busy, setBusy] = useState(false);
  const queryClient = useQueryClient();
  const pool = state.pool;

  // Seed the range-mode inputs once from the economic corridor (cash-out
  // floor → issuance ceiling) rather than an arbitrary band; never clobber a
  // range the user already touched.
  useEffect(() => {
    const price = pool?.price;
    if (!price || price <= 0) return;
    setMinText((current) => {
      if (current !== "") return current;
      const seeded = uniswapV4DefaultPriceRange(
        price,
        state.reference.cashOut ?? 0,
        state.reference.issuance ?? 0,
      );
      setMaxText((max) => (max === "" ? String(Number(seeded.max.toPrecision(6))) : max));
      return String(Number(seeded.min.toPrecision(6)));
    });
  }, [pool?.poolId, pool?.price, state.reference.cashOut, state.reference.issuance]);

  if (!pool || !POSITION_MANAGER_BY_CHAIN[chainId]) return null;

  const view = liquidityFormView({
    mode,
    tokenText,
    pairText,
    minText,
    maxText,
    driver,
    price: pool.price ?? 0,
    reference: state.reference,
    tokenSymbol,
    pairSymbol: pool.pair.symbol,
  });

  const snapshot = [mode, minText, maxText, pairText, tokenText, driver].join("|");
  const review = reviewed?.snapshot === snapshot ? reviewed.plan : null;
  const reviewSteps = reviewed?.snapshot === snapshot ? reviewed.steps : [];

  // Typed amounts submit from their exact text; derived ones from the solved
  // float (their on-chain amounts are recomputed from liquidity anyway).
  const sideUnits = (side: LiquidityFormSide): bigint => {
    const decimals = side === "token" ? 18 : pool.pair.decimals;
    const amount = side === "token" ? view.tokenAmount : view.pairAmount;
    if (amount == null || amount <= 0) return 0n;
    const text = (side === "token" ? tokenText : pairText).trim();
    const typed = mode === "amounts" || view.derived !== side;
    return typed && text
      ? parseUnits(text, decimals)
      : parseUnits(amount.toFixed(decimals), decimals);
  };

  // The derived side displays its computed counterpart; everything else shows
  // what the user typed.
  const amountValue = (side: LiquidityFormSide): string => {
    if (mode !== "amounts" && view.disabled[side]) return "";
    if (mode !== "amounts" && view.derived === side) {
      const amount = side === "token" ? view.tokenAmount : view.pairAmount;
      return amount == null ? "" : String(Number(amount.toPrecision(6)));
    }
    return side === "token" ? tokenText : pairText;
  };

  const planText = review
    ? describeAddLiquidityPlan({
        tokenMaximum: review.tokenMaximum,
        pairMaximum: review.pairMaximum,
        tickLower: review.tickLower,
        tickUpper: review.tickUpper,
        tokenSymbol,
        pairSymbol: pool.pair.symbol,
        pairDecimals: pool.pair.decimals,
      })
    : null;
  const prepare = async () => {
    if (!address || !publicClient) {
      setStatus("Connect a wallet first.");
      return;
    }
    if (!view.ready || view.minPrice == null || view.maxPrice == null) {
      setStatus(view.note ?? "Finish the amounts first.");
      return;
    }
    setBusy(true);
    setStepIndex(0);
    setMinted(null);
    setStatus("Reading fresh pool and wallet balances…");
    try {
      const plan = prepareAddLiquidity(
        pool,
        { pairAmount: sideUnits("pair"), tokenAmount: sideUnits("token") },
        {
          minimumPrice: view.minPrice,
          maximumPrice: view.maxPrice,
        },
        address,
      );
      const [tokenBalance, pairBalance] = await Promise.all([
        publicClient.readContract({
          address: pool.projectToken,
          abi: erc20Abi,
          functionName: "balanceOf",
          args: [address],
        }),
        pool.pair.addr === zeroAddress
          ? publicClient.getBalance({ address })
          : publicClient.readContract({
              address: pool.pair.addr,
              abi: erc20Abi,
              functionName: "balanceOf",
              args: [address],
            }),
      ]);
      // Gate on what the pool actually pulls, not on the plan's maxima: those
      // carry 1% price headroom that only gets spent if the price moves, so
      // blocking on them rejects an entry that comfortably fits.
      const enteredToken = sideUnits("token");
      const enteredPair = sideUnits("pair");
      if (enteredToken > tokenBalance) {
        throw new Error(`That's more ${tokenSymbol} than your balance.`);
      }
      if (enteredPair > pairBalance) {
        throw new Error(`That's more ${pool.pair.symbol} than your balance.`);
      }
      const symbolOf = (currency: Address) =>
        currency.toLowerCase() === pool.projectToken.toLowerCase() ? tokenSymbol : pool.pair.symbol;
      const approvals: LiquidityStep[] = [];
      for (const side of plan.erc20Sides) {
        const symbol = symbolOf(side.currency);
        const allowance = await publicClient.readContract({
          address: side.currency,
          abi: erc20Abi,
          functionName: "allowance",
          args: [address, PERMIT2_ADDRESS],
        });
        if (allowance < side.max) {
          approvals.push({
            title: `Approve ${symbol} access`,
            detail: `Permit2 is what moves your ${symbol} into the pool.`,
            approval: { kind: "erc20", currency: side.currency, max: side.max },
          });
        }
        if (!(await permit2AllowanceCovers(state.chainId, address, side.currency, side.max))) {
          approvals.push({
            title: `Authorize the Uniswap position manager for ${symbol}`,
            detail: `A capped, expiring ${symbol} allowance — not an open-ended one.`,
            approval: { kind: "permit2", currency: side.currency, max: side.max },
          });
        }
      }
      setReviewed({
        plan,
        steps: [
          ...approvals,
          {
            title: "Mint the position",
            detail: "Deposits both sides into your chosen price range.",
          },
        ],
        snapshot,
      });
      // The headroom is still worth naming when it outruns the balance — the
      // mint reverts if the price moves against the position before it lands.
      const tight = [
        plan.tokenMaximum > tokenBalance ? tokenSymbol : null,
        plan.pairMaximum > pairBalance ? pool.pair.symbol : null,
      ].filter((symbol): symbol is string => symbol != null);
      setStatus(
        tight.length
          ? `Heads up: your ${tight.join(" and ")} balance does not cover the 1% price headroom, ` +
              `so this mint reverts if the price moves against it. Lower the amount to be safe.`
          : null,
      );
    } catch (cause) {
      setReviewed(null);
      setStatus(txMessage(cause, "Could not prepare liquidity."));
    } finally {
      setBusy(false);
    }
  };

  const execute = async () => {
    if (!address || !publicClient || !reviewed || reviewed.snapshot !== snapshot) return;
    const { plan, steps } = reviewed;
    setBusy(true);
    setStatus(null);
    try {
      for (const [index, step] of steps.entries()) {
        setStepIndex(index);
        if (step.approval?.kind === "erc20") {
          await ensureAllowance(step.approval.currency, PERMIT2_ADDRESS, step.approval.max);
          continue;
        }
        if (step.approval?.kind === "permit2") {
          // Re-checked rather than trusted: the review's reading can age out.
          const covered = await permit2AllowanceCovers(
            state.chainId,
            address,
            step.approval.currency,
            step.approval.max,
          );
          if (covered) continue;
          const approvalHash = await writeContractAsync({
            chainId,
            address: PERMIT2_ADDRESS,
            abi: PERMIT2_ABI,
            functionName: "approve",
            args: permit2ApprovalArgs(state.chainId, step.approval.currency, step.approval.max),
          });
          if (submittedViaSafe(approvalHash)) {
            setStatus(
              "Permit2 authorization was proposed to Safe. Execute it, then review liquidity again.",
            );
            setReviewed(null);
            return;
          }
          const receipt = await waitForReceiptWithRetry(publicClient, approvalHash);
          if (receipt.status !== "success") {
            throw new Error(`Permit2 authorization ${approvalHash} reverted.`);
          }
          continue;
        }
        await reverifyAddLiquidity(pool, plan);
        const call = encodeAddLiquidityCall(plan, lpDeadline(isSafeConnection(wagmiConfig)));
        const hash = await writeContractAsync({
          chainId,
          address: POSITION_MANAGER_BY_CHAIN[chainId]!,
          abi: POSITION_MANAGER_ABI,
          functionName: "modifyLiquidities",
          args: call.args,
          value: plan.value,
        });
        if (submittedViaSafe(hash)) {
          setStatus("Liquidity mint was proposed to Safe and awaits approvals and execution.");
          setReviewed(null);
          return;
        }
        const receipt = await waitForReceiptWithRetry(publicClient, hash);
        if (receipt.status !== "success") throw new Error(`Liquidity mint ${hash} reverted.`);
        setStepIndex(steps.length);
        setMinted(hash);
      }
      setReviewed(null);
      setPairText("");
      setTokenText("");
      // The position list below this form is a sibling query: without this it
      // keeps claiming the wallet owns nothing right after a successful mint.
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["revnetWalletLpPositions"] }),
        queryClient.invalidateQueries({ queryKey: ["revnetPoolLpProviders"] }),
      ]);
    } catch (cause) {
      setStatus(txMessage(cause, "Could not add liquidity."));
    } finally {
      setBusy(false);
    }
  };

  const disabled = busy || isApproving || isPending;
  return (
    <div className="mt-3 border-t border-zinc-100 pt-3">
      <div className="flex items-center justify-between gap-3">
        <div className="text-xs font-medium text-zinc-600">Add liquidity</div>
        <span className="text-[11px] text-zinc-400">
          Current ~{pool.price?.toPrecision(6) ?? "—"} {pool.pair.symbol}/{tokenSymbol}
        </span>
      </div>
      <div className="mt-2 flex gap-1 text-[11px]">
        <button
          type="button"
          className={
            mode === "amounts"
              ? "bg-zinc-900 px-2 py-1 text-white"
              : "border border-zinc-300 px-2 py-1 hover:bg-zinc-50"
          }
          disabled={disabled}
          onClick={() => {
            if (mode === "amounts") return;
            // Materialize the derived amount so it stays editable text.
            if (view.derived === "pair" && view.pairAmount != null) {
              setPairText(String(Number(view.pairAmount.toPrecision(6))));
            } else if (view.derived === "token" && view.tokenAmount != null) {
              setTokenText(String(Number(view.tokenAmount.toPrecision(6))));
            }
            setMode("amounts");
            setReviewed(null);
          }}
        >
          By amounts
        </button>
        <button
          type="button"
          className={
            mode === "full"
              ? "bg-zinc-900 px-2 py-1 text-white"
              : "border border-zinc-300 px-2 py-1 hover:bg-zinc-50"
          }
          disabled={disabled}
          onClick={() => {
            if (mode === "full") return;
            setMode("full");
            setReviewed(null);
          }}
        >
          Full range
        </button>
        <button
          type="button"
          className={
            mode === "range"
              ? "bg-zinc-900 px-2 py-1 text-white"
              : "border border-zinc-300 px-2 py-1 hover:bg-zinc-50"
          }
          disabled={disabled}
          onClick={() => {
            if (mode === "range") return;
            // Carry the solved range over so fine-tuning starts from it; a
            // full-range span is no starting point, so re-seed the economic
            // corridor instead.
            if (mode === "full") {
              if (pool.price && pool.price > 0) {
                const seeded = uniswapV4DefaultPriceRange(
                  pool.price,
                  state.reference.cashOut ?? 0,
                  state.reference.issuance ?? 0,
                );
                setMinText(String(Number(seeded.min.toPrecision(6))));
                setMaxText(String(Number(seeded.max.toPrecision(6))));
              }
            } else if (view.minPrice != null && view.maxPrice != null) {
              setMinText(String(Number(view.minPrice.toPrecision(6))));
              setMaxText(String(Number(view.maxPrice.toPrecision(6))));
            }
            setMode("range");
            setReviewed(null);
          }}
        >
          By price range
        </button>
      </div>
      {mode !== "full" ? (
        <LiquidityRangePreview
          floor={state.reference.cashOut}
          ceiling={state.reference.issuance}
          current={pool.price}
          minimum={view.minPrice ?? 0}
          maximum={view.maxPrice ?? 0}
          pairSymbol={pool.pair.symbol}
          tokenSymbol={tokenSymbol}
          onRangeChange={
            mode === "range" && !disabled
              ? (edge, value) => {
                  (edge === "minimum" ? setMinText : setMaxText)(String(value));
                  setReviewed(null);
                }
              : undefined
          }
        />
      ) : null}
      {mode === "range" ? (
        <div className="mt-2 grid grid-cols-2 gap-2">
          <label className="text-[11px] text-zinc-500">
            Min price
            <input
              className="mt-1 w-full border border-zinc-200 px-2 py-1.5 text-xs"
              type="number"
              min="0"
              value={minText}
              disabled={disabled}
              onChange={(event) => {
                setMinText(event.target.value);
                setReviewed(null);
              }}
            />
          </label>
          <label className="text-[11px] text-zinc-500">
            Max price
            <input
              className="mt-1 w-full border border-zinc-200 px-2 py-1.5 text-xs"
              type="number"
              min="0"
              value={maxText}
              disabled={disabled}
              onChange={(event) => {
                setMaxText(event.target.value);
                setReviewed(null);
              }}
            />
          </label>
        </div>
      ) : null}
      <div className="mt-2 grid grid-cols-2 gap-2">
        <label className="text-[11px] text-zinc-500">
          <span className="flex items-center justify-between">
            {tokenSymbol}
            {mode !== "amounts" && view.derived === "token" ? (
              <span className="text-zinc-400">≈ auto</span>
            ) : null}
          </span>
          <input
            className="mt-1 w-full border border-zinc-200 px-2 py-1.5 text-xs"
            type="number"
            min="0"
            placeholder="0"
            value={amountValue("token")}
            disabled={disabled || (mode !== "amounts" && view.disabled.token)}
            onChange={(event) => {
              setTokenText(event.target.value);
              setDriver("token");
              setReviewed(null);
            }}
          />
        </label>
        <label className="text-[11px] text-zinc-500">
          <span className="flex items-center justify-between">
            {pool.pair.symbol}
            {mode !== "amounts" && view.derived === "pair" ? (
              <span className="text-zinc-400">≈ auto</span>
            ) : null}
          </span>
          <input
            className="mt-1 w-full border border-zinc-200 px-2 py-1.5 text-xs"
            type="number"
            min="0"
            placeholder="0"
            value={amountValue("pair")}
            disabled={disabled || (mode !== "amounts" && view.disabled.pair)}
            onChange={(event) => {
              setPairText(event.target.value);
              setDriver("pair");
              setReviewed(null);
            }}
          />
        </label>
      </div>
      {view.summary ? <p className="mt-2 text-xs text-zinc-600">{view.summary}</p> : null}
      {view.note ? <p className="mt-1 text-[11px] text-zinc-500">{view.note}</p> : null}
      {review && planText ? (
        <div className="mt-2 border border-amber-200 bg-amber-50 p-2 text-xs text-zinc-700">
          <p className="font-medium">{planText.lead}</p>
          <p className="mt-1 text-[11px] text-zinc-500">{planText.detail}</p>
          <TxSteps
            steps={reviewSteps}
            activeIndex={busy ? stepIndex : -1}
            intro={
              reviewSteps.length > 1
                ? `Your wallet will ask for ${reviewSteps.length} actions. This form stays open and advances through each one.`
                : "Your wallet will ask for one action."
            }
            className="mt-2 rounded border border-melon-200 bg-melon-50 p-3 text-xs"
          />
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              className="bg-zinc-900 px-3 py-1.5 text-white disabled:opacity-50"
              disabled={disabled}
              onClick={() => void execute()}
            >
              Confirm & add
            </button>
            <button
              type="button"
              className="border border-zinc-300 px-3 py-1.5"
              disabled={disabled}
              onClick={() => setReviewed(null)}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          className="mt-2 border border-zinc-300 px-3 py-1.5 text-xs hover:bg-zinc-50 disabled:opacity-50"
          disabled={disabled || !address || !view.ready}
          onClick={() => void prepare()}
        >
          {disabled ? "Checking…" : address ? "Review add liquidity" : "Connect to add liquidity"}
        </button>
      )}
      {minted ? (
        <div className="mt-2 border border-teal-300 bg-teal-50 p-2 text-xs" role="status">
          <p className="font-medium text-teal-800">Liquidity added.</p>
          <p className="mt-1 text-[11px] text-zinc-600">
            The position is yours and now earns fees. It is listed under &ldquo;Your
            liquidity&rdquo; below.
          </p>
          {explorerBaseUrl(chainId) ? (
            <ExternalLink
              className="mt-1 inline-block text-[11px] underline"
              href={`${explorerBaseUrl(chainId)}/tx/${minted}`}
            >
              View the transaction
            </ExternalLink>
          ) : null}
        </div>
      ) : null}
      {status ? (
        <p className="mt-2 wrap-anywhere text-xs text-zinc-500" role="status">
          {status}
        </p>
      ) : null}
    </div>
  );
}

export function LiquidityManager({
  state,
  tokenSymbol,
}: {
  state: AmmChainState;
  tokenSymbol: string;
}) {
  const { address } = useAccount();
  const wagmiConfig = useConfig();
  const pool = state.pool;
  const positionManager = POSITION_MANAGER_BY_CHAIN[Number(state.chainId)];
  const [reviewed, setReviewed] = useState<{
    position: UserLpPosition;
    plan: ReturnType<typeof prepareRemoveLiquidity>;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState<bigint | null>(null);
  const [claiming, setClaiming] = useState<bigint | null>(null);
  const client = usePublicClient({ chainId: Number(state.chainId) }) as PublicClient | undefined;
  const {
    writeContractAsync,
    data: hash,
    isPending,
  } = useWriteContract({
    transactionReview: {
      title: "Review liquidity removal",
      description:
        "Burn this Uniswap V4 position and return both currencies to the connected wallet. The reviewed minimum returns are enforced onchain.",
      confirmLabel: "Agree & remove liquidity",
    },
  });
  const receipt = useWaitForTransactionReceipt({ hash });
  const positions = useQuery({
    queryKey: ["revnetWalletLpPositions", state.chainId, pool?.poolId, address?.toLowerCase()],
    enabled: Boolean(pool && positionManager && address),
    retry: 0,
    staleTime: 30_000,
    queryFn: () => readUserLpPositions(pool!, address!),
  });

  // Unclaimed fees per position — the reason an LP opens this panel. Read
  // separately so the position list is not held up by two extra calls each.
  const fees = useQuery({
    queryKey: [
      "revnetWalletLpFees",
      state.chainId,
      pool?.poolId,
      (positions.data ?? []).map((position) => position.tokenId.toString()).join(","),
    ],
    enabled: Boolean(pool && positions.data?.length && client),
    retry: 0,
    staleTime: 30_000,
    queryFn: async () => {
      const entries = await Promise.all(
        (positions.data ?? []).map(async (position) => {
          const owed = await readLpPositionFees(client!, pool!, position).catch(() => null);
          return [position.tokenId.toString(), owed] as const;
        }),
      );
      return Object.fromEntries(entries);
    },
  });

  useEffect(() => {
    if (receipt.isSuccess) {
      setReviewed(null);
      void positions.refetch();
      void fees.refetch();
    }
    // Refetch only on the receipt transition; the query object changes each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [receipt.isSuccess]);

  if (!pool || !positionManager) return null;

  const beginReview = async (position: UserLpPosition) => {
    if (!address) return;
    setError(null);
    setRefreshing(position.tokenId);
    try {
      const fresh = await refreshUserLpPosition(pool, position.tokenId, address);
      setReviewed({
        position: fresh,
        plan: prepareRemoveLiquidity(pool, fresh, address, isSafeConnection(wagmiConfig)),
      });
    } catch (cause) {
      setError(txMessage(cause, "Could not refresh this position."));
    } finally {
      setRefreshing(null);
    }
  };

  // Claim fees only. Nothing is swapped and the position is untouched, so
  // there is no reviewed amount to re-verify — only the wallet's ownership,
  // which the PositionManager enforces itself.
  const claimFees = async (position: UserLpPosition) => {
    if (!address) return;
    setError(null);
    setClaiming(position.tokenId);
    try {
      const plan = prepareCollectLpFees(pool, position, address, isSafeConnection(wagmiConfig));
      await writeContractAsync({
        chainId: Number(state.chainId),
        address: positionManager,
        abi: POSITION_MANAGER_ABI,
        functionName: "modifyLiquidities",
        args: [plan.unlockData, plan.deadline],
      });
    } catch (cause) {
      setError(txMessage(cause, "Could not claim fees."));
    } finally {
      setClaiming(null);
    }
  };

  const remove = async () => {
    if (!reviewed || !address) return;
    setError(null);
    try {
      const fresh = await refreshUserLpPosition(pool, reviewed.position.tokenId, address);
      if (fresh.liquidity < reviewed.position.liquidity) {
        throw new Error("This position changed. Review its current return before removing it.");
      }
      await writeContractAsync({
        chainId: Number(state.chainId),
        address: positionManager,
        abi: POSITION_MANAGER_ABI,
        functionName: "modifyLiquidities",
        // The reviewed minimums live in `unlockData` and stay frozen; only the
        // deadline is re-stamped, so a slow review can't ship an already-expired
        // window.
        args: [reviewed.plan.unlockData, lpDeadline(isSafeConnection(wagmiConfig))],
      });
    } catch (cause) {
      setError(txMessage(cause, "Could not remove liquidity."));
    }
  };

  return (
    <div className="mt-3 border-t border-zinc-100 pt-3">
      <div className="text-xs font-medium text-zinc-600">Your liquidity</div>
      {!address ? (
        <p className="mt-1 text-xs text-zinc-400">Connect a wallet to manage its LP positions.</p>
      ) : positions.isLoading ? (
        <p className="mt-1 text-xs text-zinc-400">Reading your positions…</p>
      ) : positions.isError ? (
        <p className="mt-1 text-xs text-red-600">
          Could not verify the complete position history. Nothing has been hidden as an empty
          result.
        </p>
      ) : !positions.data?.length ? (
        <p className="mt-1 text-xs text-zinc-400">
          No positions owned by this wallet in this pool.
        </p>
      ) : (
        <div className="mt-2 space-y-2">
          {positions.data.map((position) => (
            <div
              key={position.tokenId.toString()}
              className="flex flex-wrap items-center justify-between gap-2 border border-zinc-100 p-2 text-xs"
            >
              <span>
                #{position.tokenId.toString()} | {fmtUnits(position.tokenAmount, 18)} {tokenSymbol}{" "}
                + {fmtUnits(position.pairAmount, pool.pair.decimals)} {pool.pair.symbol}
                <span className="block text-zinc-500">
                  {(() => {
                    const owed = fees.data?.[position.tokenId.toString()];
                    if (fees.isLoading || owed === undefined) return "unclaimed fees: reading…";
                    if (!owed) return "unclaimed fees: unavailable on this chain";
                    if (owed.pairFees <= 0n && owed.tokenFees <= 0n)
                      return "unclaimed fees: none yet";
                    return `unclaimed fees: ${fmtUnits(owed.tokenFees, 18)} ${tokenSymbol} + ${fmtUnits(owed.pairFees, pool.pair.decimals)} ${pool.pair.symbol}`;
                  })()}
                </span>
                {(() => {
                  // The pool forgets what a position already took, so lifetime is
                  // only knowable where the index has been accumulating it.
                  const owed = fees.data?.[position.tokenId.toString()];
                  if (position.claimedPairFees === undefined || !owed) return null;
                  const lifetimeToken = position.claimedTokenFees! + owed.tokenFees;
                  const lifetimePair = position.claimedPairFees + owed.pairFees;
                  if (lifetimeToken <= 0n && lifetimePair <= 0n) return null;
                  return (
                    <span className="block text-zinc-500">
                      lifetime fees: {fmtUnits(lifetimeToken, 18)} {tokenSymbol} +{" "}
                      {fmtUnits(lifetimePair, pool.pair.decimals)} {pool.pair.symbol}
                    </span>
                  );
                })()}
              </span>
              <span className="flex gap-2">
                <button
                  type="button"
                  className="border border-zinc-300 px-2 py-1 hover:bg-zinc-50 disabled:opacity-50"
                  disabled={(() => {
                    const owed = fees.data?.[position.tokenId.toString()];
                    return (
                      isPending ||
                      claiming !== null ||
                      refreshing !== null ||
                      reviewed !== null ||
                      !owed ||
                      (owed.pairFees <= 0n && owed.tokenFees <= 0n)
                    );
                  })()}
                  onClick={() => void claimFees(position)}
                >
                  {claiming === position.tokenId ? "Claiming…" : "Claim fees"}
                </button>
                <button
                  type="button"
                  className="border border-zinc-300 px-2 py-1 hover:bg-zinc-50 disabled:opacity-50"
                  disabled={isPending || refreshing !== null || reviewed !== null}
                  onClick={() => void beginReview(position)}
                >
                  {refreshing === position.tokenId ? "Refreshing…" : "Remove"}
                </button>
              </span>
            </div>
          ))}
        </div>
      )}
      {reviewed ? (
        <div className="mt-2 border border-amber-200 bg-amber-50 p-2 text-xs text-zinc-700">
          <p>
            Burn position #{reviewed.position.tokenId.toString()} for at least{" "}
            {fmtUnits(reviewed.plan.tokenMinimum, 18)} {tokenSymbol} +{" "}
            {fmtUnits(reviewed.plan.pairMinimum, pool.pair.decimals)} {pool.pair.symbol}.
          </p>
          <p className="mt-1 text-zinc-500">
            These 95% minimums are sent in the exact burn call; a larger adverse move reverts.
          </p>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              className="bg-zinc-900 px-2 py-1 text-white disabled:opacity-50"
              disabled={isPending}
              onClick={() => void remove()}
            >
              {isPending ? "Submitting…" : "Confirm & remove"}
            </button>
            <button
              type="button"
              className="border border-zinc-300 px-2 py-1"
              disabled={isPending}
              onClick={() => setReviewed(null)}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}
      {receipt.isSuccess ? (
        <p className="mt-2 text-xs text-green-700">Liquidity removal confirmed.</p>
      ) : null}
      {error ? (
        <p className="mt-2 wrap-anywhere text-xs text-red-600" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/**
 * The project's buyback-hook Uniswap V4 pool per chain: live price, exact pool
 * reserves (net LP ranges valued at the current price), and the PoolManager
 * explorer link. The pool is keyed by (projectId, PAIR/accounting token) — a
 * USDC project's pool is only found by passing its USDC context, never a
 * hardcoded native token.
 */
export function AmmCard({ chains, tokenSymbol }: { chains: ChainProject[]; tokenSymbol: string }) {
  const { data, isLoading, isError, isFetching } = useQuery(
    cachedQuery({
      queryKey: ["v6AmmStates", chainProjectsKey(chains)],
      enabled: chains.length > 0,
      staleTime: 60_000,
      queryFn: () => fetchAmmStates(chains),
    }),
  );

  const anyHook = data?.some((s) => s.hook) ?? false;

  const content = (kind: "market" | "liquidity") => {
    if (isLoading) return <SkeletonLines lines={Math.max(chains.length, 2)} className="py-3" />;
    if (isError || !data) {
      return <div className="py-3 text-sm text-zinc-500">Could not read the buyback pool.</div>;
    }
    if (!anyHook) {
      return (
        <div className="py-3 text-sm text-zinc-400">
          No buyback hook configured — there is no project-owned AMM pool to show.
        </div>
      );
    }
    return data.map((state) =>
      kind === "market" ? (
        <MarketChainRow
          key={state.chainId}
          state={state}
          tokenSymbol={tokenSymbol}
          pending={isFetching}
        />
      ) : (
        <LiquidityChainRow key={state.chainId} state={state} tokenSymbol={tokenSymbol} />
      ),
    );
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="border border-teal-200 bg-teal-50 p-4">
        <h3 className="font-medium text-zinc-900">
          Pool <span className="ml-1 text-xs uppercase tracking-wide text-zinc-400">AMM</span>
        </h3>
        <p className="mt-1 text-sm text-zinc-500">
          The market fills orders that would give payers more {tokenSymbol} than issuance. Arbitrage
          keeps its price between the issuance ceiling and the cash-out floor.
        </p>
        <div className="mt-2">{content("market")}</div>
      </div>

      <div className="border border-teal-200 bg-teal-50 p-4">
        <h3 className="font-medium text-zinc-900">Liquidity</h3>
        <p className="mt-1 text-sm text-zinc-500">
          The tokens currently pooled across the market&apos;s active price ranges.
        </p>
        <div className="mt-2">{content("liquidity")}</div>
      </div>
    </div>
  );
}
