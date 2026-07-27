import { useJBChainId, useJBContractContext } from "@/lib/nana/project";
import { jbMultiTerminalAbi } from "@bananapus/nana-sdk-core";
import { useReadContract } from "wagmi";
import { useProjectBaseToken } from "./useProjectBaseToken";

export function useNativeTokenSurplus() {
  const {
    projectId,
    contracts: { primaryNativeTerminal },
  } = useJBContractContext();

  const chainId = useJBChainId();
  const baseToken = useProjectBaseToken();

  return useReadContract({
    abi: jbMultiTerminalAbi,
    functionName: "currentSurplusOf",
    chainId,
    address: primaryNativeTerminal.data ?? undefined,
    args: baseToken
      ? [projectId, [baseToken.address], BigInt(baseToken.decimals), BigInt(baseToken.currency)]
      : undefined,
    query: { enabled: !!primaryNativeTerminal.data && !!baseToken },
  });
}
