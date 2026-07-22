"use client";

import { requireOnchainExecution, useWriteContract } from "@/hooks/useReviewedWriteContract";
import { useCallback, useState } from "react";
import { erc20Abi } from "viem";
import { useAccount, usePublicClient } from "wagmi";

export function useAllowance(chainId: number) {
  const { address } = useAccount();
  const publicClient = usePublicClient({ chainId });
  const { writeContractAsync } = useWriteContract();
  const [isApproving, setIsApproving] = useState(false);

  const ensureAllowance = useCallback(
    async (tokenAddress: `0x${string}`, spender: `0x${string}`, value: bigint) => {
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
        const hash = await writeContractAsync({
          chainId,
          address: tokenAddress,
          abi: erc20Abi,
          functionName: "approve",
          args: [spender, value],
        });
        requireOnchainExecution(hash, "Token approval");
        const receipt = await publicClient.waitForTransactionReceipt({ hash });
        if (receipt.status !== "success") {
          throw new Error(`Token approval ${hash} reverted onchain.`);
        }
        return hash;
      } finally {
        setIsApproving(false);
      }
    },
    [address, chainId, publicClient, writeContractAsync],
  );

  return { ensureAllowance, isApproving };
}
