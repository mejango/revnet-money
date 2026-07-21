"use client";

import { SplitsSection } from "../../../owners/components/SplitsSection";
import { BuildPromptFooter } from "../BuildPromptFooter";

/**
 * Splits subtab (website/ parity: renderOwnersSplits): the per-stage reserved
 * split recipients per chain, with the anyone-can-send Distribute button and
 * the operator's Edit splits flow (both inside SplitsSection).
 */
export function V6SplitsSubtab() {
  return (
    <div>
      <SplitsSection />
      <BuildPromptFooter title="Edit splits" concept="split-groups" />
    </div>
  );
}
