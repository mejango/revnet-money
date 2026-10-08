"use client";

import { permit2TypedData, type Permit2SignatureAuthorization } from "@/lib/directPaySwap";
import { captureReviewedWalletContext } from "@/lib/reviewed-wallet-context";
import { requireTransactionReview } from "@/lib/transaction-review";
import { getAccount } from "@wagmi/core";
import { useCallback } from "react";
import type { Address } from "viem";
import { useConfig, useSignTypedData, useSwitchChain } from "wagmi";

export function useReviewedPermit2Signature(options?: { reviewedInParent?: boolean }) {
  const config = useConfig();
  const { signTypedDataAsync } = useSignTypedData();
  const { switchChainAsync } = useSwitchChain();

  const signPermit2Async = useCallback(
    async ({
      authorization,
      expectedAccount,
    }: {
      authorization: Permit2SignatureAuthorization;
      expectedAccount: Address;
    }) => {
      const assertWalletContext = captureReviewedWalletContext(
        config,
        expectedAccount,
        "Connected account changed. Review the payment again.",
        "Wallet account or network changed. Review the payment again.",
      );
      const typedData = permit2TypedData(authorization);
      if (!options?.reviewedInParent) {
        await requireTransactionReview({
          title: "Sign the swap authorization",
          calls: [],
          kind: "authorization",
          authorization: typedData,
        });
      }
      assertWalletContext();
      if (getAccount(config).chainId !== authorization.chainId) {
        await switchChainAsync({ chainId: authorization.chainId });
      }
      assertWalletContext(authorization.chainId);
      const signature = await signTypedDataAsync({
        account: expectedAccount,
        ...typedData,
      });
      const after = getAccount(config);
      if (
        !after.address ||
        after.address.toLowerCase() !== expectedAccount.toLowerCase() ||
        after.chainId !== authorization.chainId
      ) {
        throw new Error("Wallet account or network changed after signing. Nothing was sent.");
      }
      assertWalletContext(authorization.chainId);
      return signature;
    },
    [config, options?.reviewedInParent, signTypedDataAsync, switchChainAsync],
  );

  return { signPermit2Async };
}
