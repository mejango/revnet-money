import {
  buildBuybackCashOutMetadata,
  slippageFloor,
  type CashOutRoute,
} from "@bananapus/nana-sdk-core/v6";

const MAX_CASH_OUT_TAX_RATE = 10_000n;

/**
 * Protect a buyback cash out using the hook's executable pool floor.
 * `rawSwapQuote` is an optimistic oracle quote; the hook's own minimum also
 * accounts for pool fees, liquidity, and price impact. Using the raw quote as
 * a hard floor can make an otherwise valid cash out revert.
 */
export function protectHookAwareCashOutRoute(
  route: CashOutRoute,
  slippageBps: bigint,
): CashOutRoute {
  const buyback = route.buyback;
  if (route.route !== "amm" || !buyback) return route;

  const executableMinimum = slippageFloor(buyback.minimumSwapAmountOut, slippageBps);
  if (executableMinimum <= 0n || executableMinimum <= buyback.netDirectCashOutAmount) {
    const treasuryMinimum = slippageFloor(route.treasuryNet, slippageBps);
    return {
      ...route,
      route: "treasury",
      expectedReturn: route.treasuryNet,
      minimumReturn: treasuryMinimum,
      terminalMinimum: treasuryMinimum,
      metadata: "0x",
    };
  }

  return {
    ...route,
    minimumReturn: executableMinimum,
    metadata: buildBuybackCashOutMetadata({
      hook: buyback.hook,
      minimumSwapAmountOut: executableMinimum,
    }),
  };
}

/** Pool fee/impact buffer already included by the hook's live preview. */
export function cashOutPoolBufferBps(route: CashOutRoute | undefined): number | null {
  const buyback = route?.route === "amm" ? route.buyback : null;
  if (!buyback || buyback.rawSwapQuote <= 0n) return null;
  const boundedMinimum =
    buyback.minimumSwapAmountOut > buyback.rawSwapQuote
      ? buyback.rawSwapQuote
      : buyback.minimumSwapAmountOut;
  return Number(
    ((buyback.rawSwapQuote - boundedMinimum) * 10_000n + buyback.rawSwapQuote - 1n) /
      buyback.rawSwapQuote,
  );
}

export function cashOutExecutionErrorMessage(error: unknown): string | null {
  const details: string[] = [];
  let current: unknown = error;
  for (let depth = 0; current && depth < 5; depth += 1) {
    if (current instanceof Error) {
      details.push(current.message);
      current = current.cause;
    } else {
      details.push(String(current));
      break;
    }
  }
  const message = details.join(" ");
  return message.includes("0xe2d708a9") ||
    message.includes("JBBuybackHook_SpecifiedSlippageExceeded")
    ? "The buyback pool moved below your protected minimum. Refresh the quote or choose a larger max slippage, then try again."
    : null;
}

/** Keep a remembered multi-chain choice from diverging from the chains which are still cash-outable. */
export function resolveCashOutChainId(
  availableChainIds: readonly number[],
  selectedChainId: string | undefined,
): string | undefined {
  if (availableChainIds.length === 1) return availableChainIds[0].toString();
  if (selectedChainId && availableChainIds.some((chainId) => chainId === Number(selectedChainId))) {
    return selectedChainId;
  }
  return undefined;
}

export type CashOutQuoteInput = {
  surplus: bigint;
  cashOutCount: bigint;
  totalSupply: bigint;
  cashOutTaxRate: bigint;
};

/** Exact integer ordering used by nana-core-v6 JBCashOuts.cashOutFrom. */
export function contractCashOutQuote({
  surplus,
  cashOutCount,
  totalSupply,
  cashOutTaxRate,
}: CashOutQuoteInput): bigint {
  if (
    surplus < 0n ||
    cashOutCount < 0n ||
    totalSupply < 0n ||
    cashOutTaxRate < 0n ||
    cashOutTaxRate > MAX_CASH_OUT_TAX_RATE
  ) {
    throw new RangeError("cash-out inputs are outside contract bounds");
  }
  if (cashOutCount === 0n || totalSupply === 0n || surplus === 0n) return 0n;
  if (cashOutTaxRate === MAX_CASH_OUT_TAX_RATE) return 0n;
  if (cashOutCount >= totalSupply) return surplus;

  const base = (surplus * cashOutCount) / totalSupply;
  if (cashOutTaxRate === 0n) return base;

  const numerator =
    MAX_CASH_OUT_TAX_RATE - cashOutTaxRate + (cashOutTaxRate * cashOutCount) / totalSupply;
  return (base * numerator) / MAX_CASH_OUT_TAX_RATE;
}

/**
 * Choose the largest decimal token unit no greater than the outstanding supply.
 * A quote for this exact unit is displayed as-is; nonlinear cash-out quotes must
 * never be extrapolated to one token by multiplying by an arbitrary factor.
 */
export function cashOutDisplayUnit(totalSupply: bigint, tokenDecimals: number): bigint | null {
  if (!Number.isSafeInteger(tokenDecimals) || tokenDecimals < 0 || tokenDecimals > 36) {
    throw new RangeError("token decimals are outside supported bounds");
  }
  if (totalSupply <= 0n) return null;

  let unit = 10n ** BigInt(tokenDecimals);
  while (unit > totalSupply && unit > 1n) unit /= 10n;
  return unit;
}

export function exitFloorQuote(input: {
  mintedSupply: bigint;
  pendingReservedTokens: bigint;
  surplus: bigint;
  cashOutTaxRate: bigint;
  tokenDecimals: number;
}): { cashOutCount: bigint; reclaimAmount: bigint } | null {
  const totalSupply = input.mintedSupply + input.pendingReservedTokens;
  const cashOutCount = cashOutDisplayUnit(totalSupply, input.tokenDecimals);
  if (cashOutCount === null) return null;

  return {
    cashOutCount,
    reclaimAmount: contractCashOutQuote({
      surplus: input.surplus,
      cashOutCount,
      totalSupply,
      cashOutTaxRate: input.cashOutTaxRate,
    }),
  };
}
