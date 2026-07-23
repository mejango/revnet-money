"use client";

import { ButtonWithWallet } from "@/components/ButtonWithWallet";
import { ChainLogo } from "@/components/ChainLogo";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "@/components/ui/use-toast";
import { useAllowance } from "@/hooks/useAllowance";
import {
  isSafeProposalPendingError,
  useWaitForTransactionReceipt,
  useWriteContract,
} from "@/hooks/useReviewedWriteContract";
import { useSuckerPairs } from "@/hooks/useSuckerPairs";
import type { Project } from "@/lib/bendystraw/types";
import {
  buildProtectedBridgePrepareTx,
  quoteBridgePrepare,
  slippagePercentToBps,
} from "@/lib/bridgePrepare";
import { revalidateCacheTag } from "@/lib/cache";
import { useJBTokenContext } from "@/lib/nana/project";
import { useSuckersUserTokenBalance } from "@/lib/nana/suckers";
import { getTokenAddress } from "@/lib/token";
import { getTokenSymbolFromAddress } from "@/lib/tokenUtils";
import { cn, formatTokenSymbol, formatWalletError } from "@/lib/utils";
import { JB_CHAINS, JB_TOKEN_DECIMALS, JBChainId } from "@bananapus/nana-sdk-core";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { PropsWithChildren, useCallback, useMemo, useState } from "react";
import { formatUnits, getAddress, parseUnits } from "viem";
import { useAccount, usePublicClient } from "wagmi";

interface Props {
  projects: Array<Pick<Project, "projectId" | "chainId" | "token">>;
}

export function BridgeDialog(props: PropsWithChildren<Props>) {
  const { children, projects } = props;
  const sourceChains = useMemo(() => projects.map((p) => p.chainId as JBChainId), [projects]);
  const [sourceChainId, setSourceChainId] = useState<JBChainId>(sourceChains[0]);
  const [targetChainId, setTargetChainId] = useState<JBChainId>();
  const [amount, setAmount] = useState<string>();
  const [slippagePercent, setSlippagePercent] = useState("1");
  const { token } = useJBTokenContext();
  const tokenSymbol = formatTokenSymbol(token);
  const { ensureAllowance, isApproving } = useAllowance(sourceChainId);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { address } = useAccount();
  const router = useRouter();
  const publicClient = usePublicClient({ chainId: sourceChainId });
  const { writeContractAsync, data: hash, reset } = useWriteContract();
  const { isSuccess, isLoading } = useWaitForTransactionReceipt({
    hash,
    query: { enabled: !!hash },
  });
  const { data: balances, isLoading: isBalanceLoading } = useSuckersUserTokenBalance();
  const { balance } = balances?.find((b) => b.chainId === sourceChainId) || {
    balance: { value: 0n },
  };
  const tokenDecimals = JB_TOKEN_DECIMALS;
  const maxAmount = balance ? formatUnits(balance.value, tokenDecimals) : "0";

  const project = projects.find((p) => p.chainId === sourceChainId)!;
  const { suckerPairs } = useSuckerPairs(project.projectId, sourceChainId);
  const suckerPair = suckerPairs.find(
    (candidate) => Number(candidate.remoteChainId) === targetChainId,
  );
  const amountValue = useMemo(() => {
    if (!amount) return undefined;
    try {
      const value = parseUnits(amount, tokenDecimals);
      return value > 0n ? value : undefined;
    } catch {
      return undefined;
    }
  }, [amount, tokenDecimals]);
  const slippageBps = useMemo(() => {
    try {
      return slippagePercentToBps(slippagePercent);
    } catch {
      return undefined;
    }
  }, [slippagePercent]);
  const terminalToken = useMemo(() => {
    try {
      return project.token ? getAddress(project.token) : undefined;
    } catch {
      return undefined;
    }
  }, [project.token]);
  const backingTokenSymbol = terminalToken ? getTokenSymbolFromAddress(terminalToken) : "tokens";

  const prepareQuote = useQuery({
    queryKey: [
      "bridge-prepare-quote",
      sourceChainId,
      project.projectId,
      suckerPair?.local,
      amountValue?.toString(),
      terminalToken,
      slippageBps?.toString(),
    ],
    enabled:
      !!publicClient &&
      !!suckerPair &&
      amountValue !== undefined &&
      !!terminalToken &&
      slippageBps !== undefined,
    queryFn: async () => {
      if (!publicClient || !suckerPair || amountValue === undefined || !terminalToken) {
        throw new Error("The bridge quote is incomplete.");
      }
      if (slippageBps === undefined) throw new Error("Enter a valid slippage tolerance.");

      return quoteBridgePrepare(publicClient, {
        chainId: sourceChainId,
        projectId: BigInt(project.projectId),
        sucker: suckerPair.local,
        projectTokenCount: amountValue,
        terminalToken,
        slippageBps,
      });
    },
    staleTime: 10_000,
    refetchInterval: 15_000,
    retry: 1,
  });

  const targetChains = useMemo(
    () =>
      suckerPairs
        .map((s) => Number(s.remoteChainId))
        .filter((id) => id !== sourceChainId) as JBChainId[],
    [sourceChainId, suckerPairs],
  );

  const isDisabled = isSubmitting || isLoading || isSuccess;

  const moveTokens = useCallback(async () => {
    try {
      setIsSubmitting(true);

      if (!address) {
        throw new Error("Please connect your wallet");
      }

      if (!amount || amountValue === undefined) {
        throw new Error("Please enter an amount");
      }

      if (amountValue > balance.value) {
        throw new Error("Insufficient balance");
      }

      const projectId = project.projectId;

      if (!publicClient || !projectId || !writeContractAsync || !terminalToken) {
        throw new Error("Please try again");
      }

      const reviewedQuote = prepareQuote.data;
      if (!reviewedQuote || Date.now() - prepareQuote.dataUpdatedAt > 30_000) {
        throw new Error("The bridge quote is unavailable or stale. Wait for it to refresh.");
      }

      const tokenAddress = await getTokenAddress(sourceChainId, projectId);

      if (!tokenAddress) {
        throw new Error("Couldn't determine token address. Please try again");
      }

      if (!suckerPair) {
        throw new Error("Couldn't determine sucker pair. Please try again");
      }

      await ensureAllowance(tokenAddress, suckerPair.local, amountValue);

      // An approval can leave the dialog open for minutes. Re-read immediately
      // before the write and preserve the minimum the user actually reviewed.
      const freshQuote = await prepareQuote.refetch();
      if (freshQuote.error || !freshQuote.data) {
        throw new Error("The live bridge quote could not be refreshed. Nothing was submitted.");
      }
      if (freshQuote.data.netReclaimAmount < reviewedQuote.minTokensReclaimed) {
        throw new Error("The live bridge quote fell below your reviewed minimum. Review it again.");
      }

      const request = buildProtectedBridgePrepareTx({
        chainId: sourceChainId,
        sucker: suckerPair.local,
        projectTokenCount: amountValue,
        beneficiary: address,
        minTokensReclaimed: reviewedQuote.minTokensReclaimed,
        token: terminalToken,
      });
      await writeContractAsync({ ...request, chainId: sourceChainId });
    } catch (error) {
      console.error(error);
      toast(
        isSafeProposalPendingError(error)
          ? { title: "Safe proposal submitted", description: formatWalletError(error) }
          : { variant: "destructive", title: "Error", description: formatWalletError(error) },
      );
    } finally {
      setIsSubmitting(false);
    }
  }, [
    amount,
    amountValue,
    balance.value,
    prepareQuote,
    publicClient,
    project.projectId,
    sourceChainId,
    ensureAllowance,
    suckerPair,
    writeContractAsync,
    address,
    terminalToken,
  ]);

  return (
    <Dialog
      onOpenChange={(open) => {
        if (!open) {
          reset();
          setAmount(undefined);
          setSlippagePercent("1");
          setSourceChainId(sourceChains[0]);
          setTargetChainId(undefined);
          revalidateCacheTag("suckerTransactions", 8000).then(router.refresh);
        }
      }}
    >
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Move between chains</DialogTitle>
        </DialogHeader>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            moveTokens();
          }}
        >
          <fieldset className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="sourceChainId" className="text-zinc-900">
                From chain
              </Label>
              <Select
                value={sourceChainId.toString()}
                onValueChange={(v) => {
                  const newId = Number(v) as JBChainId;
                  setSourceChainId(newId);
                  setTargetChainId(undefined);
                }}
                disabled={isDisabled}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select chain..." id="sourceChainId">
                    <div className="flex items-center gap-2">
                      <ChainLogo chainId={sourceChainId} />
                      {JB_CHAINS[sourceChainId].name}
                    </div>
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {sourceChains.map((chainId) => {
                    return (
                      <SelectItem
                        value={chainId.toString()}
                        key={chainId}
                        className="[&>*:last-child]:flex [&>*:last-child]:w-full"
                      >
                        <div className="flex items-center gap-2 grow">
                          <ChainLogo chainId={chainId} />
                          {JB_CHAINS[chainId].name}
                        </div>
                        <span className="shrink-0 pl-2">
                          {balances?.find((b) => b.chainId === chainId)?.balance.format(2)}{" "}
                          {tokenSymbol}
                        </span>
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="targetChainId" className="text-zinc-900">
                To chain
              </Label>
              <Select
                value={targetChainId?.toString() ?? ""}
                onValueChange={(v) => {
                  if (!v) return;
                  setTargetChainId(Number(v) as JBChainId);
                }}
                disabled={isDisabled}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select chain..." id="targetChainId">
                    {targetChainId && (
                      <div className="flex items-center gap-2">
                        <ChainLogo chainId={targetChainId} />
                        {JB_CHAINS[targetChainId].name}
                      </div>
                    )}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {targetChains
                    .filter((chainId) => chainId !== sourceChainId)
                    .map((chainId) => {
                      return (
                        <SelectItem
                          value={chainId.toString()}
                          key={chainId}
                          className="[&>*:last-child]:flex [&>*:last-child]:w-full"
                        >
                          <div className="flex items-center gap-2 grow">
                            <ChainLogo chainId={chainId as JBChainId} />
                            {JB_CHAINS[chainId as JBChainId].name}
                          </div>
                          <span className="shrink-0 pl-2">
                            {balances?.find((b) => b.chainId === chainId)?.balance.format(2)}{" "}
                            {tokenSymbol}
                          </span>
                        </SelectItem>
                      );
                    })}
                </SelectContent>
              </Select>
            </div>
            <div className="">
              <Label htmlFor="amount" className="text-zinc-900">
                Amount
              </Label>
              <div className="relative">
                <Input
                  id="amount"
                  name="amount"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value?.trim())}
                  disabled={isDisabled}
                  autoComplete="off"
                  type="text"
                />
                <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-3 z-10">
                  <span className="text-zinc-500 sm:text-md">{tokenSymbol}</span>
                </div>
              </div>
              <div className="flex gap-1 mt-1 mb-2 justify-end">
                {[10, 25, 50, 100].map((pct) => (
                  <button
                    key={pct}
                    type="button"
                    disabled={isBalanceLoading || isDisabled}
                    onClick={() => {
                      setAmount(
                        pct === 100 ? maxAmount : (Number(maxAmount) * (pct / 100)).toFixed(8),
                      );
                    }}
                    className="h-10 px-3 text-sm text-zinc-700 border border-zinc-300 rounded-md bg-white hover:bg-zinc-100"
                  >
                    {pct === 100 ? "Max" : `${pct}%`}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <Label htmlFor="bridge-slippage" className="text-zinc-900">
                Max quote change
              </Label>
              <div className="relative">
                <Input
                  id="bridge-slippage"
                  name="bridge-slippage"
                  value={slippagePercent}
                  onChange={(event) => setSlippagePercent(event.target.value.trim())}
                  disabled={isDisabled}
                  inputMode="decimal"
                  min="0"
                  max="5"
                  step="0.1"
                  type="number"
                />
                <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-3 z-10">
                  <span className="text-zinc-500 sm:text-md">%</span>
                </div>
              </div>
              <p className="mt-1 text-xs text-zinc-500">
                The transaction reverts below this floor.
              </p>
            </div>
            <div
              className="col-span-2 rounded-md border border-zinc-200 bg-zinc-50 p-3 text-sm"
              aria-live="polite"
            >
              {prepareQuote.isPending && prepareQuote.fetchStatus === "fetching" ? (
                <span className="text-zinc-600">Reading the live source-chain cash-out quote…</span>
              ) : prepareQuote.data ? (
                <div className="grid gap-1 sm:grid-cols-2">
                  <span className="text-zinc-600">Estimated backing received</span>
                  <span className="font-medium sm:text-right">
                    {formatUnits(
                      prepareQuote.data.netReclaimAmount,
                      prepareQuote.data.tokenDecimals,
                    )}{" "}
                    {backingTokenSymbol}
                  </span>
                  <span className="text-zinc-600">Protected minimum</span>
                  <span className="font-medium sm:text-right">
                    {formatUnits(
                      prepareQuote.data.minTokensReclaimed,
                      prepareQuote.data.tokenDecimals,
                    )}{" "}
                    {backingTokenSymbol}
                  </span>
                </div>
              ) : (
                <span className="text-amber-700">
                  {prepareQuote.error instanceof Error
                    ? prepareQuote.error.message
                    : slippageBps === undefined
                      ? "Enter a slippage tolerance from 0% to 5%."
                      : "Choose both chains and enter an amount to review the protected minimum."}
                </span>
              )}
            </div>
          </fieldset>

          <DialogFooter className="flex items-center sm:justify-between w-full gap-4">
            <div
              className={cn("text-sm text-zinc-700", {
                "animate-pulse": isApproving || isLoading,
              })}
            >
              {isApproving && "Waiting for confirmation..."}
              {isLoading && "Waiting for confirmation..."}
              {isSuccess &&
                "Success! Close the dialog and check transactions in the table to complete."}
            </div>
            <ButtonWithWallet
              targetChainId={sourceChainId}
              disabled={
                isDisabled ||
                !prepareQuote.data ||
                prepareQuote.isError ||
                amountValue === undefined ||
                amountValue > balance.value
              }
            >
              Move {tokenSymbol}
            </ButtonWithWallet>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
