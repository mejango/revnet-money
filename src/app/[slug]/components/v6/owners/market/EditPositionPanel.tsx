"use client";

import { TxSteps } from "@/components/ui/TxSteps";
import { useAllowance } from "@/hooks/useAllowance";
import {
  isSafeConnection,
  submittedViaSafe,
  useWriteContract,
} from "@/hooks/useReviewedWriteContract";
import { waitForReceiptWithRetry } from "@/lib/waitForReceipt";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useRef, useState } from "react";
import { erc20Abi, formatUnits, parseUnits, zeroAddress, type Address, type Hex } from "viem";
import { useAccount, useConfig, usePublicClient } from "wagmi";
import { chainName, fmtUnits } from "../settlement/lib";
import { describeEditLiquidityPlan } from "./formView";
import {
  lpBandPrices,
  lpDeadline,
  PERMIT2_ABI,
  PERMIT2_ADDRESS,
  permit2AllowanceCovers,
  permit2ApprovalArgs,
  POSITION_MANAGER_ABI,
  POSITION_MANAGER_BY_CHAIN,
  prepareEditLiquidity,
  refreshPoolAndPosition,
  reverifyEditLiquidity,
  solveRangeFromAmounts,
  type AmmChainState,
  type EditLiquidityPlan,
  type PoolSnapshot,
  type UserLpPosition,
} from "./lib";
import { LiquidityRangePreview } from "./LiquidityRangePreview";

/** A wallet prompt this edit will raise, decided while reviewing so the signer sees the whole queue first. */
type EditStep = {
  title: string;
  detail: string;
  approval?: { kind: "erc20" | "permit2"; currency: Address; max: bigint };
};

const FINAL_STEP: Record<EditLiquidityPlan["kind"], { title: string; detail: string }> = {
  increase: {
    title: "Increase the position",
    detail: "Adds to the same position; its id does not change.",
  },
  decrease: {
    title: "Decrease the position",
    detail: "Frees part of the position back to your wallet.",
  },
  move: {
    title: "Move the position",
    detail: "Burns this position and mints the new one in a single transaction.",
  },
  remove: {
    title: "Remove the position",
    detail: "Burns the position and returns both sides to your wallet.",
  },
};

function txMessage(cause: unknown, fallback: string): string {
  const error = cause as { shortMessage?: string; message?: string } | null;
  return error?.shortMessage || error?.message || fallback;
}

function formatPrice(price: number): string {
  if (!Number.isFinite(price) || price <= 0) return "—";
  return String(Number(price.toPrecision(6)));
}

/** A holding prefilled as editable text at full precision, so an untouched
 *  field targets exactly what the position holds. */
function holdingText(amount: bigint, decimals: number): string {
  return formatUnits(amount, decimals);
}

/**
 * One position's edit form: what it should hold and, optionally, a new band.
 * Amounts are ceilings — the band and the current price fix the ratio, so the
 * review states exactly what the position ends up holding and what moves in
 * or out of the wallet. Approvals a top-up needs are queued ahead of the edit
 * itself, and the plan is re-sized from a fresh pool read at review time and
 * re-checked against the live price right before the wallet asks.
 */
export function EditPositionPanel({
  state,
  pool,
  position,
  tokenSymbol,
  onClose,
  onDone,
}: {
  state: AmmChainState;
  pool: PoolSnapshot;
  position: UserLpPosition;
  tokenSymbol: string;
  onClose: () => void;
  /** Called once the edit has landed (or been proposed to a Safe). */
  onDone: (hash: Hex | null) => void;
}) {
  const { address } = useAccount();
  const wagmiConfig = useConfig();
  const chainId = Number(state.chainId);
  const publicClient = usePublicClient({ chainId });
  const queryClient = useQueryClient();
  const { ensureAllowance } = useAllowance(chainId);
  const positionManager = POSITION_MANAGER_BY_CHAIN[chainId]!;
  const band = lpBandPrices(pool, position.tickLower, position.tickUpper);

  const [minText, setMinText] = useState(formatPrice(band.minimumPrice));
  const [maxText, setMaxText] = useState(formatPrice(band.maximumPrice));
  // Only a band the user actually changed re-mints; otherwise the position's
  // own ticks are kept exactly, never re-derived from rounded display prices.
  const [rangeTouched, setRangeTouched] = useState(false);
  const [tokenText, setTokenText] = useState(holdingText(position.tokenAmount, 18));
  const [pairText, setPairText] = useState(holdingText(position.pairAmount, pool.pair.decimals));
  const [reviewed, setReviewed] = useState<{
    pool: PoolSnapshot;
    plan: EditLiquidityPlan;
    steps: EditStep[];
    snapshot: string;
  } | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [stepIndex, setStepIndex] = useState(0);
  const [busy, setBusy] = useState(false);

  // The plan is built while reviewing, so the confirm modal's copy comes from
  // this MUTATED object — the hook reads it when the modal opens.
  const review = useRef({
    title: "Review position edit",
    confirmLabel: "Agree & edit position",
    description: "",
  });
  const activePlan = useRef<{ pool: PoolSnapshot; plan: EditLiquidityPlan } | null>(null);
  const { writeContractAsync } = useWriteContract({
    transactionReview: review.current,
    // Runs AFTER the confirm modal, so however long it sat open, a changed
    // position or drift beyond the reviewed maxima still aborts first.
    reverify: async () => {
      if (activePlan.current && address) {
        await reverifyEditLiquidity(activePlan.current.pool, activePlan.current.plan, address);
      }
    },
  });

  const balances = useQuery({
    queryKey: ["v6LpEditBalances", chainId, pool.projectToken, pool.pair.addr, address],
    enabled: !!address && !!publicClient,
    queryFn: async () => {
      const [token, pair] = await Promise.all([
        publicClient!.readContract({
          address: pool.projectToken,
          abi: erc20Abi,
          functionName: "balanceOf",
          args: [address!],
        }),
        pool.pair.addr === zeroAddress
          ? publicClient!.getBalance({ address: address! })
          : publicClient!.readContract({
              address: pool.pair.addr,
              abi: erc20Abi,
              functionName: "balanceOf",
              args: [address!],
            }),
      ]);
      return { token, pair };
    },
  });

  const snapshot = [minText, maxText, rangeTouched, tokenText, pairText].join("|");
  const current = reviewed?.snapshot === snapshot ? reviewed : null;
  const editing = busy || current !== null;

  const parseSide = (text: string, decimals: number, symbol: string): bigint =>
    parseAmountText(text, decimals, symbol);

  // What the typed targets actually produce at this band and price, computed
  // locally as they type. The band and price fix the ratio, so one side is
  // usually the binding one and the other is capped — say so before Review,
  // and offer the band that would use both amounts in full.
  const preview = useMemo(() => {
    let tokenAmount: bigint;
    let pairAmount: bigint;
    try {
      tokenAmount = parseAmountText(tokenText, 18, tokenSymbol);
      pairAmount = parseAmountText(pairText, pool.pair.decimals, pool.pair.symbol);
    } catch {
      return null;
    }
    const minimumPrice = Number(minText);
    const maximumPrice = Number(maxText);
    if (rangeTouched && (!(minimumPrice > 0) || !(maximumPrice > minimumPrice))) return null;
    try {
      const plan = prepareEditLiquidity(
        pool,
        position,
        { pairAmount, tokenAmount },
        rangeTouched ? { minimumPrice, maximumPrice } : null,
        address ?? zeroAddress,
      );
      return { plan, tokenAmount, pairAmount };
    } catch {
      return null;
    }
  }, [tokenText, pairText, minText, maxText, rangeTouched, pool, position, address, tokenSymbol]);
  const cappedRaw = preview ? cappedSide(preview, pool.pair.decimals) : null;
  const capped = cappedRaw
    ? { ...cappedRaw, binding: cappedRaw.side === "token" ? pool.pair.symbol : tokenSymbol }
    : null;

  const fitBand = () => {
    if (!preview || !pool.price) return;
    const solved = solveRangeFromAmounts({
      price: pool.price,
      tokenAmount: Number(formatUnits(preview.tokenAmount, 18)),
      pairAmount: Number(formatUnits(preview.pairAmount, pool.pair.decimals)),
      floorHint: state.reference.cashOut,
      ceilingHint: state.reference.issuance,
    });
    if (!solved) return;
    setMinText(formatPrice(solved.minPrice));
    setMaxText(formatPrice(solved.maxPrice));
    setRangeTouched(true);
    setReviewed(null);
  };

  const prepare = async () => {
    if (!address || !publicClient) {
      setStatus("Connect a wallet first.");
      return;
    }
    setBusy(true);
    setStepIndex(0);
    setStatus("Reading the live pool, position and wallet balances…");
    try {
      const tokenAmount = parseSide(tokenText, 18, tokenSymbol);
      const pairAmount = parseSide(pairText, pool.pair.decimals, pool.pair.symbol);
      let range: { minimumPrice: number; maximumPrice: number } | null = null;
      if (rangeTouched) {
        const minimumPrice = Number(minText);
        const maximumPrice = Number(maxText);
        if (!(minimumPrice > 0) || !(maximumPrice > minimumPrice)) {
          throw new Error("Set a valid positive price range.");
        }
        range = { minimumPrice, maximumPrice };
      }
      const fresh = await refreshPoolAndPosition(pool, position.tokenId, address);
      const plan = prepareEditLiquidity(
        fresh.pool,
        fresh.position,
        { pairAmount, tokenAmount },
        range,
        address,
      );
      const held = balances.data ?? (await balances.refetch()).data;
      if (!held) throw new Error("Could not read your wallet balances.");
      // Gate on what the pool actually pulls, not on the maxima: those carry
      // 1% price headroom that only gets spent if the price moves.
      if (plan.tokenFlow > held.token) {
        throw new Error(`That's more ${tokenSymbol} than your balance.`);
      }
      if (plan.pairFlow > held.pair) {
        throw new Error(`That's more ${pool.pair.symbol} than your balance.`);
      }
      const symbolOf = (currency: Address) =>
        currency.toLowerCase() === pool.projectToken.toLowerCase() ? tokenSymbol : pool.pair.symbol;
      const approvals: EditStep[] = [];
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
        pool: fresh.pool,
        plan,
        steps: [...approvals, FINAL_STEP[plan.kind]],
        snapshot,
      });
      const tight = [
        plan.tokenFunding > held.token ? tokenSymbol : null,
        plan.pairFunding > held.pair ? pool.pair.symbol : null,
      ].filter((symbol): symbol is string => symbol != null);
      setStatus(
        tight.length
          ? `Heads up: your ${tight.join(" and ")} balance does not cover the 1% price headroom, ` +
              `so this edit reverts if the price moves against it. Lower the amount to be safe.`
          : null,
      );
    } catch (cause) {
      setReviewed(null);
      setStatus(txMessage(cause, "Could not prepare this edit."));
    } finally {
      setBusy(false);
    }
  };

  const execute = async () => {
    if (!address || !publicClient || !current) return;
    const { plan, steps } = current;
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
              "Permit2 authorization was proposed to Safe. Execute it, then review the edit again.",
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
        activePlan.current = { pool: current.pool, plan };
        review.current.description = planCopy(current.pool, plan, tokenSymbol).join("\n\n");
        const hash = await writeContractAsync({
          chainId,
          address: positionManager,
          abi: POSITION_MANAGER_ABI,
          functionName: "modifyLiquidities",
          // Everything that touches funds is frozen inside unlockData; only
          // the deadline is stamped at send time.
          args: [plan.unlockData, lpDeadline(isSafeConnection(wagmiConfig))],
          value: plan.value,
        });
        if (submittedViaSafe(hash)) {
          setStatus("The edit was proposed to Safe and awaits approvals and execution.");
          setReviewed(null);
          onDone(null);
          return;
        }
        const receipt = await waitForReceiptWithRetry(publicClient, hash);
        if (receipt.status !== "success") throw new Error(`Position edit ${hash} reverted.`);
        setStepIndex(steps.length);
        await queryClient.invalidateQueries({ queryKey: ["revnetPoolLpProviders"] });
        onDone(hash);
      }
    } catch (cause) {
      setStatus(txMessage(cause, "Could not edit this position."));
    } finally {
      setBusy(false);
    }
  };

  const copy = current ? planCopy(current.pool, current.plan, tokenSymbol) : null;
  const inWallet = (amount: bigint | undefined, decimals: number, symbol: string) =>
    amount == null ? null : (
      <span className="mt-1 block text-right text-zinc-400">
        {fmtUnits(amount, decimals)} {symbol} in wallet
      </span>
    );

  return (
    <div className="mt-2 border border-zinc-200 p-2 text-xs text-zinc-700">
      <p className="font-medium">
        Edit position #{position.tokenId.toString()} on {chainName(state.chainId)}
      </p>
      <p className="mt-1 text-zinc-500">
        Set what this position should hold and the band it covers. Anything added comes from your
        wallet and anything freed returns to it, with unclaimed fees, in one transaction. The band
        and the current price fix the ratio, so amounts are ceilings. Changing the band burns this
        position and mints a new one; if the price moves too far before it lands, the whole edit
        reverts and the position stays as it is.
      </p>
      <LiquidityRangePreview
        floor={state.reference.cashOut}
        ceiling={state.reference.issuance}
        current={pool.price}
        minimum={Number(minText) || 0}
        maximum={Number(maxText) || 0}
        pairSymbol={pool.pair.symbol}
        tokenSymbol={tokenSymbol}
        onRangeChange={
          editing
            ? undefined
            : (edge, value) => {
                (edge === "minimum" ? setMinText : setMaxText)(String(value));
                setRangeTouched(true);
              }
        }
      />
      <div className="mt-2 grid grid-cols-2 gap-2">
        <label className="text-[11px] text-zinc-500">
          Min price
          <input
            className="mt-1 w-full border border-zinc-200 px-2 py-1.5 text-xs"
            type="number"
            min="0"
            value={minText}
            disabled={editing}
            onChange={(event) => {
              setMinText(event.target.value);
              setRangeTouched(true);
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
            disabled={editing}
            onChange={(event) => {
              setMaxText(event.target.value);
              setRangeTouched(true);
            }}
          />
        </label>
      </div>
      <div className="mt-2 grid grid-cols-2 gap-2">
        <label className="text-[11px] text-zinc-500">
          {tokenSymbol} in position
          <input
            className="mt-1 w-full border border-zinc-200 px-2 py-1.5 text-xs"
            type="number"
            min="0"
            placeholder="0"
            value={tokenText}
            disabled={editing}
            onChange={(event) => setTokenText(event.target.value)}
          />
          {inWallet(balances.data?.token, 18, tokenSymbol)}
        </label>
        <label className="text-[11px] text-zinc-500">
          {pool.pair.symbol} in position
          <input
            className="mt-1 w-full border border-zinc-200 px-2 py-1.5 text-xs"
            type="number"
            min="0"
            placeholder="0"
            value={pairText}
            disabled={editing}
            onChange={(event) => setPairText(event.target.value)}
          />
          {inWallet(balances.data?.pair, pool.pair.decimals, pool.pair.symbol)}
        </label>
      </div>
      {preview && preview.plan.kind !== "remove" ? (
        <p className="mt-1 text-[11px] text-zinc-600" role="status">
          At this band it holds about {fmtUnits(preview.plan.tokenHolding, 18)} {tokenSymbol} +{" "}
          {fmtUnits(preview.plan.pairHolding, pool.pair.decimals)} {pool.pair.symbol}.
          {capped ? (
            <>
              {" "}
              {capped.binding} limits it here: holding the full{" "}
              {capped.side === "token"
                ? `${fmtUnits(preview.tokenAmount, 18)} ${tokenSymbol}`
                : `${fmtUnits(preview.pairAmount, pool.pair.decimals)} ${pool.pair.symbol}`}{" "}
              at this band takes about {capped.needed} {capped.binding}.{" "}
              {pool.price && !editing ? (
                <button
                  type="button"
                  className="underline underline-offset-2 hover:text-zinc-900"
                  onClick={fitBand}
                >
                  Fit the band to these amounts
                </button>
              ) : null}
            </>
          ) : null}
        </p>
      ) : null}
      <p className="mt-1 text-[11px] text-zinc-500">
        Set both to 0 to remove the position. Keep the band and raise or lower the amounts to top up
        or free part of it without a new position id.
      </p>
      {current && copy ? (
        <div className="mt-2 border border-amber-200 bg-amber-50 p-2 text-xs text-zinc-700">
          <p className="font-medium">{copy[0]}</p>
          <p className="mt-1 text-[11px] text-zinc-500">{copy[1]}</p>
          <p className="mt-1 text-[11px] text-zinc-500">{copy[2]}</p>
          <TxSteps
            steps={current.steps}
            activeIndex={busy ? stepIndex : -1}
            className="mt-2 rounded border border-melon-200 bg-melon-50 p-3 text-xs"
          />
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              className="bg-zinc-900 px-3 py-1.5 text-white disabled:opacity-50"
              disabled={busy}
              onClick={() => void execute()}
            >
              {busy ? "Submitting…" : "Confirm & edit position"}
            </button>
            <button
              type="button"
              className="border border-zinc-300 px-3 py-1.5 disabled:opacity-50"
              disabled={busy}
              onClick={() => setReviewed(null)}
            >
              Back
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-2 flex gap-2">
          <button
            type="button"
            className="bg-zinc-900 px-3 py-1.5 text-white disabled:opacity-50"
            disabled={busy}
            onClick={() => void prepare()}
          >
            {busy ? "Checking…" : "Review edit"}
          </button>
          <button
            type="button"
            className="border border-zinc-300 px-3 py-1.5 disabled:opacity-50"
            disabled={busy}
            onClick={onClose}
          >
            Cancel
          </button>
        </div>
      )}
      {status ? (
        <p className="mt-2 wrap-anywhere text-[11px] text-zinc-600" role="status">
          {status}
        </p>
      ) : null}
    </div>
  );
}

function parseAmountText(text: string, decimals: number, symbol: string): bigint {
  const trimmed = text.trim();
  if (trimmed === "") return 0n;
  try {
    const amount = parseUnits(trimmed, decimals);
    if (amount < 0n) throw new Error();
    return amount;
  } catch {
    throw new Error(`Enter a valid ${symbol} amount.`);
  }
}

/**
 * Which typed side the band cannot fully use, if any: the other side is the
 * binding one (its holding lands on its target) while this one is cut well
 * short. Returns which side is capped and how much of the binding side the
 * full target on the capped side would take at this band's ratio.
 */
function cappedSide(
  preview: {
    plan: { tokenHolding: bigint; pairHolding: bigint };
    tokenAmount: bigint;
    pairAmount: bigint;
  },
  pairDecimals: number,
): { side: "token" | "pair"; needed: string } | null {
  const { tokenHolding, pairHolding } = preview.plan;
  if (tokenHolding <= 0n || pairHolding <= 0n) return null;
  const short = (holding: bigint, target: bigint) => target > 0n && holding * 100n < target * 99n;
  const tokenShort = short(tokenHolding, preview.tokenAmount);
  const pairShort = short(pairHolding, preview.pairAmount);
  if (tokenShort === pairShort) return null;
  return tokenShort
    ? {
        side: "token",
        needed: fmtUnits((preview.tokenAmount * pairHolding) / tokenHolding, pairDecimals),
      }
    : {
        side: "pair",
        needed: fmtUnits((preview.pairAmount * tokenHolding) / pairHolding, 18),
      };
}

/** The three review lines for a plan, sized against the pool it was built on. */
function planCopy(pool: PoolSnapshot, plan: EditLiquidityPlan, tokenSymbol: string): string[] {
  const band = lpBandPrices(pool, plan.tickLower, plan.tickUpper);
  const text = describeEditLiquidityPlan({
    ...plan,
    tokenSymbol,
    pairSymbol: pool.pair.symbol,
    pairDecimals: pool.pair.decimals,
    pairIsNative: pool.pair.addr === zeroAddress,
    band:
      plan.kind === "move"
        ? `${formatPrice(band.minimumPrice)} – ${formatPrice(band.maximumPrice)} ${pool.pair.symbol}/${tokenSymbol}`
        : undefined,
  });
  return [text.lead, text.detail, text.tech];
}
