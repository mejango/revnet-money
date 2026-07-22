import { exitFloorQuote } from "@/lib/cashOutQuote";
import { jbControllerAbi, JBCoreContracts, jbTokensAbi } from "@bananapus/nana-sdk-core";
import {
  useJBChainId,
  useJBContractContext,
  useJBRulesetContext,
  useJBTokenContext,
} from "@bananapus/nana-sdk-react";
import { useReadContract } from "wagmi";
import { useNativeTokenSurplus } from "./useTokenASurplus";

export function useExitFloorPrice() {
  const { projectId, contracts, contractAddress } = useJBContractContext();
  const { token } = useJBTokenContext();
  const { rulesetMetadata } = useJBRulesetContext();
  const { data: nativeTokenSurplus } = useNativeTokenSurplus();
  const chainId = useJBChainId();
  const { data: totalTokenSupply } = useReadContract({
    abi: jbTokensAbi,
    functionName: "totalSupplyOf",
    address: contractAddress(JBCoreContracts.JBTokens),
    chainId,
    args: [projectId],
  });
  const { data: tokensReserved } = useReadContract({
    abi: jbControllerAbi,
    functionName: "pendingReservedTokenBalanceOf",
    address: contracts.controller.data ?? undefined,
    chainId,
    args: [projectId],
  });

  if (
    !token?.data ||
    totalTokenSupply === undefined ||
    tokensReserved === undefined ||
    nativeTokenSurplus === undefined ||
    !rulesetMetadata?.data
  ) {
    return null;
  }

  return exitFloorQuote({
    mintedSupply: totalTokenSupply,
    pendingReservedTokens: tokensReserved,
    surplus: nativeTokenSurplus,
    cashOutTaxRate: rulesetMetadata.data.cashOutTaxRate.value,
    tokenDecimals: token.data.decimals,
  });
}
