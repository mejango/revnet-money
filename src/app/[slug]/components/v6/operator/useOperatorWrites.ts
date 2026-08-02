"use client";

import {
  useGetRelayrTxQuote,
  useSendRelayrTx,
  waitForRelayrBundle,
} from "@/hooks/useReviewedRelayr";
import { submittedViaSafe, useWriteContract } from "@/hooks/useReviewedWriteContract";
import { Address, encodeFunctionData } from "viem";
import { ChainWrite, chainName, publicClientFor, runSequentialWrites } from "./operatorLib";

export type OperatorWritesResult = {
  chains: number;
  viaRelayr: boolean;
  /** The Relayr payment was proposed to a Safe — the bundle has not executed yet. */
  safeProposal: boolean;
};

/**
 * Runs one operator action across the selected chains. A single chain keeps the
 * simulate-first wallet write; two or more are bundled into ONE Relayr payment,
 * so an omnichain edit costs one signature instead of N chain switches. Gas is
 * estimated against each chain's live state first, so a call that would revert
 * never reaches the bundle.
 */
export function useOperatorWrites() {
  const { writeContractAsync } = useWriteContract();
  const { getRelayrTxQuote, reset: resetRelayr } = useGetRelayrTxQuote();
  const { sendRelayrTx } = useSendRelayrTx();

  const runWrites = async ({
    writes,
    account,
    label,
    onProgress,
  }: {
    writes: ChainWrite[];
    account: Address;
    label: string;
    onProgress: (message: string) => void;
  }): Promise<OperatorWritesResult> => {
    if (!writes.length) throw new Error("Choose at least one chain.");

    if (writes.length === 1) {
      const chains = await runSequentialWrites({
        writes,
        account,
        writeContractAsync,
        onProgress,
      });
      return { chains, viaRelayr: false, safeProposal: false };
    }

    const requests = await Promise.all(
      writes.map(async (write) => {
        const name = chainName(write.chainId);
        onProgress(`Simulating on ${name}…`);
        const gas = await publicClientFor(write.chainId).estimateContractGas({
          account,
          address: write.address,
          abi: write.abi,
          functionName: write.functionName,
          args: write.args as unknown[],
        });
        return {
          chainId: write.chainId,
          version: 6 as const,
          data: {
            from: account,
            to: write.address,
            value: 0n,
            gas: gas + 50_000n,
            data: encodeFunctionData({
              abi: write.abi,
              functionName: write.functionName,
              args: write.args as unknown[],
            }),
          },
          review: {
            abi: write.abi,
            functionName: write.functionName,
            args: write.args,
            label: `${label} on ${name}`,
            contractName: write.contractName,
          },
        };
      }),
    );

    onProgress("Quoting the Relayr bundle…");
    const quote = await getRelayrTxQuote(requests);
    if (!quote) throw new Error("Relayr did not return a quote.");

    onProgress("Confirm the Relayr payment in your wallet…");
    const hash = await sendRelayrTx(quote.payment_info[0]);
    if (submittedViaSafe(hash)) {
      return { chains: writes.length, viaRelayr: true, safeProposal: true };
    }

    onProgress("Waiting for Relayr to execute on every chain…");
    await waitForRelayrBundle(quote.bundle_uuid);
    resetRelayr();
    return { chains: writes.length, viaRelayr: true, safeProposal: false };
  };

  return { runWrites };
}
