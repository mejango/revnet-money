import { chainDisplayName } from "@/app/constants";
import { AllowedDecreaseField } from "@/components/AllowedDecreaseField";
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
import { TxProgress } from "@/components/ui/TxProgress";
import { useToast } from "@/components/ui/use-toast";
import { useCashOutRoute } from "@/hooks/useCashOutRoute";
import { useProjectBaseToken } from "@/hooks/useProjectBaseToken";
import {
  failedLine,
  reviewedCall,
  ReviewRefusal,
  useReviewedAction,
  type ReviewedCall,
} from "@/hooks/useReviewedAction";
import { ProjectOperation, SuckerGroupOperation, useBendystrawQuery } from "@/lib/bendystraw";
import {
  cashOutExecutionErrorMessage,
  cashOutPoolBufferBps,
  resolveCashOutChainId,
} from "@/lib/cashOutQuote";
import {
  buildDirectSellSwapTx,
  PERMIT2_ADDRESS,
  permit2Abi,
  quoteDirectSellSwap,
} from "@/lib/directSellSwap";
import { erc20ApproveAbi } from "@/lib/erc20-approve";
import { legacyIntents } from "@/lib/legacy-intents";
import { useJBChainId, useJBTokenContext } from "@/lib/nana/project";
import {
  hasSuckerPair,
  isPairCheckPending,
  unverifiedPairLine,
  useSuckers,
  useSuckersUserTokenBalance,
} from "@/lib/nana/suckers";
import type { JBChainId } from "@/lib/nana/types";
import { formatDecimals } from "@/lib/number";
import { SAFE_PROPOSAL_PENDING_LINE, SAFE_PROPOSAL_UNCONFIRMED_LINE } from "@/lib/reviewed-call";
import { getTokenConfigForChain, isNativeToken } from "@/lib/tokenUtils";
import { formatWalletError } from "@/lib/utils";
import {
  formatUnits,
  getJBContractAddress,
  JB_CHAINS,
  JB_TOKEN_DECIMALS,
  JBCoreContracts,
  JBProjectToken,
  NATIVE_TOKEN,
} from "@bananapus/nana-sdk-core";
import { approvalIntent, cashOutIntent } from "@bananapus/nana-sdk-core/review";
import {
  getTokenAddress,
  prepareHookAwareCashOut,
  uniswapV4Deployment,
} from "@bananapus/nana-sdk-core/v6";
import { useQuery } from "@tanstack/react-query";
import { PropsWithChildren, useEffect, useState } from "react";
import { erc20Abi, type Address, type PublicClient } from "viem";
import { useAccount, usePublicClient } from "wagmi";
import { readPoolSnapshot } from "../v6/owners/market/lib";

interface Props {
  projectId: bigint;
  tokenSymbol: string;
  disabled?: boolean;
}

export function RedeemDialog(props: PropsWithChildren<Props>) {
  const { projectId, tokenSymbol, disabled, children } = props;
  // Where the amount came from: typed, a share option (Max), or the app's seed. The write's
  // intent keys an option by its name, since the amount it fills follows the balance.
  const [redeemAmount, setRedeemAmount] = useState<string>();
  // Allowed decrease tolerance in basis points; protects both routes (terminal
  // minimum on the treasury path, metadata minimum on the AMM path).
  const [slippageBps, setSlippageBps] = useState(100);

  const { address } = useAccount();
  const { data: balances } = useSuckersUserTokenBalance();
  const [cashOutChainId, setCashOutChainId] = useState<string>();
  const cashOutableBalances = balances?.filter((balance) => balance.balance.value > 0n) ?? [];
  const activeCashOutChainId = resolveCashOutChainId(
    cashOutableBalances.map((balance) => balance.chainId),
    cashOutChainId,
  );
  const chainId = useJBChainId();
  // The run's step keys and the one in the wallet, for the progress list.
  const [runKeys, setRunKeys] = useState<string[]>([]);
  const [activeStep, setActiveStep] = useState(-1);
  // From Confirm until the write returns: the quote and route reads before
  // the wallet prompt are part of the send, and the dialog must not close
  // under them.
  const [submitting, setSubmitting] = useState(false);
  const [review, setReview] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { toast } = useToast();
  const suckerQuery = useSuckers();
  const { data: suckers, verifiedPairs } = suckerQuery;
  const { token } = useJBTokenContext();
  const baseToken = useProjectBaseToken();
  const selectedChainId = activeCashOutChainId
    ? (Number(activeCashOutChainId) as JBChainId)
    : undefined;
  const publicClient = usePublicClient({ chainId: selectedChainId }) as PublicClient | undefined;

  // Get the selected sucker based on cashOutChainId
  const selectedSucker = activeCashOutChainId
    ? suckers?.find((s) => s.peerChainId === Number(activeCashOutChainId))
    : suckers?.find((s) => s.peerChainId === chainId);
  // The cash out is built for this pair's project id, so it must be one the on-chain
  // sucker registry lists, not only the indexer.
  const pairVerified = !!selectedSucker && hasSuckerPair(verifiedPairs, selectedSucker);
  const pairPending = !pairVerified && isPairCheckPending(suckerQuery);
  const pairLine =
    selectedSucker && !pairVerified
      ? unverifiedPairLine(suckerQuery, chainDisplayName(selectedSucker.peerChainId))
      : null;
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

  const sale = useReviewedAction();
  const [hash, setHash] = useState<`0x${string}`>();
  const isWriteLoading =
    sale.phase === "review" || sale.phase === "simulating" || sale.phase === "signing";
  const isTxLoading = sale.phase === "receipt";
  // Only the sale's own hash is success: a Safe that ran just the approval leaves the sale to send.
  const isSuccess = sale.phase === "done" && !!hash;
  const isTxUnconfirmed = sale.phase === "proposed" && !!sale.held?.exit;
  // const { data: redeemQuote } = useTokenCashOutQuoteEth(redeemAmountBN, {
  //   chainId: selectedSucker?.peerChainId as JBChainId,
  // });
  const loading = isWriteLoading || isTxLoading;
  const { balance } = balances?.find((b) => b.chainId === Number(activeCashOutChainId)) || {
    balance: { value: 0n },
  };
  const maxRedeemAmount = balance ? formatUnits(balance.value, projectTokenDecimals) : "0";

  const valid = redeemAmountBN > 0n && redeemAmountBN <= balance.value;

  // The selected chain's accounting-token config. Null while a chain is
  // selected means LOADING — never assume the native token: gate the quote
  // and submission until it resolves.
  const selectedChainTokenConfig = activeCashOutChainId
    ? getTokenConfigForChain(suckerGroupData, Number(activeCashOutChainId))
    : null;

  // Determine what token to receive from cashout: the native sentinel for
  // native-base projects, else the chain's own accounting token (e.g. USDC).
  const tokenToReceive = selectedChainTokenConfig
    ? isNativeToken(selectedChainTokenConfig.token)
      ? NATIVE_TOKEN
      : selectedChainTokenConfig.token
    : undefined;

  const baseDecimals = baseToken?.decimals ?? 18;

  // Hook-aware quote: previewCashOutFrom runs the real cash-out path (data
  // hook + buyback routing) and returns the exact minimum/metadata to submit.
  const {
    data: cashOutRoute,
    isFetching: isQuoteFetching,
    isError: isQuoteError,
    refetch: refetchCashOutRoute,
  } = useCashOutRoute({
    chainId: activeCashOutChainId ? (Number(activeCashOutChainId) as JBChainId) : undefined,
    projectId: redeemAmountBN ? effectiveProjectId : undefined,
    holder: address,
    cashOutCount: redeemAmountBN || undefined,
    tokenToReclaim: tokenToReceive as `0x${string}` | undefined,
    terminal: cashOutTerminal,
    slippageBps: BigInt(slippageBps),
  });

  const expectedReclaim = cashOutRoute
    ? Number(formatUnits(cashOutRoute.expectedReturn, baseDecimals))
    : 0;
  const minimumReclaim = cashOutRoute
    ? Number(formatUnits(cashOutRoute.minimumReturn, baseDecimals))
    : 0;
  const poolBufferBps = cashOutPoolBufferBps(cashOutRoute);

  const { data: projectTokenAddress } = useQuery({
    queryKey: ["cashOutProjectToken", selectedChainId, effectiveProjectId.toString()],
    enabled: !!publicClient && !!selectedChainId,
    queryFn: () =>
      getTokenAddress(publicClient!, {
        chainId: selectedChainId!,
        projectId: effectiveProjectId,
      }),
  });
  const { data: claimedBalance, refetch: refetchClaimedBalance } = useQuery({
    queryKey: ["cashOutClaimedBalance", selectedChainId, projectTokenAddress, address],
    enabled: !!publicClient && !!projectTokenAddress && !!address,
    queryFn: () =>
      publicClient!.readContract({
        address: projectTokenAddress!,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [address!],
      }),
  });
  const { data: directSell, isFetching: directSellLoading } = useQuery({
    queryKey: [
      "directCashOutSell",
      selectedChainId,
      effectiveProjectId.toString(),
      redeemAmountBN.toString(),
      cashOutRoute?.expectedReturn.toString(),
      tokenToReceive,
      slippageBps,
    ],
    enabled:
      !!publicClient &&
      !!selectedChainId &&
      !!projectTokenAddress &&
      !!tokenToReceive &&
      !!cashOutRoute &&
      redeemAmountBN > 0n &&
      (claimedBalance ?? 0n) >= redeemAmountBN,
    retry: false,
    queryFn: async () => {
      const pool = await readPoolSnapshot(selectedChainId!, effectiveProjectId).then(
        (result) => result.pool,
      );
      if (!pool) return null;
      return quoteDirectSellSwap({
        client: publicClient!,
        chainId: selectedChainId!,
        poolKey: pool.key,
        projectToken: projectTokenAddress!,
        tokenToReclaim: tokenToReceive!,
        amount: redeemAmountBN,
        cashOutRoute: cashOutRoute!,
        slippageBps,
      });
    },
  });
  const deployment =
    directSell && selectedChainId ? uniswapV4Deployment(selectedChainId) : undefined;
  const { data: erc20Allowance, refetch: refetchErc20Allowance } = useQuery({
    queryKey: ["cashOutErc20Allowance", selectedChainId, projectTokenAddress, address],
    enabled: !!publicClient && !!directSell && !!projectTokenAddress && !!address,
    queryFn: () =>
      publicClient!.readContract({
        address: projectTokenAddress!,
        abi: erc20Abi,
        functionName: "allowance",
        args: [address!, PERMIT2_ADDRESS],
      }),
  });
  const { data: routerAllowance, refetch: refetchRouterAllowance } = useQuery({
    queryKey: [
      "cashOutRouterAllowance",
      selectedChainId,
      projectTokenAddress,
      deployment?.universalRouter,
      address,
    ],
    enabled:
      !!publicClient &&
      !!directSell &&
      !!projectTokenAddress &&
      !!deployment?.universalRouter &&
      !!address,
    queryFn: () =>
      publicClient!.readContract({
        address: PERMIT2_ADDRESS,
        abi: permit2Abi,
        functionName: "allowance",
        args: [address!, projectTokenAddress!, deployment!.universalRouter as Address],
      }),
  });
  const needsErc20Approval = !!directSell && (erc20Allowance ?? 0n) < redeemAmountBN;
  const needsRouterApproval =
    !!directSell &&
    (!routerAllowance ||
      routerAllowance[0] < redeemAmountBN ||
      Number(routerAllowance[1]) <= Math.floor(Date.now() / 1000) + 1_800);

  // A finished sale spent the allowances and the balance it read.
  useEffect(() => {
    if (sale.phase !== "done") return;
    void refetchErc20Allowance();
    void refetchRouterAllowance();
    void refetchClaimedBalance();
  }, [sale.phase, refetchErc20Allowance, refetchRouterAllowance, refetchClaimedBalance]);

  // A cleared approval stops being "needed", so the queue is built from the
  // approvals this sale ever required — otherwise a finished step disappears
  // instead of ticking over to done.
  const [requiredApprovals, setRequiredApprovals] = useState<("erc20" | "router")[]>([]);
  useEffect(() => {
    setRequiredApprovals((current) => {
      const next: ("erc20" | "router")[] = directSell
        ? [
            ...(needsErc20Approval || current.includes("erc20") ? (["erc20"] as const) : []),
            ...(needsRouterApproval || current.includes("router") ? (["router"] as const) : []),
          ]
        : [];
      return next.join() === current.join() ? current : next;
    });
  }, [directSell, needsErc20Approval, needsRouterApproval]);

  // Each approval is its own wallet prompt in the one review, so the whole queue is named.
  const cashOutSteps = [
    ...requiredApprovals.map((kind) =>
      kind === "erc20"
        ? {
            key: "erc20",
            title: "Allow token use for the sale",
            detail:
              "This gives the token approval contract, Permit2, permission to move the amount shown.",
          }
        : {
            key: "router",
            title: "Allow the sale contract to use your tokens",
            detail: "Permission is limited to the amount shown and expires in 30 days.",
          },
    ),
    { key: "cashout", title: directSell ? "Sell on the market" : "Cash out" },
  ];
  const cashOutActiveIndex = isSuccess
    ? cashOutSteps.length
    : cashOutSteps.findIndex((step) => step.key === runKeys[activeStep]);
  const quotedOutput = directSell
    ? Number(formatUnits(directSell.quotedOutput, baseDecimals))
    : expectedReclaim;
  const minimumOutput = directSell
    ? Number(formatUnits(directSell.minimumOutput, baseDecimals))
    : minimumReclaim;
  const cashOutContext = selectedChainId
    ? [
        { label: "Cash out", value: `${redeemAmount} ${tokenSymbol}`, strong: true },
        { label: "On", value: chainDisplayName(selectedChainId) },
        {
          label: "You get",
          value: `~${formatDecimals(quotedOutput, 5)} ${baseToken?.symbol}`,
          note: `Stops if you would receive less than ${formatDecimals(minimumOutput, 5)} ${baseToken?.symbol}`,
        },
        {
          label: "Route",
          value: directSell ? "Sell to other traders" : "Cash out from revnet funds",
        },
        { label: "Allowed decrease", value: `${slippageBps / 100}%` },
      ]
    : [];

  const startCashOut = async () => {
    setSubmitting(true);
    try {
      if (!pairVerified) {
        throw new Error("Couldn't confirm this chain belongs to this project.");
      }
      if (!cashOutTerminal || !address || !redeemAmountBN || !cashOutRoute || !tokenToReceive) {
        console.error("Missing required data for cashout");
        throw new Error("Please try again");
      }
      const cashOut = cashOutIntent({
        chainId: selectedChainId!,
        project: effectiveProjectId,
        holder: address,
        beneficiary: address,
      });
      const legacy = legacyIntents.cashOut({
        projectId: effectiveProjectId,
        token: tokenToReceive,
        amount: redeemAmountBN,
        beneficiary: address,
      });
      const sell = directSell && projectTokenAddress && selectedChainId && deployment;
      const approvals: { key: string; call: ReviewedCall }[] = [];
      let saleCall: ReviewedCall;
      if (sell) {
        if (needsErc20Approval)
          approvals.push({
            key: "erc20",
            call: reviewedCall(
              {
                abi: erc20ApproveAbi,
                functionName: "approve",
                chainId: selectedChainId,
                address: projectTokenAddress,
                args: [PERMIT2_ADDRESS, redeemAmountBN],
              },
              {
                intent: approvalIntent(cashOut, {
                  step: "erc20",
                  token: projectTokenAddress,
                  spender: PERMIT2_ADDRESS,
                }),
              },
            ),
          });
        if (needsRouterApproval)
          approvals.push({
            key: "router",
            call: reviewedCall(
              {
                abi: permit2Abi,
                functionName: "approve",
                chainId: selectedChainId,
                address: PERMIT2_ADDRESS,
                args: [
                  projectTokenAddress,
                  deployment.universalRouter!,
                  redeemAmountBN,
                  Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60,
                ],
              },
              {
                dependsOnPrior: approvals.length > 0,
                intent: approvalIntent(cashOut, {
                  step: "permit2",
                  token: projectTokenAddress,
                  spender: deployment.universalRouter!,
                }),
              },
            ),
          });
        // The sale pays `address`: only `address` may send it.
        saleCall = reviewedCall(
          buildDirectSellSwapTx({
            chainId: selectedChainId,
            quote: directSell,
            amount: redeemAmountBN,
            recipient: address,
            deadline: BigInt(Math.floor(Date.now() / 1000) + 1_800),
          }),
          { dependsOnPrior: approvals.length > 0, intent: cashOut, legacyIntents: legacy },
        );
      } else {
        const prepared = await prepareHookAwareCashOut(publicClient!, {
          chainId: selectedChainId!,
          projectId: effectiveProjectId,
          holder: address,
          cashOutCount: redeemAmountBN,
          tokenToReclaim: tokenToReceive,
          terminal: cashOutTerminal,
          beneficiary: address,
          slippageBps: BigInt(slippageBps),
        });
        if (prepared.route.expectedReturn <= 0n) {
          throw new Error("The cash-out quote is no longer available. Review and try again.");
        }
        saleCall = reviewedCall(prepared.transaction, { intent: cashOut, legacyIntents: legacy });
      }
      const saleStep = approvals.length;
      setRunKeys([...approvals.map((approval) => approval.key), "cashout"]);
      const result = await sale.run({
        account: address,
        context: cashOutContext,
        scope: saleStep > 0 ? cashOut : undefined,
        beforeWallet: (_call, step) => setActiveStep(step),
        // Approvals can leave the review open for minutes: selling must still pay more.
        reverify: async (_call, step) => {
          if (!sell || step !== saleStep) return;
          const refreshed = await refetchCashOutRoute();
          if (refreshed.isError || !refreshed.data)
            throw new ReviewRefusal(
              "The cash-out quote is no longer available. Review and try again.",
            );
          const pool = (await readPoolSnapshot(selectedChainId, effectiveProjectId)).pool;
          const fresh = pool
            ? await quoteDirectSellSwap({
                client: publicClient!,
                chainId: selectedChainId,
                poolKey: pool.key,
                projectToken: projectTokenAddress,
                tokenToReclaim: tokenToReceive,
                amount: redeemAmountBN,
                cashOutRoute: refreshed.data,
                slippageBps,
              })
            : null;
          if (!fresh || fresh.quotedOutput < directSell.minimumOutput)
            throw new ReviewRefusal(
              "Selling no longer pays more than cashing out. Review the new estimate.",
            );
        },
        onSubmitted: (_call, step, sent) => {
          if (step === saleStep) setHash(sent);
        },
        calls: [...approvals.map((approval) => approval.call), saleCall],
      });
      setActiveStep(-1);
      if (!result || result.status === "proposed") {
        setReview(false);
        if (result)
          toast({ title: "Safe proposal submitted", description: SAFE_PROPOSAL_PENDING_LINE });
        return;
      }
      if (result.status === "failed") throw new ReviewRefusal(failedLine(result));
    } catch (err) {
      setActiveStep(-1);
      console.error("Cashout failed:", err);
      setError(cashOutExecutionErrorMessage(err) ?? formatWalletError(err));
      toast({
        variant: "destructive",
        title: "Cashout Failed",
        description: cashOutExecutionErrorMessage(err) ?? formatWalletError(err),
      });
    } finally {
      setSubmitting(false);
    }
  };

  useEffect(() => {
    if (hash) setReview(false);
  }, [hash]);

  return (
    <Dialog
      open={disabled === true ? false : undefined}
      onOpenChange={(open) => {
        // The dialog stays mounted: a finished cash out must not greet the next one.
        if (!open) {
          sale.reset();
          setHash(undefined);
          setRedeemAmount(undefined);
          setReview(false);
          setError(null);
        }
      }}
    >
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Cash out</DialogTitle>
          <DialogDescription asChild>
            <div className="my-4">
              {isSuccess ? (
                <div>Success! You can close this window.</div>
              ) : (
                <>
                  <p className="mb-4">
                    Cashing out removes your tokens from supply, called burning, in exchange for
                    revnet funds. If selling them to other traders pays more, this form offers that
                    sale instead.
                  </p>
                  <div className="mb-5 w-[65%]">
                    <span className="text-sm text-black font-medium"> Your {tokenSymbol}</span>
                    <div className="mt-1 border border-melon-300 p-3 bg-melon-25">
                      {balances?.map((balance) => (
                        <div key={balance.chainId} className="flex justify-between gap-2">
                          {chainDisplayName(balance.chainId as JBChainId)}
                          <span className="font-medium">
                            {balance.balance?.format(6)} {tokenSymbol}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="grid w-full gap-1.5">
                    <Label htmlFor="amount" className="text-zinc-900">
                      Tokens to cash out
                    </Label>
                    <div className="grid grid-cols-7 gap-2">
                      <div className="col-span-3">
                        {cashOutableBalances.length === 1 ? (
                          <div className="flex h-10 items-center gap-2 border border-melon-300 bg-melon-25 px-3 text-zinc-700">
                            <ChainLogo chainId={cashOutableBalances[0].chainId as JBChainId} />
                            {JB_CHAINS[cashOutableBalances[0].chainId as JBChainId].name}
                          </div>
                        ) : (
                          <Select
                            value={cashOutChainId}
                            onValueChange={(v) => setCashOutChainId(v)}
                          >
                            <SelectTrigger>
                              <SelectValue placeholder="Choose network" />
                            </SelectTrigger>
                            <SelectContent>
                              {cashOutableBalances.map((balance) => (
                                <SelectItem
                                  value={balance.chainId.toString()}
                                  key={balance.chainId}
                                >
                                  <div className="flex items-center gap-2">
                                    <ChainLogo chainId={balance.chainId as JBChainId} />
                                    {chainDisplayName(balance.chainId as JBChainId)}
                                  </div>
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        )}
                      </div>
                      <div className="col-span-4">
                        <div className="relative">
                          <Input
                            id="amount"
                            name="amount"
                            value={redeemAmount ?? ""}
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
                                if (!activeCashOutChainId) {
                                  return toast({
                                    variant: "warning",
                                    description: "Choose a network first.",
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

                  {redeemAmount && activeCashOutChainId && !valid ? (
                    <div className="text-red-500 mt-4">
                      Not enough {tokenSymbol} on{" "}
                      {chainDisplayName(Number(activeCashOutChainId) as JBChainId)}
                    </div>
                  ) : null}

                  {redeemAmount && valid && isQuoteError ? (
                    <div className="text-red-500 mt-4">
                      Could not estimate this cash out. If the revnet's opening wait period has not
                      ended, try again afterward.
                    </div>
                  ) : null}

                  <AllowedDecreaseField bps={slippageBps} onChange={setSlippageBps} />

                  {!directSell && poolBufferBps !== null ? (
                    <div className="mt-2 text-sm text-zinc-500">
                      This trading estimate already allows about{" "}
                      {(poolBufferBps / 100).toFixed(2).replace(/\.00$/, "")}% for the trading fee
                      and the price change caused by your sale. Your {slippageBps / 100}% setting
                      allows further change before the transaction confirms.
                    </div>
                  ) : null}

                  {redeemAmount && valid && cashOutRoute ? (
                    <div className="text-base mt-4">
                      You'll get ~{" "}
                      <span className="font-medium">
                        {formatDecimals(
                          directSell
                            ? Number(formatUnits(directSell.quotedOutput, baseDecimals))
                            : expectedReclaim,
                          5,
                        )}{" "}
                        {baseToken?.symbol}
                      </span>
                      <div className="text-sm text-zinc-500 mt-1">
                        Stops if you would receive less than{" "}
                        {formatDecimals(
                          directSell
                            ? Number(formatUnits(directSell.minimumOutput, baseDecimals))
                            : minimumReclaim,
                          5,
                        )}{" "}
                        {baseToken?.symbol}
                        {directSell
                          ? ` | selling pays more than the ${formatDecimals(expectedReclaim, 5)} ${baseToken?.symbol} cash-out estimate`
                          : " | includes the revnet’s cash-out settings"}
                      </div>
                    </div>
                  ) : null}

                  {isTxLoading ? <div>Transaction submitted, awaiting confirmation...</div> : null}
                  {isTxUnconfirmed ? <div>{SAFE_PROPOSAL_UNCONFIRMED_LINE}</div> : null}
                </>
              )}
            </div>
          </DialogDescription>
          <DialogFooter>
            {valid && pairLine ? (
              <p className="self-center text-sm text-zinc-600">{pairLine}</p>
            ) : null}
            {!isSuccess ? (
              <ButtonWithWallet
                targetChainId={selectedSucker?.peerChainId}
                loading={
                  loading || (valid && (isQuoteFetching || directSellLoading || pairPending))
                }
                disabled={valid && (!cashOutRoute || !pairVerified)}
                onClick={() => {
                  setError(null);
                  // Pin the reviewed chain: a peer balance arriving later must not unselect it.
                  if (activeCashOutChainId) setCashOutChainId(activeCashOutChainId);
                  setReview(true);
                }}
                className="bg-teal-500 text-melon-950 hover:bg-teal-600"
              >
                {directSell ? "Sell on market" : "Cash out"}
              </ButtonWithWallet>
            ) : null}
          </DialogFooter>
        </DialogHeader>
        {review && selectedChainId && cashOutRoute ? (
          <TxProgress
            open
            onClose={() => setReview(false)}
            title="Confirm cash out"
            steps={cashOutSteps}
            activeIndex={cashOutActiveIndex}
            start={() => void startCashOut()}
            busy={loading || submitting}
            error={error}
            rows={cashOutContext}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
