import { useJBChainId, useJBContractContext } from "@/lib/nana/project";
import { jbMultiTerminalAbi, NATIVE_TOKEN, NATIVE_TOKEN_DECIMALS } from "@bananapus/nana-sdk-core";
import { useReadContract } from "wagmi";

export function useNativeTokenSurplus() {
  const {
    projectId,
    contracts: { primaryNativeTerminal },
  } = useJBContractContext();

  const chainId = useJBChainId();

  return useReadContract({
    abi: jbMultiTerminalAbi,
    functionName: "currentSurplusOf",
    chainId,
    address: primaryNativeTerminal.data ?? undefined,
    args: [projectId, [NATIVE_TOKEN], BigInt(NATIVE_TOKEN_DECIMALS), BigInt(1)],
  });
}
