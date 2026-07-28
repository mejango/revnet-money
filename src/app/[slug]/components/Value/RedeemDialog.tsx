import { ButtonWithWallet } from "@/components/ButtonWithWallet";
import { ChainLogo } from "@/components/ChainLogo";
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
import { useToast } from "@/components/ui/use-toast";
import { useCashOutRoute } from "@/hooks/useCashOutRoute";
import { useProjectBaseToken } from "@/hooks/useProjectBaseToken";
import { useWaitForTransactionReceipt, useWriteContract } from "@/hooks/useReviewedWriteContract";
import { ProjectOperation, SuckerGroupOperation, useBendystrawQuery } from "@/lib/bendystraw";
import { useJBChainId, useJBTokenContext } from "@/lib/nana/project";
import { useSuckers, useSuckersUserTokenBalance } from "@/lib/nana/suckers";
import type { JBChainId } from "@/lib/nana/types";
import { formatDecimals } from "@/lib/number";
import { getTokenConfigForChain } from "@/lib/tokenUtils";
import { formatWalletError } from "@/lib/utils";
import {
  formatUnits,
  getJBContractAddress,
  JB_CHAINS,
  JB_TOKEN_DECIMALS,
  JBCoreContracts,
  jbMultiTerminalAbi,
  JBProjectToken,
  NATIVE_TOKEN,
} from "@bananapus/nana-sdk-core";
import { PropsWithChildren, useState } from "react";
import { useAccount } from "wagmi";

interface Props {
  projectId: bigint;
  tokenSymbol: string;
  disabled?: boolean;
}

export function RedeemDialog(props: PropsWithChildren<Props>) {
  const { projectId, tokenSymbol, disabled, children } = props;
  const [redeemAmount, setRedeemAmount] = useState<string>();
  // Max slippage tolerance in basis points; protects both routes (terminal
  // minimum on the treasury path, metadata minimum on the AMM path).
  const [slippageBps, setSlippageBps] = useState(100);

  const { address } = useAccount();
  const { data: balances } = useSuckersUserTokenBalance();
  const [cashOutChainId, setCashOutChainId] = useState<string>();
  const chainId = useJBChainId();
  const [isApproving, setIsApproving] = useState(false);
  const { toast } = useToast();
  const { data: suckers } = useSuckers();
  const { token } = useJBTokenContext();
  const baseToken = useProjectBaseToken();

  // Get the selected sucker based on cashOutChainId
  const selectedSucker = cashOutChainId
    ? suckers?.find((s) => s.peerChainId === Number(cashOutChainId))
    : suckers?.find((s) => s.peerChainId === chainId);
  const cashOutTerminal = selectedSucker
    ? getJBContractAddress(
        JBCoreContracts.JBMultiTerminal,
        6,
        selectedSucker.peerChainId as JBChainId,
      )
    : undefined;

  // Get the correct project ID for the selected chain
  const effectiveProjectId = selectedSucker?.projectId || projectId;

  // Get the suckerGroupId from the current project
  const { data: projectData } = useBendystrawQuery(
    ProjectOperation,
    { chainId: Number(chainId), projectId: Number(projectId), version: 6 },
    { enabled: !!chainId && !!projectId },
  );
  const suckerGroupId = projectData?.project?.suckerGroupId;

  // Get all projects in the sucker group with their token data
  const { data: suckerGroupData } = useBendystrawQuery(
    SuckerGroupOperation,
    { id: suckerGroupId ?? "" },
    { enabled: !!suckerGroupId, chainId: Number(chainId) },
  );

  // Use project token decimals, not base token decimals
  const projectTokenDecimals = token?.data?.decimals || JB_TOKEN_DECIMALS;

  const redeemAmountBN = redeemAmount
    ? JBProjectToken.parse(redeemAmount, projectTokenDecimals).value
    : 0n;

  const { writeContractAsync, isPending: isWriteLoading, data: hash } = useWriteContract();

  const { isLoading: isTxLoading, isSuccess } = useWaitForTransactionReceipt({ hash });
  // const { data: redeemQuote } = useTokenCashOutQuoteEth(redeemAmountBN, {
  //   chainId: selectedSucker?.peerChainId as JBChainId,
  // });
  const loading = isWriteLoading || isTxLoading;
  const { balance } = balances?.find((b) => b.chainId === Number(cashOutChainId)) || {
    balance: { value: 0n },
  };
  const maxRedeemAmount = balance ? formatUnits(balance.value, projectTokenDecimals) : "0";

  const valid = redeemAmountBN > 0n && redeemAmountBN <= balance.value;

  // Get the correct token address for the selected chain
  const getTokenForChain = (targetChainId: number) => {
    return getTokenConfigForChain(suckerGroupData, targetChainId).token;
  };

  const selectedChainToken = cashOutChainId
    ? getTokenForChain(Number(cashOutChainId))
    : NATIVE_TOKEN;

  const isNative = selectedChainToken === NATIVE_TOKEN.toLowerCase();

  // Determine what token to receive from cashout
  // For ETH projects: receive ETH (NATIVE_TOKEN)
  // For USDC projects: receive USDC (the project's base token)
  const tokenToReceive = isNative ? NATIVE_TOKEN : selectedChainToken;

  const baseDecimals = baseToken?.decimals ?? 18;

  // Hook-aware quote: previewCashOutFrom runs the real cash-out path (data
  // hook + buyback routing) and returns the exact minimum/metadata to submit.
  const {
    data: cashOutRoute,
    isFetching: isQuoteFetching,
    isError: isQuoteError,
  } = useCashOutRoute({
    chainId: cashOutChainId ? (Number(cashOutChainId) as JBChainId) : undefined,
    projectId: redeemAmountBN ? effectiveProjectId : undefined,
    holder: address,
    cashOutCount: redeemAmountBN || undefined,
    tokenToReclaim: tokenToReceive as `0x${string}`,
    terminal: cashOutTerminal,
    slippageBps: BigInt(slippageBps),
  });

  const expectedReclaim = cashOutRoute
    ? Number(formatUnits(cashOutRoute.expectedReturn, baseDecimals))
    : 0;
  const minimumReclaim = cashOutRoute
    ? Number(formatUnits(cashOutRoute.minimumReturn, baseDecimals))
    : 0;

  return (
    <Dialog open={disabled === true ? false : undefined}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Cash out</DialogTitle>
          <DialogDescription>
            <div className="my-4">
              {isSuccess ? (
                <div>Success! You can close this window.</div>
              ) : (
                <>
                  <div className="mb-5 w-[65%]">
                    <span className="text-sm text-black font-medium"> Your {tokenSymbol}</span>
                    <div className="mt-1 border border-zinc-200 p-3 bg-zinc-50">
                      {balances?.map((balance) => (
                        <div key={balance.chainId} className="flex justify-between gap-2">
                          {JB_CHAINS[balance.chainId as JBChainId].name}
                          <span className="font-medium">
                            {balance.balance?.format(6)} {tokenSymbol}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="grid w-full gap-1.5">
                    <Label htmlFor="amount" className="text-zinc-900">
                      Cash out amount
                    </Label>
                    <div className="grid grid-cols-7 gap-2">
                      <div className="col-span-3">
                        <Select onValueChange={(v) => setCashOutChainId(v)}>
                          <SelectTrigger>
                            <SelectValue placeholder="Select chain" />
                          </SelectTrigger>
                          <SelectContent>
                            {balances
                              ?.filter((b) => b.balance.value > 0n)
                              .map((balance) => {
                                return (
                                  <SelectItem
                                    value={balance.chainId.toString()}
                                    key={balance.chainId}
                                  >
                                    <div className="flex items-center gap-2">
                                      <ChainLogo chainId={balance.chainId as JBChainId} />
                                      {JB_CHAINS[balance.chainId as JBChainId].name}
                                    </div>
                                  </SelectItem>
                                );
                              })}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="col-span-4">
                        <div className="relative">
                          <Input
                            id="amount"
                            name="amount"
                            value={redeemAmount}
                            onChange={(e) => setRedeemAmount(e.target.value?.trim())}
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
                              onClick={() => {
                                if (!cashOutChainId) {
                                  return toast({
                                    variant: "warning",
                                    description: "Please select a chain first.",
                                  });
                                }
                                setRedeemAmount(
                                  pct === 100
                                    ? maxRedeemAmount
                                    : (Number(maxRedeemAmount) * (pct / 100)).toFixed(8),
                                );
                              }}
                              className="h-10 px-3 text-sm text-zinc-700 border border-zinc-300 rounded-md bg-white hover:bg-zinc-100"
                            >
                              {pct === 100 ? "Max" : `${pct}%`}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>

                  {redeemAmount && cashOutChainId && !valid ? (
                    <div className="text-red-500 mt-4">
                      Insuffient {tokenSymbol} on{" "}
                      {JB_CHAINS[Number(cashOutChainId) as JBChainId].name}
                    </div>
                  ) : null}

                  {redeemAmount && valid && isQuoteError ? (
                    <div className="text-red-500 mt-4">
                      Couldn't quote this cash out. Cash outs unlock after the revnet's initial
                      delay — if it's still locked, try again later.
                    </div>
                  ) : null}

                  <div className="flex items-center gap-2 mt-4">
                    <span className="text-sm text-zinc-700">Max slippage</span>
                    <div className="flex gap-1">
                      {[50, 100, 300].map((bps) => (
                        <button
                          key={bps}
                          type="button"
                          onClick={() => setSlippageBps(bps)}
                          className={
                            slippageBps === bps
                              ? "h-7 px-2 text-sm rounded-md border border-teal-500 bg-teal-500 text-melon-950"
                              : "h-7 px-2 text-sm rounded-md border border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-100"
                          }
                        >
                          {bps / 100}%
                        </button>
                      ))}
                    </div>
                  </div>

                  {redeemAmount && valid && cashOutRoute ? (
                    <div className="text-base mt-4">
                      You'll get ~{" "}
                      <span className="font-medium">
                        {formatDecimals(expectedReclaim, 5)} {baseToken?.symbol}
                      </span>
                      <div className="text-sm text-zinc-500 mt-1">
                        Reverts below {formatDecimals(minimumReclaim, 5)} {baseToken?.symbol}
                      </div>
                    </div>
                  ) : null}

                  {isTxLoading ? <div>Transaction submitted, awaiting confirmation...</div> : null}
                </>
              )}
            </div>
          </DialogDescription>
          <DialogFooter>
            {!isSuccess ? (
              <ButtonWithWallet
                targetChainId={selectedSucker?.peerChainId}
                loading={loading || isApproving || (valid && isQuoteFetching)}
                disabled={valid && !cashOutRoute}
                onClick={async () => {
                  try {
                    if (
                      !cashOutTerminal ||
                      !address ||
                      !redeemAmountBN ||
                      !cashOutRoute ||
                      !writeContractAsync
                    ) {
                      console.error("Missing required data for cashout");
                      throw new Error("Please try again");
                    }

                    await writeContractAsync({
                      abi: jbMultiTerminalAbi,
                      functionName: "cashOutTokensOf",
                      chainId: selectedSucker?.peerChainId,
                      address: cashOutTerminal,
                      args: [
                        address, // holder
                        effectiveProjectId, // project id
                        redeemAmountBN, // cash out count
                        tokenToReceive, // token to reclaim
                        // On the treasury route the slippage floor lives here; on
                        // the AMM route it lives in the metadata and this is 0.
                        cashOutRoute.terminalMinimum, // min tokens reclaimed
                        address, // beneficiary
                        cashOutRoute.metadata, // metadata
                      ],
                    });
                  } catch (err) {
                    setIsApproving(false);
                    console.error("Cashout failed:", err);
                    toast({
                      variant: "destructive",
                      title: "Cashout Failed",
                      description: formatWalletError(err),
                    });
                  }
                }}
              >
                {isApproving ? "Approving..." : "Cash out"}
              </ButtonWithWallet>
            ) : null}
          </DialogFooter>
        </DialogHeader>
      </DialogContent>
    </Dialog>
  );
}
