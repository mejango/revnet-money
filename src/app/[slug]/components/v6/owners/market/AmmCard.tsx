"use client";

import { ChainLogo } from "@/components/ChainLogo";
import { SkeletonLines } from "@/components/ui/skeleton";
import { useWaitForTransactionReceipt, useWriteContract } from "@/hooks/useReviewedWriteContract";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useAccount } from "wagmi";
import {
  chainName,
  ChainProject,
  chainProjectsKey,
  explorerAddressUrl,
  fmtUnits,
} from "../settlement/lib";
import {
  AmmChainState,
  fetchAmmStates,
  POSITION_MANAGER_ABI,
  POSITION_MANAGER_BY_CHAIN,
  prepareRemoveLiquidity,
  readUserLpPositions,
  refreshUserLpPosition,
  type UserLpPosition,
} from "./lib";

function formatPrice(price: number): string {
  if (!isFinite(price) || price <= 0) return "—";
  if (price < 0.0001) return price.toExponential(2);
  return Intl.NumberFormat("en", { maximumFractionDigits: price >= 1 ? 4 : 8 }).format(price);
}

function AmmChainRow({ state, tokenSymbol }: { state: AmmChainState; tokenSymbol: string }) {
  const { pool, composition } = state;
  const explorer = pool ? explorerAddressUrl(state.chainId, pool.poolManager) : null;
  return (
    <div className="border-b border-zinc-50 py-3 last:border-b-0">
      <div className="flex items-center gap-2 text-sm font-medium text-zinc-900">
        <ChainLogo chainId={state.chainId} width={16} height={16} />
        {chainName(state.chainId)}
      </div>
      {!state.hook ? (
        <p className="text-sm text-zinc-400 mt-1">No buyback hook configured on this chain.</p>
      ) : !pool ? (
        <p className="text-sm text-zinc-400 mt-1">
          Buyback hook configured, but its pool is not initialized yet.
        </p>
      ) : (
        <div className="mt-2 text-sm text-zinc-700 space-y-1">
          <div>
            <span className="text-zinc-400">Price</span>{" "}
            {pool.price == null
              ? "—"
              : `${formatPrice(pool.price)} ${pool.pair.symbol}/${tokenSymbol}`}
          </div>
          <div>
            <span className="text-zinc-400">Composition</span>{" "}
            {composition == null ? (
              <span className="text-zinc-400">
                unavailable (the RPC could not return the complete pool history)
              </span>
            ) : (
              <>
                {fmtUnits(composition.tokenAmount, 18)} {tokenSymbol} +{" "}
                {fmtUnits(composition.pairAmount, pool.pair.decimals)} {pool.pair.symbol}
              </>
            )}
          </div>
          <div className="text-xs text-zinc-400">
            Uniswap V4 pool (fee {pool.key.fee / 10_000}%) held by the{" "}
            {explorer ? (
              <a
                href={explorer}
                target="_blank"
                rel="noopener noreferrer"
                className="underline decoration-dotted hover:text-zinc-600"
              >
                PoolManager ↗
              </a>
            ) : (
              "PoolManager"
            )}
          </div>
          <LiquidityManager state={state} tokenSymbol={tokenSymbol} />
        </div>
      )}
    </div>
  );
}

function LiquidityManager({ state, tokenSymbol }: { state: AmmChainState; tokenSymbol: string }) {
  const { address } = useAccount();
  const pool = state.pool;
  const positionManager = POSITION_MANAGER_BY_CHAIN[Number(state.chainId)];
  const [reviewed, setReviewed] = useState<{
    position: UserLpPosition;
    plan: ReturnType<typeof prepareRemoveLiquidity>;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState<bigint | null>(null);
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

  useEffect(() => {
    if (receipt.isSuccess) {
      setReviewed(null);
      void positions.refetch();
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
              </span>
              <button
                type="button"
                className="border border-zinc-300 px-2 py-1 hover:bg-zinc-50 disabled:opacity-50"
                disabled={isPending || refreshing !== null || reviewed !== null}
                onClick={() => void beginReview(position)}
              >
                {refreshing === position.tokenId ? "Refreshing…" : "Remove"}
              </button>
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
  const { data, isLoading, isError } = useQuery({
    queryKey: ["v6AmmStates", chainProjectsKey(chains)],
    enabled: chains.length > 0,
    staleTime: 60_000,
    queryFn: () => fetchAmmStates(chains),
  });

  const anyHook = data?.some((s) => s.hook) ?? false;

  return (
    <div className="border border-zinc-200 bg-white p-4">
      <h3 className="font-medium text-zinc-900">
        Market <span className="text-xs uppercase tracking-wide text-zinc-400 ml-1">AMM</span>
      </h3>
      <p className="text-sm text-zinc-500 mt-1">
        The market is used to fill orders that give payers more {tokenSymbol} than issuance would.
      </p>
      <div className="mt-2">
        {isLoading ? (
          <SkeletonLines lines={Math.max(chains.length, 2)} className="py-3" />
        ) : isError || !data ? (
          <div className="text-sm text-zinc-500 py-3">Could not read the buyback pool.</div>
        ) : !anyHook ? (
          <div className="text-sm text-zinc-400 py-3">
            No buyback hook configured — payments always mint at the issuance rate, and there is no
            project-owned AMM pool to show.
          </div>
        ) : (
          data.map((state) => (
            <AmmChainRow key={state.chainId} state={state} tokenSymbol={tokenSymbol} />
          ))
        )}
      </div>
    </div>
  );
}
