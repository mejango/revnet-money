import { PaymentTerminalType } from "@/lib/paymentTerminal";
import { V6PayMode } from "@/lib/v6/pay";

/**
 * Keep the established pay-panel height while a thumbnail strip is present,
 * or while the initial inventory request may still reveal one. Once the
 * request resolves without tiers, let the panel shrink to its natural height.
 */
export function payPanelLayoutClasses({
  mode,
  shopLoading,
  shopTierCount,
}: {
  mode: V6PayMode;
  shopLoading: boolean;
  shopTierCount: number | undefined;
}) {
  return mode === "pay" && (shopLoading || (shopTierCount ?? 0) > 0) ? "h-30 py-4" : "py-0";
}

export function paySettlementLabel(routeType: PaymentTerminalType) {
  return routeType === "swap" ? "Swap" : "Issuance";
}
