"use client";

import {
  uniswapV4AmountsForLiquidity,
  uniswapV4SqrtPriceX96AtTick,
} from "@bananapus/nana-sdk-core/v6";
import { ChainLogo } from "@/components/ChainLogo";
import { Revalidating } from "@/components/ui/Revalidating";
import { cachedQuery } from "@/lib/query-persist";
import { EthereumAddress } from "@/components/EthereumAddress";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ParticipantsPieChart } from "@/app/[slug]/owners/components/ParticipantsPieChart";
import { SkeletonLines } from "@/components/ui/skeleton";
import { useAllowance } from "@/hooks/useAllowance";
import {
  submittedViaSafe,
  useWaitForTransactionReceipt,
  useWriteContract,
} from "@/hooks/useReviewedWriteContract";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { erc20Abi, formatUnits, parseUnits, zeroAddress, type Address, type PublicClient } from "viem";
import { useAccount, usePublicClient } from "wagmi";
import {
  chainName,
  ChainProject,
  chainProjectsKey,
  explorerAddressUrl,
  fmtUnits,
} from "../settlement/lib";
import {
  AmmChainState,
  encodeAddLiquidityCall,
  fetchAmmStates,
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
            <text
              x={Math.max(18, Math.min(DEPTH_WIDTH - 18, model.depth.priceX)).toFixed(1)}
              y="13"
              fontSize="8"
              fill="#71717a"
              textAnchor="middle"
            >
              price
            </text>
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

export function AddLiquidityForm({
  state,
  tokenSymbol,
}: {
  state: AmmChainState;
  tokenSymbol: string;
}) {
  const { address } = useAccount();
  const chainId = Number(state.chainId);
  const publicClient = usePublicClient({ chainId });
  const { ensureAllowance, isApproving } = useAllowance(chainId);
  const { writeContractAsync, isPending } = useWriteContract();
  const [minimumPrice, setMinimumPrice] = useState("");
  const [maximumPrice, setMaximumPrice] = useState("");
  const [pairAmount, setPairAmount] = useState("");
  const [tokenAmount, setTokenAmount] = useState("");
  const [reviewed, setReviewed] = useState<{
    plan: AddLiquidityPlan;
    snapshot: string;
  } | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const pool = state.pool;

  useEffect(() => {
    if (!pool?.price || pool.price <= 0) return;
    setMinimumPrice(String(Number((pool.price * 0.5).toPrecision(6))));
    setMaximumPrice(String(Number((pool.price * 2).toPrecision(6))));
    setReviewed(null);
  }, [pool?.poolId, pool?.price]);

  if (!pool || !POSITION_MANAGER_BY_CHAIN[chainId]) return null;

  const snapshot = [minimumPrice, maximumPrice, pairAmount, tokenAmount].join("|");
  const review = reviewed?.snapshot === snapshot ? reviewed.plan : null;
  const prepare = async () => {
    if (!address || !publicClient) {
      setStatus("Connect a wallet first.");
      return;
    }
    setBusy(true);
    setStatus("Reading fresh pool and wallet balances…");
    try {
      const pairRaw = pairAmount ? parseUnits(pairAmount, pool.pair.decimals) : 0n;
      const tokenRaw = tokenAmount ? parseUnits(tokenAmount, 18) : 0n;
      const plan = prepareAddLiquidity(
        pool,
        { pairAmount: pairRaw, tokenAmount: tokenRaw },
        {
          minimumPrice: Number(minimumPrice),
          maximumPrice: Number(maximumPrice),
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
      if (plan.tokenMaximum > tokenBalance) {
        throw new Error(`The reviewed maximum exceeds your ${tokenSymbol} balance.`);
      }
      if (plan.pairMaximum > pairBalance) {
        throw new Error(`The reviewed maximum exceeds your ${pool.pair.symbol} balance.`);
      }
      setReviewed({ plan, snapshot });
      setStatus(null);
    } catch (cause) {
      setReviewed(null);
      setStatus(cause instanceof Error ? cause.message : "Could not prepare liquidity.");
    } finally {
      setBusy(false);
    }
  };

  const execute = async () => {
    if (!address || !publicClient || !review) return;
    setBusy(true);
    setStatus("Checking token authorizations…");
    try {
      for (const side of review.erc20Sides) {
        await ensureAllowance(side.currency, PERMIT2_ADDRESS, side.max);
        const covered = await permit2AllowanceCovers(
          state.chainId,
          address,
          side.currency,
          side.max,
        );
        if (!covered) {
          const approvalArgs = permit2ApprovalArgs(state.chainId, side.currency, side.max);
          const approvalHash = await writeContractAsync({
            chainId,
            address: PERMIT2_ADDRESS,
            abi: PERMIT2_ABI,
            functionName: "approve",
            args: approvalArgs,
          });
          if (submittedViaSafe(approvalHash)) {
            setStatus(
              "Permit2 authorization was proposed to Safe. Execute it, then review liquidity again.",
            );
            setReviewed(null);
            return;
          }
          const receipt = await publicClient.waitForTransactionReceipt({ hash: approvalHash });
          if (receipt.status !== "success") {
            throw new Error(`Permit2 authorization ${approvalHash} reverted.`);
          }
        }
      }
      setStatus("Re-checking the pool price…");
      await reverifyAddLiquidity(pool, review);
      const call = encodeAddLiquidityCall(review);
      const hash = await writeContractAsync({
        chainId,
        address: POSITION_MANAGER_BY_CHAIN[chainId]!,
        abi: POSITION_MANAGER_ABI,
        functionName: "modifyLiquidities",
        args: call.args,
        value: review.value,
      });
      if (submittedViaSafe(hash)) {
        setStatus("Liquidity mint was proposed to Safe and awaits approvals and execution.");
        setReviewed(null);
        return;
      }
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") throw new Error(`Liquidity mint ${hash} reverted.`);
      setStatus("Liquidity added successfully.");
      setReviewed(null);
      setPairAmount("");
      setTokenAmount("");
    } catch (cause) {
      setStatus(cause instanceof Error ? cause.message : "Could not add liquidity.");
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
      <LiquidityRangePreview
        floor={state.reference.cashOut}
        ceiling={state.reference.issuance}
        current={pool.price}
        minimum={Number(minimumPrice)}
        maximum={Number(maximumPrice)}
        pairSymbol={pool.pair.symbol}
        tokenSymbol={tokenSymbol}
      />
      <div className="mt-2 grid grid-cols-2 gap-2">
        <label className="text-[11px] text-zinc-500">
          Min price
          <input
            className="mt-1 w-full border border-zinc-200 px-2 py-1.5 text-xs"
            type="number"
            min="0"
            value={minimumPrice}
            disabled={disabled}
            onChange={(event) => {
              setMinimumPrice(event.target.value);
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
            value={maximumPrice}
            disabled={disabled}
            onChange={(event) => {
              setMaximumPrice(event.target.value);
              setReviewed(null);
            }}
          />
        </label>
        <label className="text-[11px] text-zinc-500">
          {tokenSymbol}
          <input
            className="mt-1 w-full border border-zinc-200 px-2 py-1.5 text-xs"
            type="number"
            min="0"
            placeholder="0"
            value={tokenAmount}
            disabled={disabled}
            onChange={(event) => {
              setTokenAmount(event.target.value);
              setReviewed(null);
            }}
          />
        </label>
        <label className="text-[11px] text-zinc-500">
          {pool.pair.symbol}
          <input
            className="mt-1 w-full border border-zinc-200 px-2 py-1.5 text-xs"
            type="number"
            min="0"
            placeholder="0"
            value={pairAmount}
            disabled={disabled}
            onChange={(event) => {
              setPairAmount(event.target.value);
              setReviewed(null);
            }}
          />
        </label>
      </div>
      {review ? (
        <div className="mt-2 border border-amber-200 bg-amber-50 p-2 text-xs text-zinc-700">
          <p>
            Mint ticks {review.tickLower} → {review.tickUpper}, using at most{" "}
            {fmtUnits(review.tokenMaximum, 18)} {tokenSymbol} +{" "}
            {fmtUnits(review.pairMaximum, pool.pair.decimals)} {pool.pair.symbol}.
          </p>
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
          disabled={disabled || !address}
          onClick={() => void prepare()}
        >
          {disabled ? "Checking…" : address ? "Review add liquidity" : "Connect to add liquidity"}
        </button>
      )}
      {status ? (
        <p className="mt-2 text-xs text-zinc-500" role="status">
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
  const pool = state.pool;
  const positionManager = POSITION_MANAGER_BY_CHAIN[Number(state.chainId)];
  const [reviewed, setReviewed] = useState<{
    position: UserLpPosition;
    plan: ReturnType<typeof prepareRemoveLiquidity>;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState<bigint | null>(null);
  const [claiming, setClaiming] = useState<bigint | null>(null);
  const client = usePublicClient({ chainId: Number(state.chainId) }) as
    | PublicClient
    | undefined;
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
        plan: prepareRemoveLiquidity(pool, fresh, address),
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not refresh this position.");
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
      const plan = prepareCollectLpFees(pool, position, address);
      await writeContractAsync({
        chainId: Number(state.chainId),
        address: positionManager,
        abi: POSITION_MANAGER_ABI,
        functionName: "modifyLiquidities",
        args: [plan.unlockData, plan.deadline],
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not claim fees.");
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
        args: [reviewed.plan.unlockData, reviewed.plan.deadline],
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not remove liquidity.");
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
                #{position.tokenId.toString()} · {fmtUnits(position.tokenAmount, 18)} {tokenSymbol}{" "}
                + {fmtUnits(position.pairAmount, pool.pair.decimals)} {pool.pair.symbol}
                <span className="block text-zinc-500">
                  {(() => {
                    const owed = fees.data?.[position.tokenId.toString()];
                    if (fees.isLoading || owed === undefined) return "unclaimed fees: reading…";
                    if (!owed) return "unclaimed fees: unavailable on this chain";
                    if (owed.pairFees <= 0n && owed.tokenFees <= 0n) return "unclaimed fees: none yet";
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
        <p className="mt-2 text-xs text-red-600" role="alert">
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
          The market fills orders that would give payers more {tokenSymbol} than issuance.
          Arbitrage keeps its price between the issuance ceiling and the cash-out floor.
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
