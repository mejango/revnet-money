"use client";

import { ChainLogo } from "@/components/ChainLogo";
import { SkeletonLines } from "@/components/ui/skeleton";
import { useAllowance } from "@/hooks/useAllowance";
import {
  submittedViaSafe,
  useWaitForTransactionReceipt,
  useWriteContract,
} from "@/hooks/useReviewedWriteContract";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { erc20Abi, parseUnits, zeroAddress } from "viem";
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
  prepareRemoveLiquidity,
  readUserLpPositions,
  refreshUserLpPosition,
  reverifyAddLiquidity,
  type AddLiquidityPlan,
  type UserLpPosition,
} from "./lib";

function formatPrice(price: number): string {
  if (!isFinite(price) || price <= 0) return "—";
  if (price < 0.0001) return price.toExponential(2);
  return Intl.NumberFormat("en", { maximumFractionDigits: price >= 1 ? 4 : 8 }).format(price);
}

function MarketChainRow({ state, tokenSymbol }: { state: AmmChainState; tokenSymbol: string }) {
  const { pool } = state;
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
        </div>
      )}
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
        <div className="mt-2 text-sm text-zinc-700">
          <span className="text-zinc-400">Composition</span> {fmtUnits(composition.tokenAmount, 18)}{" "}
          {tokenSymbol} + {fmtUnits(composition.pairAmount, pool.pair.decimals)} {pool.pair.symbol}
        </div>
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
        <MarketChainRow key={state.chainId} state={state} tokenSymbol={tokenSymbol} />
      ) : (
        <LiquidityChainRow key={state.chainId} state={state} tokenSymbol={tokenSymbol} />
      ),
    );
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="border border-zinc-200 bg-white p-4">
        <h3 className="font-medium text-zinc-900">
          Market <span className="ml-1 text-xs uppercase tracking-wide text-zinc-400">AMM</span>
        </h3>
        <p className="mt-1 text-sm text-zinc-500">
          The market is used to fill orders that give payers more {tokenSymbol} than issuance would.
        </p>
        <div className="mt-2">{content("market")}</div>
      </div>

      <div className="border border-zinc-200 bg-white p-4">
        <h3 className="font-medium text-zinc-900">Liquidity</h3>
        <p className="mt-1 text-sm text-zinc-500">
          The tokens currently pooled across the market&apos;s active price ranges.
        </p>
        <div className="mt-2">{content("liquidity")}</div>
      </div>
    </div>
  );
}
