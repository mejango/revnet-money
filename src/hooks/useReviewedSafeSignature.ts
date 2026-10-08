"use client";

import { captureReviewedWalletContext } from "@/lib/reviewed-wallet-context";
import { requireTransactionReview, type TransactionReviewCall } from "@/lib/transaction-review";
import {
  canonicalSafeTxHash,
  SAFE_TX_TYPES,
  safeTransactionMessage,
  type SafeQueuedTransaction,
} from "@bananapus/nana-sdk-core/safe-service";
import { useCallback } from "react";
import { type Address, type Hex } from "viem";
import { useConfig, useSwitchChain } from "wagmi";
import { getAccount, getWalletClient } from "wagmi/actions";

export type ReviewedSafeSignatureRequest = {
  chainId: number;
  safe: Address;
  tx: SafeQueuedTransaction;
  /** Re-authenticate the Safe/owner after review and chain switching. */
  reverify?: (account: Address) => Promise<void>;
  /** How to decode the queued call for the review (ABI, args, a batch's inner calls). */
  review?: Pick<
    TransactionReviewCall,
    "abi" | "functionName" | "args" | "label" | "contractName" | "calls"
  >;
};

export function useReviewedSafeSignature() {
  const config = useConfig();
  const { switchChainAsync } = useSwitchChain();

  const signSafeTransactionAsync = useCallback(
    async ({ chainId, safe, tx, reverify, review }: ReviewedSafeSignatureRequest): Promise<Hex> => {
      const before = getAccount(config);
      if (!before.address) throw new Error("Connect a wallet first.");
      const account = before.address;
      const assertWalletContext = captureReviewedWalletContext(
        config,
        account,
        "Connected account or network changed. Review the Safe transaction again.",
      );

      // The hash of the exact fields, refusing a record for another Safe or advertising another hash.
      const digest = canonicalSafeTxHash(chainId, safe, tx);
      const message = safeTransactionMessage(tx);

      await requireTransactionReview({
        kind: "authorization",
        title: "Review Safe transaction signature",
        description:
          "This signature approves the exact queued Safe call. It does not execute until the threshold and nonce requirements are met.",
        confirmLabel: "Agree & sign Safe transaction",
        authorization: {
          type: "EIP-712 SafeTx",
          safe,
          nonce: tx.nonce,
          digest,
          message,
        },
        calls: [
          {
            chainId,
            from: account,
            to: message.to,
            value: message.value,
            // The signature commits to this call's Safe gas.
            safeTxGas: message.safeTxGas,
            data: message.data,
            label: `Safe transaction #${tx.nonce}`,
            ...review,
          },
        ],
      });

      assertWalletContext();
      await switchChainAsync({ chainId });
      assertWalletContext(chainId);
      await reverify?.(account);
      assertWalletContext(chainId);
      const wallet = await getWalletClient(config, { chainId, account });
      if (!wallet.account || wallet.account.address.toLowerCase() !== account.toLowerCase()) {
        throw new Error("Connected account changed. Review the Safe transaction again.");
      }
      assertWalletContext(chainId);
      const signature = await wallet.signTypedData({
        account: wallet.account,
        domain: { chainId, verifyingContract: safe },
        types: SAFE_TX_TYPES,
        primaryType: "SafeTx",
        message,
      });
      assertWalletContext(chainId);
      // A wallet prompt has no time bound. Re-authenticate the live project
      // Safe after it closes, before the caller can POST this signature to the
      // transaction service, and prove the signed payload stayed exact.
      await reverify?.(account);
      canonicalSafeTxHash(chainId, safe, tx, digest);
      assertWalletContext(chainId);
      return signature;
    },
    [config, switchChainAsync],
  );

  return { signSafeTransactionAsync };
}
