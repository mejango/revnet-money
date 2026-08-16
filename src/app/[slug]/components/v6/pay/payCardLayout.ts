import { PaymentTerminalType } from "@/lib/paymentTerminal";
import { V6PayMode } from "@/lib/v6/pay";

/**
 * Keep the established pay-panel height while a thumbnail strip is present,
 * or while the initial inventory request may still reveal one. Once the
 * request resolves without tiers, let the panel shrink to its natural height.
 */
export function payPanelLayoutClasses({
  mode,
  shopTierCount,
}: {
  mode: V6PayMode;
  shopTierCount: number | undefined;
}) {
  // Deliberately blind to whether the inventory is still loading. Reserving
  // the taller layout up front meant the card shrank on every project without
  // a shop, which is most of them — a settled card that jumps is worse than
  // one that grows to fit something it turned out to have.
  return mode === "pay" && (shopTierCount ?? 0) > 0 ? "h-30 py-4" : "py-0";
}

export function paySettlementLabel(routeType: PaymentTerminalType) {
  return routeType === "swap" ? "Swap" : "Issuance";
}
