"use client";

import { ButtonWithWallet } from "@/components/ButtonWithWallet";
import { SummaryRow, TxConfirmDialog } from "@/components/ui/TxConfirmDialog";
import { useToast } from "@/components/ui/use-toast";
import { useWaitForTransactionReceipt, useWriteContract } from "@/hooks/useReviewedWriteContract";
import { useJBContractContext } from "@/lib/nana/project";
import { formatWalletError } from "@/lib/utils";
import { formatUnits, JB_CHAINS, JBChainId, jbControllerAbi } from "@bananapus/nana-sdk-core";
import { useState } from "react";

interface Props {
  chainId: JBChainId;
  projectId: bigint;
  /** The chain's pending reserved balance, when the caller has it. */
  pending?: bigint;
  tokenSymbol?: string;
}

export function DistributeReservedTokensButton(props: Props) {
  const { chainId, projectId, pending, tokenSymbol } = props;

  const { toast } = useToast();
  const [reviewing, setReviewing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const {
    contracts: { controller },
  } = useJBContractContext();

  const { writeContractAsync, isPending, data: hash } = useWriteContract();

  const { isLoading } = useWaitForTransactionReceipt({ hash });

  return (
    <>
      <ButtonWithWallet
        variant="outline"
        loading={isPending || isLoading}
        targetChainId={chainId}
        onClick={() => {
          setError(null);
          setReviewing(true);
        }}
      >
        Distribute pending splits
      </ButtonWithWallet>
      <TxConfirmDialog
        open={reviewing}
        onOpenChange={(next) => {
          if (!next) setReviewing(false);
        }}
        title="Confirm distribution"
        chainId={chainId}
        steps={[
          {
            title: "Distribute pending splits",
            detail: "Mints the reserved tokens to each recipient's share.",
          },
        ]}
        activeIndex={isPending ? 0 : -1}
        action="Distribute pending splits"
        onConfirm={async () => {
          setError(null);
          try {
            if (!controller.data || !writeContractAsync || !projectId) {
              throw new Error("Missing data. Please try again.");
            }

            await writeContractAsync({
              abi: jbControllerAbi,
              functionName: "sendReservedTokensToSplitsOf",
              chainId,
              address: controller.data,
              args: [projectId],
            });

            toast({ title: "Transaction submitted." });
            setReviewing(false);
          } catch (e) {
            console.error(e);
            setError(formatWalletError(e));
          }
        }}
        busy={isPending}
        error={error}
      >
        <SummaryRow label="Sends">
          {pending !== undefined
            ? `${formatUnits(pending, 18, { fractionDigits: 4 })} ${tokenSymbol ?? ""}`.trim()
            : "All pending reserved tokens"}
        </SummaryRow>
        <SummaryRow label="On">{JB_CHAINS[chainId]?.name ?? chainId}</SummaryRow>
        <SummaryRow label="To">This stage&apos;s split recipients</SummaryRow>
      </TxConfirmDialog>
    </>
  );
}
