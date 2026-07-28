import { applyRevFee, netCashOutValue } from "@/lib/feeHelpers";
import { decodeRulesetMetadata } from "@/lib/utils";
import {
  getJBContractAddress,
  getProjectTerminalStore,
  JBChainId,
  JBCoreContracts,
  jbMultiTerminalAbi,
  jbRulesetsAbi,
  jbTerminalStoreAbi,
} from "@bananapus/nana-sdk-core";
import type { Address } from "viem";
import { useReadContract } from "wagmi";

export function useReclaimableSurplus(params: {
  chainId: JBChainId | undefined;
  projectId: bigint | undefined;
  tokenAmount: bigint | undefined;
  decimals: number;
  currencyId: number;
  /** The accounting-context (terminal) token, needed for feeFreeSurplusOf. */
  token: Address | undefined;
}) {
  const { chainId, projectId, tokenAmount, decimals, currencyId, token } = params;

  const { data: raw, ...rest } = useReadContract({
    abi: jbTerminalStoreAbi,
    address: chainId ? getProjectTerminalStore(chainId, 6) : undefined,
    functionName: "currentReclaimableSurplusOf",
    chainId,
    args:
      projectId && tokenAmount
        ? [projectId, applyRevFee(tokenAmount), [], [], BigInt(decimals), BigInt(currencyId)]
        : undefined,
  });

  // The protocol charges the 2.5% fee on the whole reclaim when the current
  // ruleset's cash-out tax is nonzero, and only up to feeFreeSurplusOf when
  // the tax is zero (JBMultiTerminal._cashOutTokensOf).
  const { data: currentRuleset } = useReadContract({
    abi: jbRulesetsAbi,
    address: chainId ? getJBContractAddress(JBCoreContracts.JBRulesets, 6, chainId) : undefined,
    functionName: "currentOf",
    chainId,
    args: projectId ? [projectId] : undefined,
  });
  const cashOutTaxRate = currentRuleset
    ? decodeRulesetMetadata(currentRuleset.metadata).cashOutTaxRate.value
    : undefined;

  const { data: feeFreeSurplus } = useReadContract({
    abi: jbMultiTerminalAbi,
    address: chainId
      ? getJBContractAddress(JBCoreContracts.JBMultiTerminal, 6, chainId)
      : undefined,
    functionName: "feeFreeSurplusOf",
    chainId,
    args: projectId && token ? [projectId, token] : undefined,
    query: { enabled: cashOutTaxRate === 0n && !!token },
  });

  const afterFees =
    raw !== undefined && cashOutTaxRate !== undefined
      ? cashOutTaxRate !== 0n
        ? netCashOutValue({ reclaimAmount: raw, cashOutTaxRate, feeFreeSurplus: 0n })
        : feeFreeSurplus !== undefined
          ? netCashOutValue({ reclaimAmount: raw, cashOutTaxRate, feeFreeSurplus })
          : undefined
      : undefined;

  return { data: afterFees, raw, ...rest };
}
