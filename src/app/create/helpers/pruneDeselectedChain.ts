import { JBChainId } from "@bananapus/nana-sdk-core";
import type { RevnetFormData } from "../types";

// Deselecting a chain removes its per-chain overrides (operator and split
// beneficiaries) so no orphaned values linger; those fields fall back to their
// single default value. Auto-issuance rows keep their chain assignment: the
// create schema reports them so the user re-homes each row explicitly.
export function pruneDeselectedChain(
  values: RevnetFormData,
  chainId: JBChainId,
): Pick<RevnetFormData, "operator" | "stages"> {
  return {
    operator: values.operator.filter((operator) => Number(operator.chainId) !== Number(chainId)),
    stages: values.stages.map((stage) => ({
      ...stage,
      splits: stage.splits.map((split) => {
        if (!split.beneficiary) return split;
        const beneficiary = split.beneficiary.filter(
          (entry) => Number(entry.chainId) !== Number(chainId),
        );
        return { ...split, beneficiary: beneficiary.length > 0 ? beneficiary : undefined };
      }),
    })),
  };
}
