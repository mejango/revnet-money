/** Long-run cash-out price after payments at the current issuance price. */
export function minimumCashOutPriceAtIssuancePrice(
  issuancePrice: number,
  cashOutTaxRate: number,
): number {
  if (!Number.isFinite(issuancePrice) || issuancePrice <= 0) return 0;
  const tax = Math.max(0, Math.min(10_000, cashOutTaxRate));
  return issuancePrice * (1 - tax / 10_000);
}
