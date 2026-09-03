"use client";

import { ButtonWithWallet } from "@/components/ButtonWithWallet";
import { ChainLogo } from "@/components/ChainLogo";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { SummaryRow, TxConfirmDialog } from "@/components/ui/TxConfirmDialog";
import { useToast } from "@/components/ui/use-toast";
import { useWaitForTransactionReceipt, useWriteContract } from "@/hooks/useReviewedWriteContract";
import { formatWalletError } from "@/lib/utils";
import { formatUnits, JB_CHAINS, JB_TOKEN_DECIMALS, JBChainId } from "@bananapus/nana-sdk-core";
import { buildClaimTokensTx } from "@bananapus/nana-sdk-core/v6";
import { PropsWithChildren, useEffect, useState } from "react";
import { useAccount, usePublicClient } from "wagmi";

export interface CreditRow {
  chainId: JBChainId;
  /** The project's id on that chain (sucker peers can differ per chain). */
  projectId: bigint;
  /** The wallet's unclaimed credit balance on that chain. */
  credit: bigint;
}

/**
 * Claim credits → ERC-20 (website/ parity: buildClaimModal): mint the holder's
 * unclaimed credits as transferable tokens, one `JBController.claimTokensFor`
 * transaction per chain that has credits. Each claim is simulated before the
 * write so a would-be revert surfaces in the confirm instead of a failed tx.
 */
export function V6ClaimCreditsDialog({
  creditRows,
  tokenSymbol,
  children,
}: PropsWithChildren<{ creditRows: CreditRow[]; tokenSymbol: string }>) {
  return (
    <Dialog>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Claim credits</DialogTitle>
          <DialogDescription>
            Claim your credits into transferable {tokenSymbol} ERC-20 tokens. Credits and ERC-20s
            have the same value; claiming just makes them transferable. Done per chain.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-2 mt-2">
          {creditRows.map((row) => (
            <ClaimRow key={row.chainId} row={row} tokenSymbol={tokenSymbol} />
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ClaimRow({ row, tokenSymbol }: { row: CreditRow; tokenSymbol: string }) {
  const { address } = useAccount();
  const publicClient = usePublicClient({ chainId: row.chainId });
  const { writeContractAsync, isPending } = useWriteContract();
  const [txHash, setTxHash] = useState<`0x${string}`>();
  const [isSimulating, setIsSimulating] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const chainName = JB_CHAINS[row.chainId]?.name ?? String(row.chainId);
  const creditLabel = formatUnits(row.credit, JB_TOKEN_DECIMALS, { fractionDigits: 4 });
  const { isLoading: isTxLoading, isSuccess } = useWaitForTransactionReceipt({
    hash: txHash,
    chainId: row.chainId,
  });
  const { toast } = useToast();

  useEffect(() => {
    if (isSuccess) {
      toast({
        title: "Credits claimed",
        description: `Claimed on ${JB_CHAINS[row.chainId]?.name ?? row.chainId}.`,
      });
    }
  }, [isSuccess, row.chainId, toast]);

  const claim = async () => {
    if (!address) return;
    const tx = buildClaimTokensTx({
      chainId: row.chainId,
      holder: address,
      projectId: row.projectId,
      tokenCount: row.credit,
      beneficiary: address,
    });
    setError(null);
    try {
      setIsSimulating(true);
      await publicClient?.simulateContract({
        address: tx.address,
        abi: tx.abi,
        functionName: tx.functionName,
        args: tx.args,
        account: address,
      });
      const hash = await writeContractAsync(tx);
      setTxHash(hash);
      setReviewing(false);
    } catch (err) {
      console.error("Claim credits failed:", err);
      setError(formatWalletError(err));
    } finally {
      setIsSimulating(false);
    }
  };

  return (
    <div className="flex items-center justify-between gap-3 border border-zinc-200 bg-zinc-50 p-3">
      <div className="flex items-center gap-2">
        <ChainLogo chainId={row.chainId} width={16} height={16} />
        <span className="text-sm">{JB_CHAINS[row.chainId]?.name ?? row.chainId}</span>
      </div>
      <span className="text-sm tabular-nums">
        {formatUnits(row.credit, JB_TOKEN_DECIMALS, { fractionDigits: 4 })} credits
      </span>
      <ButtonWithWallet
        targetChainId={row.chainId}
        variant="outline"
        size="sm"
        loading={isSimulating || isPending || isTxLoading}
        disabled={isSuccess}
        onClick={() => {
          setError(null);
          setReviewing(true);
        }}
      >
        {isSuccess ? "Claimed" : "Claim"}
      </ButtonWithWallet>
      <TxConfirmDialog
        open={reviewing}
        onOpenChange={(next) => {
          if (!next) setReviewing(false);
        }}
        title="Confirm claim"
        chainId={row.chainId}
        steps={[
          {
            title: `Claim ${creditLabel} credits`,
            detail: "Mints them as transferable ERC-20 tokens to your wallet.",
          },
        ]}
        activeIndex={isSimulating || isPending ? 0 : -1}
        action="Claim"
        onConfirm={() => void claim()}
        busy={isSimulating || isPending}
        error={error}
      >
        <SummaryRow label="Claims">{creditLabel} credits</SummaryRow>
        <SummaryRow label="On">{chainName}</SummaryRow>
        <SummaryRow label="You get">
          {creditLabel} {tokenSymbol} ERC-20
        </SummaryRow>
      </TxConfirmDialog>
    </div>
  );
}
