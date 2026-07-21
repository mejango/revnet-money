import { jbMultiTerminalAbi, NATIVE_TOKEN, NATIVE_TOKEN_DECIMALS } from "@bananapus/nana-sdk-core";
import { useJBChainId, useJBContractContext } from "@bananapus/nana-sdk-react";
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
