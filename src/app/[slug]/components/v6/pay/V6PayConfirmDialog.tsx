"use client";

import { ButtonWithWallet } from "@/components/ButtonWithWallet";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatPayAmount, V6PayMode, V6PayTokenOption } from "@/lib/v6/pay";
import {
  registerTransactionReviewHandler,
  transactionReviewJson,
  type TransactionReviewRequest,
} from "@/lib/transaction-review";
import { JB_CHAINS, JBChainId } from "@bananapus/nana-sdk-core";
import { useEffect, useRef, useState } from "react";
import { Abi, Address, Hex } from "viem";
import { useAccount } from "wagmi";
import { useSelectedSucker } from "../../PayCard/SelectedSuckerContext";

export type V6PayPhase =
  | "preparing"
  | "ready"
  | "approving-token"
  | "approving-router"
  | "simulating"
  | "signing"
  | "pending"
  | "safe-proposed"
  | "success";

/** A fully resolved, encodable pay/add-to-balance transaction. */
export interface PreparedV6Pay {
  mode: V6PayMode;
  chainId: JBChainId;
  token: V6PayTokenOption;
  amount: bigint;
  memo: string;
  terminal: Address;
  /** True when the resolved route goes through the router registry (swap). */
  viaRouterRoute: boolean;
  /** True when payment bypasses the terminal for a better direct pool swap. */
  directSwapRoute: boolean;
  /** Fresh previewed token return (null for add-to-balance). */
  expectedTokens: bigint | null;
  reservedTokens: bigint | null;
  minReturned: bigint;
  needsApproval: boolean;
  needsPermit2Approval: boolean;
  cartRows: { tierId: number; quantity: number; name: string }[];
  request: {
    address: Address;
    abi: Abi;
    functionName: string;
    args: readonly unknown[];
    value: bigint;
  };
  calldata: Hex;
}

const PHASE_LABELS: Record<Exclude<V6PayPhase, "ready" | "safe-proposed" | "success">, string> = {
  preparing: "Getting a fresh quote…",
  "approving-token": "Confirm token access in your wallet. The payment will continue automatically…",
  "approving-router": "Confirm the swap-router authorization in your wallet. The payment will continue automatically…",
  simulating: "Simulating the transaction…",
  signing: "Confirm in your wallet…",
  pending: "Transaction submitted, awaiting confirmation…",
};

/**
 * The confirm-before-send dialog: a human summary of exactly what will be
 * sent and the wallet-aware action button. The payment card owns route and
 * chain selection; this dialog only confirms the resolved transaction.
 */
export function V6PayConfirmDialog({
  open,
  onOpenChange,
  prepared,
  phase,
  mode,
  error,
  projectTokenSymbol,
  txHash,
  onConfirm,
  onDone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  prepared: PreparedV6Pay | null;
  phase: V6PayPhase;
  mode: V6PayMode;
  error: string | null;
  projectTokenSymbol: string;
  txHash: `0x${string}` | undefined;
  onConfirm: () => void;
  /** Retained for caller compatibility; chain selection belongs to the payment card. */
  onSwitchChain?: (chainId: string) => void;
  onDone: () => void;
}) {
  const [review, setReview] = useState<TransactionReviewRequest | null>(null);
  const reviewResolver = useRef<((approved: boolean) => void) | null>(null);
  const [reviewAgreed, setReviewAgreed] = useState(false);
  useEffect(() => {
    if (!open) return;
    return registerTransactionReviewHandler(
      (request) =>
        new Promise<boolean>((resolve) => {
          reviewResolver.current?.(false);
          reviewResolver.current = resolve;
          setReviewAgreed(false);
          setReview(request);
        }),
    );
  }, [open]);
  useEffect(
    () => () => {
      reviewResolver.current?.(false);
      reviewResolver.current = null;
    },
    [],
  );
  const finishReview = (approved: boolean) => {
    const resolve = reviewResolver.current;
    reviewResolver.current = null;
    setReview(null);
    setReviewAgreed(false);
    resolve?.(approved);
  };
  const busy =
    !!review ||
    phase === "approving-token" ||
    phase === "approving-router" ||
    phase === "simulating" ||
    phase === "signing" ||
    phase === "pending";
  const { address } = useAccount();
  const { selectedSucker } = useSelectedSucker();
  const chainId = prepared?.chainId ?? selectedSucker.peerChainId;
  const chainMeta = JB_CHAINS[chainId];

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (busy) return;
        if (!next && phase === "success") onDone();
        onOpenChange(next);
      }}
    >
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {review
              ? review.kind === "authorization"
                ? "Review authorization"
                : "Review wallet action"
              : phase === "success"
              ? mode === "pay"
                ? "Payment confirmed"
                : "Added to the balance"
              : phase === "safe-proposed"
                ? "Safe proposal submitted"
                : mode === "pay"
                  ? "Confirm payment"
                  : "Confirm add to balance"}
          </DialogTitle>
          <DialogDescription asChild>
            <div className="text-left">
              {review ? (
                <div className="space-y-4 py-2">
                  <p className="text-sm leading-relaxed text-zinc-600">
                    This is the next wallet action in your payment sequence. Review it here, then
                    continue in your wallet.
                  </p>
                  {review.calls.map((call, index) => (
                    <div key={`${call.to}:${index}`} className="rounded border border-zinc-200 bg-zinc-50 p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-sm font-medium text-zinc-900">
                            {call.label ?? humanFunctionName(call.functionName)}
                          </p>
                          <p className="mt-0.5 text-xs text-zinc-500">
                            {knownDestination(call.to, prepared)}
                          </p>
                        </div>
                        <span className="text-xs text-zinc-500">
                          {JB_CHAINS[call.chainId as JBChainId]?.name ?? call.chainId}
                        </span>
                      </div>
                      {call.functionName ? (
                        <p className="mt-3 font-mono text-xs text-zinc-700">
                          {call.functionName}({humanArgs(call.args, prepared)})
                        </p>
                      ) : null}
                      <details className="mt-3 border-t border-zinc-200 pt-2 text-xs">
                        <summary className="cursor-pointer select-none text-zinc-500">
                          Raw transaction data
                        </summary>
                        <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-all rounded bg-zinc-900 p-3 font-mono text-[10px] leading-relaxed text-zinc-100">
                          {transactionReviewJson({ ...review, calls: [call] })}
                        </pre>
                      </details>
                    </div>
                  ))}
                  <label className="flex cursor-pointer items-start gap-3 rounded border border-zinc-200 p-3 text-sm text-zinc-700">
                    <input
                      type="checkbox"
                      checked={reviewAgreed}
                      onChange={(event) => setReviewAgreed(event.target.checked)}
                      className="mt-0.5"
                    />
                    <span>I reviewed this wallet action and agree to continue with the payment.</span>
                  </label>
                  <div className="flex justify-end gap-2">
                    <Button variant="outline" onClick={() => finishReview(false)}>
                      Cancel
                    </Button>
                    <Button
                      disabled={!reviewAgreed}
                      className="bg-teal-500 text-melon-950 hover:bg-teal-600"
                      onClick={() => finishReview(true)}
                    >
                      Continue to wallet
                    </Button>
                  </div>
                </div>
              ) : phase === "success" ? (
                <div className="py-2">
                  <p className="text-sm text-zinc-700">
                    {mode === "pay"
                      ? "Your payment went through."
                      : "The balance grew — no tokens were minted."}
                  </p>
                  {txHash && chainMeta ? (
                    <a
                      href={`https://${chainMeta.etherscanHostname}/tx/${txHash}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-2 inline-block text-xs text-zinc-500 underline underline-offset-2 hover:text-zinc-900"
                    >
                      View the transaction
                    </a>
                  ) : null}
                  <div className="mt-4">
                    <Button
                      className="bg-teal-500 text-melon-950 hover:bg-teal-600"
                      onClick={onDone}
                    >
                      Done
                    </Button>
                  </div>
                </div>
              ) : phase === "safe-proposed" ? (
                <div className="py-2">
                  <p className="text-sm leading-relaxed text-zinc-700">
                    The Safe has accepted this proposal, but the payment has not reached the project
                    yet. It still needs the required approvals and successful onchain execution.
                    Track the persistent transaction status and do not submit it again.
                  </p>
                  {txHash ? (
                    <p className="mt-2 break-all font-mono text-xs text-zinc-500">{txHash}</p>
                  ) : null}
                  <Button
                    className="mt-4 bg-teal-500 text-melon-950 hover:bg-teal-600"
                    onClick={() => onOpenChange(false)}
                  >
                    Close and track status
                  </Button>
                </div>
              ) : (
                <>
                  {phase === "preparing" ? (
                    <div className="py-4 text-sm text-zinc-500">
                      {address
                        ? PHASE_LABELS.preparing
                        : "Connect your wallet to get a live quote."}
                    </div>
                  ) : prepared ? (
                    <div className="flex flex-col gap-3 py-2">
                      <SummaryRow label="Send">
                        {formatPayAmount(prepared.amount, prepared.token.decimals)}{" "}
                        {prepared.token.symbol}
                      </SummaryRow>
                      <SummaryRow label="On">
                        {chainMeta?.name ?? String(prepared.chainId)}
                      </SummaryRow>
                      {prepared.mode === "pay" ? (
                        <SummaryRow
                          label={prepared.viaRouterRoute ? "You get at least" : "You get"}
                        >
                          {formatPayAmount(prepared.minReturned, 18)} {projectTokenSymbol}
                        </SummaryRow>
                      ) : (
                        <SummaryRow label="Effect">
                          Adds to the project balance — nothing else.
                        </SummaryRow>
                      )}
                      {prepared.cartRows.length > 0 ? (
                        <SummaryRow label="Items">
                          {prepared.cartRows
                            .map((row) => `${row.quantity}× ${row.name}`)
                            .join(", ")}
                        </SummaryRow>
                      ) : null}
                      {prepared.memo ? <SummaryRow label="Note">{prepared.memo}</SummaryRow> : null}
                      {prepared.needsApproval || prepared.needsPermit2Approval ? (
                        <p className="text-xs text-zinc-500">
                          Your wallet will ask for {walletActionCount(prepared)} actions. This dialog
                          stays open and advances through each one.
                        </p>
                      ) : (
                        <p className="text-xs text-zinc-500">
                          Your wallet will ask for one action to execute this {prepared.mode === "pay" ? "payment" : "balance addition"}.
                        </p>
                      )}

                      <ol className="space-y-1 rounded border border-zinc-200 bg-white p-3 text-xs">
                        {walletActionSteps(prepared).map((step, index) => (
                          <li key={step} className="flex items-center gap-2">
                            <span
                              className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${
                                activeStepIndex(prepared, phase) === index
                                  ? "border-teal-600 bg-teal-50 text-teal-700"
                                  : activeStepIndex(prepared, phase) > index
                                    ? "border-teal-500 bg-teal-500 text-white"
                                    : "border-zinc-300 text-zinc-400"
                              }`}
                            >
                              {activeStepIndex(prepared, phase) > index ? "✓" : index + 1}
                            </span>
                            <span className={activeStepIndex(prepared, phase) === index ? "font-medium text-zinc-900" : "text-zinc-500"}>
                              {step}
                            </span>
                          </li>
                        ))}
                      </ol>

                      <details className="mt-1 rounded border border-zinc-200 bg-zinc-50 p-2 text-xs">
                        <summary className="cursor-pointer select-none text-zinc-600">
                          Transaction details
                        </summary>
                        <div className="mt-2 space-y-2 text-[11px] text-zinc-600">
                          <div>
                            <span className="text-zinc-500">Destination · </span>
                            <span className="font-medium text-zinc-800">
                              {knownDestination(prepared.request.address, prepared)}
                            </span>
                          </div>
                          <div>
                            <span className="text-zinc-500">Action · </span>
                            <span className="font-mono text-zinc-800">
                              {prepared.request.functionName}
                            </span>
                          </div>
                          <details>
                            <summary className="cursor-pointer select-none">Raw calldata</summary>
                            <div className="mt-1 break-all font-mono text-[10px]">
                              {prepared.calldata}
                            </div>
                          </details>
                        </div>
                      </details>

                      {busy ? (
                        <p className="text-sm text-zinc-500">
                          {PHASE_LABELS[phase as keyof typeof PHASE_LABELS]}
                        </p>
                      ) : null}
                      {error ? <p className="text-sm text-red-600">{error}</p> : null}
                    </div>
                  ) : error ? (
                    <p className="py-4 text-sm text-red-600">{error}</p>
                  ) : null}

                  <div className="flex justify-end">
                    <ButtonWithWallet
                      targetChainId={chainId}
                      loading={busy || (phase === "preparing" && !!address)}
                      onClick={onConfirm}
                      connectWalletText="Connect Wallet"
                      className="bg-teal-500 text-melon-950 hover:bg-teal-600"
                    >
                      {mode === "pay" ? "Pay" : "Add to balance"}
                    </ButtonWithWallet>
                  </div>
                </>
              )}
            </div>
          </DialogDescription>
        </DialogHeader>
      </DialogContent>
    </Dialog>
  );
}

function SummaryRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <span className="shrink-0 text-sm text-zinc-500">{label}</span>
      <span className="text-right text-sm text-zinc-900">{children}</span>
    </div>
  );
}

function walletActionSteps(prepared: PreparedV6Pay): string[] {
  const steps: string[] = [];
  if (prepared.needsApproval) {
    steps.push(`Approve ${prepared.token.symbol} access`);
  }
  if (prepared.needsPermit2Approval) {
    steps.push("Authorize the Uniswap swap router");
  }
  steps.push(
    prepared.mode === "pay"
      ? prepared.directSwapRoute
        ? "Execute the swap"
        : "Execute the payment"
      : "Add to the project balance",
  );
  return steps;
}

function walletActionCount(prepared: PreparedV6Pay): number {
  return walletActionSteps(prepared).length;
}

function activeStepIndex(prepared: PreparedV6Pay, phase: V6PayPhase): number {
  const steps = walletActionSteps(prepared);
  if (phase === "approving-token") return 0;
  if (phase === "approving-router") return prepared.needsApproval ? 1 : 0;
  if (phase === "simulating" || phase === "signing" || phase === "pending") return steps.length - 1;
  if (phase === "success") return steps.length;
  return 0;
}

function humanFunctionName(functionName?: string): string {
  if (functionName === "approve") return "Approve token access";
  if (functionName === "execute") return "Execute swap";
  if (functionName === "pay") return "Send payment";
  if (functionName === "addToBalanceOf") return "Add to project balance";
  return functionName ? `Review ${functionName}` : "Review wallet action";
}

function knownDestination(address: Address, prepared: PreparedV6Pay | null): string {
  if (prepared?.directSwapRoute && address.toLowerCase() === prepared.request.address.toLowerCase()) {
    return `Uniswap Universal Router · ${address}`;
  }
  if (prepared && address.toLowerCase() === prepared.token.token.toLowerCase()) {
    return `${prepared.token.symbol} token · ${address}`;
  }
  if (prepared && address.toLowerCase() === prepared.terminal.toLowerCase()) {
    return `${prepared.viaRouterRoute ? "Juicebox Router Terminal" : "Juicebox Multi Terminal"} · ${address}`;
  }
  if (address.toLowerCase() === "0x000000000022d473030f116ddee9f6b43ac78ba3") {
    return `Permit2 · ${address}`;
  }
  return address;
}

function humanArgs(args: readonly unknown[] | undefined, prepared: PreparedV6Pay | null): string {
  if (!args?.length) return "";
  if (prepared && args.length === 2 && typeof args[0] === "string" && typeof args[1] === "bigint") {
    return `${knownDestination(args[0] as Address, prepared)}, ${formatPayAmount(args[1], prepared.token.decimals)} ${prepared.token.symbol}`;
  }
  if (prepared && args.length === 4 && typeof args[0] === "string" && typeof args[2] === "bigint") {
    return `${prepared.token.symbol}, ${knownDestination(args[1] as Address, prepared)}, ${formatPayAmount(args[2], prepared.token.decimals)} ${prepared.token.symbol}, expires ${new Date(Number(args[3]) * 1000).toLocaleString()}`;
  }
  return args
    .map((arg) => (typeof arg === "bigint" ? arg.toString() : typeof arg === "string" ? arg : "…"))
    .join(", ");
}
