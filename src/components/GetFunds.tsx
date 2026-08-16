"use client";

import {
  useParaAuth,
  type ParaOnRampAsset,
  type ParaOnRampNetwork,
} from "@/providers/ParaAuthContext";

/** Only the chains Para's on-ramp can actually deliver to. The other testnets
 *  we support have no on-ramp, so the affordance hides itself there. */
const NETWORKS: Record<number, ParaOnRampNetwork> = {
  1: "ETHEREUM",
  10: "OPTIMISM",
  8453: "BASE",
  42161: "ARBITRUM",
  11155111: "SEPOLIA",
};

/** Wrapped and bridged variants are deliberately absent — an on-ramp that
 *  delivers plain ETH when the form wants WETH is worse than no link. */
const ASSETS: Record<string, ParaOnRampAsset> = {
  ETH: "ETHEREUM",
  USDC: "USDC",
};

/**
 * "Get ETH" / "Get USDC" — opens Para's on-ramp for the token and chain the
 * caller is actually transacting in. Renders nothing when that pair has no
 * on-ramp route, or when embedded wallets are switched off for this build.
 */
export function GetFunds({
  symbol,
  chainId,
  onNavigate,
  className = "text-xs text-zinc-600 underline underline-offset-2 hover:text-zinc-900",
}: {
  symbol: string;
  chainId: number | undefined;
  /** Lets a containing menu dismiss itself as the on-ramp takes over. */
  onNavigate?: () => void;
  className?: string;
}) {
  const { enabled, requestAddFunds } = useParaAuth();
  const asset = ASSETS[symbol?.toUpperCase() ?? ""];
  const network = chainId ? NETWORKS[chainId] : undefined;
  if (!enabled || !asset || !network) return null;

  return (
    <button
      type="button"
      onClick={() => {
        onNavigate?.();
        requestAddFunds({ asset, network });
      }}
      className={className}
    >
      Get {symbol}
    </button>
  );
}
