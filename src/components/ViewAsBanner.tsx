"use client";

import { EthereumAddress } from "@/components/EthereumAddress";
import { useViewAs } from "@/lib/view-as";
import { mainnet } from "viem/chains";

/**
 * Persistent site-wide notice while "View as" impersonation is active. Amber so
 * it cannot be mistaken for the normal melon/teal chrome.
 */
export function ViewAsBanner() {
  const { viewAs, clearViewAs } = useViewAs();
  if (!viewAs) return null;

  return (
    <div
      role="status"
      className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 border-b border-amber-300 bg-amber-100 px-4 py-2 text-sm text-amber-900"
    >
      <span className="inline-flex items-center gap-1">
        Viewing as{" "}
        <span className="font-medium">
          <EthereumAddress address={viewAs} withEnsName short chain={mainnet} />
        </span>
      </span>
      <button
        type="button"
        onClick={clearViewAs}
        className="min-h-8 border border-amber-400 bg-amber-200 px-2 py-0.5 text-xs font-medium text-amber-950 hover:bg-amber-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-600"
      >
        Exit View as
      </button>
    </div>
  );
}
