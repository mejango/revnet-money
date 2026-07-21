import { JBChainId, revLoansAbi } from "@bananapus/nana-sdk-core";
import { Address } from "viem";
import { useReadContract } from "wagmi";

/**
 * V6 returns `(borrowableNow, borrowableCapacity)`; expose `borrowableNow`.
 */
export function useBorrowableAmountFrom({
  address,
  chainId,
  args,
}: {
  address: Address | undefined;
  chainId?: JBChainId;
  args?: readonly [bigint, bigint, bigint, bigint];
}) {
  const query = useReadContract({
    abi: revLoansAbi,
    functionName: "borrowableAmountFrom",
    address,
    chainId,
    args,
  });

  return { ...query, data: query.data?.[0] };
}
