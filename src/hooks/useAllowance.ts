"use client";

import { requireDone, reviewedCall, useReviewedAction } from "@/hooks/useReviewedAction";
import { erc20ApproveAbi } from "@/lib/erc20-approve";
import { useCallback, useRef, useState } from "react";
import { erc20Abi, type Hex, type TransactionReceipt } from "viem";
import { useAccount, usePublicClient } from "wagmi";

export function useAllowance(chainId: number) {
  const { address } = useAccount();
  const publicClient = usePublicClient({ chainId });
  const { run } = useReviewedAction();
  const [isApproving, setIsApproving] = useState(false);
  const approvalReceipts = useRef(new Map<Hex, TransactionReceipt>());

  const ensureAllowance = useCallback(
    /** `namespace`: the approval's intent (the SDK's approvalIntent of its parent action). */
    async (
      tokenAddress: `0x${string}`,
      spender: `0x${string}`,
      value: bigint,
      namespace: string,
    ) => {
      if (!address) throw new Error("Wallet not connected");
      if (!publicClient) throw new Error("Please try again");

      const allowance = await publicClient.readContract({
        address: tokenAddress,
        abi: erc20Abi,
        functionName: "allowance",
        args: [address, spender],
      });

      if (BigInt(allowance) >= BigInt(value)) return null;

      setIsApproving(true);
      try {
        const { hashes, receipts } = requireDone(
          await run({
            account: address,
            calls: [
              reviewedCall(
                {
                  chainId,
                  address: tokenAddress,
                  abi: erc20ApproveAbi,
                  functionName: "approve",
                  args: [spender, value],
                },
                { intent: namespace },
              ),
            ],
          }),
        );
        const hash = hashes.at(-1)!;
        const receipt = receipts.at(-1)!;
        approvalReceipts.current.set(hash, receipt);
        return hash;
      } finally {
        setIsApproving(false);
      }
    },
    [address, chainId, publicClient, run],
  );

  const getApprovalReceipt = useCallback(
    (hash: Hex | null | undefined) => (hash ? approvalReceipts.current.get(hash) : undefined),
    [],
  );

  return { ensureAllowance, getApprovalReceipt, isApproving };
}
