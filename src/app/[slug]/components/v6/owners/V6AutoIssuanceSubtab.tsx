"use client";

import { AutoIssuance } from "../../../owners/components/AutoIssuance";
import { BuildPromptFooter } from "../BuildPromptFooter";

/**
 * Auto issuance subtab (website/ parity: renderAutoIssuance): the per-stage
 * auto-issuance amounts — Stage | Account | Amount | Unlock date — with the
 * anyone-can-send Distribute button once a stage unlocks.
 */
export function V6AutoIssuanceSubtab() {
  return (
    <div>
      <p className="text-md text-black font-light italic mb-2">
        Auto issuance mints a fixed amount to a preset account when a stage starts. Anyone can
        trigger the distribution once its unlock date passes.
      </p>
      <AutoIssuance />
      <BuildPromptFooter title="Auto issuance" concept="mint" />
    </div>
  );
}
