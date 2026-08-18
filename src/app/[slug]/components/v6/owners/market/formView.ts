import { uniswapV4CounterpartAmount } from "@bananapus/nana-sdk-core/v6";

import { fmtUnits } from "../settlement/lib";
import { solveRangeFromAmounts, type MarketReferencePrices } from "./lib";

export type LiquidityFormMode = "amounts" | "range" | "full";

/**
 * "Full range" spans nine orders of magnitude either side of spot — beyond any
 * price a market can realistically reach, so the deposit ratio matches a
 * classic v2 pool to within ~0.01% while staying inside usable tick bounds.
 */
export const FULL_RANGE_FACTOR = 1e9;
export type LiquidityFormSide = "token" | "pair";

export interface LiquidityFormViewInputs {
  mode: LiquidityFormMode;
  tokenText: string;
  pairText: string;
  minText: string;
  maxText: string;
  /** The amount field the user touched last; the other one follows. */
  driver: LiquidityFormSide;
  price: number;
  reference: MarketReferencePrices;
  tokenSymbol: string;
  pairSymbol: string;
}

export interface LiquidityFormViewResult {
  minPrice: number | null;
  maxPrice: number | null;
  tokenAmount: number | null;
  pairAmount: number | null;
  /** The amount shown as computed rather than typed (range mode). */
  derived: LiquidityFormSide | null;
  disabled: { token: boolean; pair: boolean };
  anchor: "floor" | "ceiling" | null;
  note: string | null;
  summary: string | null;
  ready: boolean;
}

const EMPTY_VIEW: LiquidityFormViewResult = {
  minPrice: null,
  maxPrice: null,
  tokenAmount: null,
  pairAmount: null,
  derived: null,
  disabled: { token: false, pair: false },
  anchor: null,
  note: null,
  summary: null,
  ready: false,
};

const trim = (value: number) => String(Number(value.toPrecision(6)));

/** "" parses as 0 (single-sided); junk and negatives parse as NaN. */
function parseAmountText(text: string): number {
  const cleaned = text.trim();
  if (cleaned === "") return 0;
  const value = Number(cleaned);
  return Number.isFinite(value) && value >= 0 ? value : Number.NaN;
}

/**
 * The add-liquidity form's whole decision surface as one pure function, so the
 * component only binds inputs and renders. Amounts mode: both deposits are
 * typed, the range is solved around them. Range mode: the range is typed, the
 * last-touched amount drives and the counterpart follows.
 */
export function liquidityFormView(inputs: LiquidityFormViewInputs): LiquidityFormViewResult {
  const { price, tokenSymbol, pairSymbol } = inputs;
  if (!Number.isFinite(price) || price <= 0) return EMPTY_VIEW;

  if (inputs.mode === "amounts") {
    const tokenAmount = parseAmountText(inputs.tokenText);
    const pairAmount = parseAmountText(inputs.pairText);
    if (Number.isNaN(tokenAmount) || Number.isNaN(pairAmount)) {
      return { ...EMPTY_VIEW, note: "Amounts must be plain numbers." };
    }
    if (tokenAmount === 0 && pairAmount === 0) {
      return {
        ...EMPTY_VIEW,
        note: `Enter what you want to deposit — the price range is set for you.`,
      };
    }
    const solved = solveRangeFromAmounts({
      price,
      tokenAmount,
      pairAmount,
      floorHint: inputs.reference.cashOut,
      ceilingHint: inputs.reference.issuance,
    });
    if (!solved) return { ...EMPTY_VIEW, note: "These amounts don't form a position." };

    let note: string;
    if (tokenAmount === 0) {
      note = `Only ${pairSymbol}: the position sits below the current price and buys ${tokenSymbol} as the price falls.`;
    } else if (pairAmount === 0) {
      note = `Only ${tokenSymbol}: the position sits above the current price and sells into ${pairSymbol} as the price rises.`;
    } else if (solved.anchor === "floor") {
      note =
        inputs.reference.cashOut && solved.minPrice === inputs.reference.cashOut
          ? "Floor anchored at the cash-out price — below it, cashing out beats selling."
          : "Floor set to half the current price (no cash-out floor available).";
    } else {
      note =
        inputs.reference.issuance && solved.maxPrice === inputs.reference.issuance
          ? `Your ${tokenSymbol} side needs more room than the cash-out floor allows, so the ceiling is anchored at the issuance price instead.`
          : `Your ${tokenSymbol} side needs more room than the cash-out floor allows, so the ceiling is set to twice the current price.`;
    }

    return {
      minPrice: solved.minPrice,
      maxPrice: solved.maxPrice,
      tokenAmount,
      pairAmount,
      derived: null,
      disabled: { token: false, pair: false },
      anchor: solved.anchor,
      note,
      summary: `Uses your ${trim(tokenAmount)} ${tokenSymbol} + ${trim(pairAmount)} ${pairSymbol} between ${trim(solved.minPrice)} and ${trim(solved.maxPrice)} ${pairSymbol} per ${tokenSymbol}.`,
      ready: true,
    };
  }

  if (inputs.mode === "full") {
    const minPrice = price / FULL_RANGE_FACTOR;
    const maxPrice = price * FULL_RANGE_FACTOR;
    const driverIsPair = inputs.driver === "pair";
    const driverAmount = parseAmountText(driverIsPair ? inputs.pairText : inputs.tokenText);
    const counterpart =
      Number.isNaN(driverAmount) || driverAmount <= 0
        ? null
        : uniswapV4CounterpartAmount(driverAmount, driverIsPair, price, minPrice, maxPrice);
    const tokenAmount = driverIsPair ? counterpart : driverAmount;
    const pairAmount = driverIsPair ? driverAmount : counterpart;
    const ready = counterpart !== null && driverAmount > 0;
    return {
      minPrice,
      maxPrice,
      tokenAmount,
      pairAmount,
      derived: counterpart === null ? null : driverIsPair ? "token" : "pair",
      disabled: { token: false, pair: false },
      anchor: null,
      note: `Your liquidity works at every price, like a classic v2 pool. Enter either amount; the other follows at the pool price.`,
      summary:
        ready && tokenAmount != null && pairAmount != null
          ? `Spreads ${trim(tokenAmount)} ${tokenSymbol} + ${trim(pairAmount)} ${pairSymbol} across every price (v2-style).`
          : null,
      ready,
    };
  }

  const minPrice = Number(inputs.minText);
  const maxPrice = Number(inputs.maxText);
  if (!Number.isFinite(minPrice) || !Number.isFinite(maxPrice) || minPrice <= 0 || maxPrice <= minPrice) {
    return { ...EMPTY_VIEW, note: "Set a valid price range first." };
  }

  const tokenActive = price < maxPrice;
  const pairActive = price > minPrice;

  if (!tokenActive) {
    const pairAmount = parseAmountText(inputs.pairText);
    return {
      minPrice,
      maxPrice,
      tokenAmount: 0,
      pairAmount: Number.isNaN(pairAmount) ? null : pairAmount,
      derived: null,
      disabled: { token: true, pair: false },
      anchor: null,
      note: `This range sits below the current price, so it only takes ${pairSymbol} — it buys ${tokenSymbol} as the price falls into it.`,
      summary: null,
      ready: !Number.isNaN(pairAmount) && pairAmount > 0,
    };
  }
  if (!pairActive) {
    const tokenAmount = parseAmountText(inputs.tokenText);
    return {
      minPrice,
      maxPrice,
      tokenAmount: Number.isNaN(tokenAmount) ? null : tokenAmount,
      pairAmount: 0,
      derived: null,
      disabled: { token: false, pair: true },
      anchor: null,
      note: `This range sits above the current price, so it only takes ${tokenSymbol} — it sells into ${pairSymbol} as the price rises into it.`,
      summary: null,
      ready: !Number.isNaN(tokenAmount) && tokenAmount > 0,
    };
  }

  const driverIsPair = inputs.driver === "pair";
  const driverAmount = parseAmountText(driverIsPair ? inputs.pairText : inputs.tokenText);
  const counterpart =
    Number.isNaN(driverAmount) || driverAmount <= 0
      ? null
      : uniswapV4CounterpartAmount(driverAmount, driverIsPair, price, minPrice, maxPrice);

  return {
    minPrice,
    maxPrice,
    tokenAmount: driverIsPair ? counterpart : driverAmount,
    pairAmount: driverIsPair ? driverAmount : counterpart,
    derived: counterpart === null ? null : driverIsPair ? "token" : "pair",
    disabled: { token: false, pair: false },
    anchor: null,
    note: "Amounts are linked: the range and the current price set the ratio. Edit either amount and the other follows.",
    summary: null,
    ready: counterpart !== null && driverAmount > 0,
  };
}

/** Review copy: the amounts are the headline, the ticks are fine print. */
export function describeAddLiquidityPlan(plan: {
  tokenMaximum: bigint;
  pairMaximum: bigint;
  tickLower: number;
  tickUpper: number;
  tokenSymbol: string;
  pairSymbol: string;
  pairDecimals: number;
}): { lead: string; detail: string } {
  return {
    lead: `Adds up to ${fmtUnits(plan.tokenMaximum, 18)} ${plan.tokenSymbol} + ${fmtUnits(plan.pairMaximum, plan.pairDecimals)} ${plan.pairSymbol}.`,
    detail: `Uniswap V4 mint · ticks ${plan.tickLower} → ${plan.tickUpper}.`,
  };
}
