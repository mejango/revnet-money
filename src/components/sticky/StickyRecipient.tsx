"use client";

import { stickyRecipientLabel } from "@/lib/sticky";
import type { JBChainId } from "@bananapus/nana-sdk-core";
import { erc20Abi, type Address } from "viem";
import { useReadContract } from "wagmi";

/**
 * A Sticky split's recipient: "Sticky holders stuck 4 to 52 weeks → STICKY".
 * The group is the split's projectId, so it never reads as a project. The
 * token address shows until its symbol loads, and stays on hover.
 */
export function StickyRecipient({
  split,
  chainId,
}: {
  split: { projectId: bigint; beneficiary: Address };
  chainId: JBChainId;
}) {
  const { data: symbol } = useReadContract({
    address: split.beneficiary,
    abi: erc20Abi,
    functionName: "symbol",
    chainId,
    query: { staleTime: Infinity },
  });
  return <span title={split.beneficiary}>{stickyRecipientLabel(split, symbol)}</span>;
}
