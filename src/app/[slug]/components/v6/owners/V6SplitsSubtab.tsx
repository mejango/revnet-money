"use client";

import { SplitsSection } from "../../../owners/components/SplitsSection";

/**
 * Splits subtab (website/ parity: renderOwnersSplits): the per-stage reserved
 * split recipients per chain, with the anyone-can-send Distribute button and
 * the operator's Edit splits flow (both inside SplitsSection).
 */
export function V6SplitsSubtab() {
  return (
    <div>
      <SplitsSection />
    </div>
  );
}
