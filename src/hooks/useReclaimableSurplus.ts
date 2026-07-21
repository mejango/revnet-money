import { applyNanaFee, applyRevFee } from "@/lib/feeHelpers";
import { getProjectTerminalStore, JBChainId, jbTerminalStoreAbi } from "@bananapus/nana-sdk-core";
import { useReadContract } from "wagmi";

export function useReclaimableSurplus(params: {
  chainId: JBChainId | undefined;
  projectId: bigint | undefined;
  tokenAmount: bigint | undefined;
  decimals: number;
  currencyId: number;
}) {
  const { chainId, projectId, tokenAmount, decimals, currencyId } = params;

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

  const afterFees = raw ? applyNanaFee(raw) : undefined;

  return { data: afterFees, raw, ...rest };
}
