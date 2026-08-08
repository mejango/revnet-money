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
import {
  PERMIT2_ADDRESS,
  permit2TypedData,
  type DirectSwapQuote,
  type Permit2SignatureAuthorization,
} from "@/lib/directPaySwap";
import {
  buildTransactionReviewPrompt,
  type TransactionReviewRequest,
} from "@/lib/transaction-review";
import { etherscanLink } from "@/lib/utils";
import { formatPayAmount, V6PayMode, V6PayTokenOption } from "@/lib/v6/pay";
import { JB_CHAINS, JBChainId, USDC_ADDRESSES } from "@bananapus/nana-sdk-core";
import { useState } from "react";
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

export interface PreparedV6TransactionAction {
  kind: "token-approval" | "router-approval" | "payment";
  label: string;
  request: {
    address: Address;
    abi: Abi;
    functionName: string;
    args: readonly unknown[];
    value: bigint;
  };
  calldata: Hex;
}

interface PreparedV6SignatureAction {
  kind: "router-signature";
  label: string;
  authorization: Permit2SignatureAuthorization;
}

export type PreparedV6WalletAction = PreparedV6TransactionAction | PreparedV6SignatureAction;

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
  /** How a direct swap reaches the project's hooked V4 pool. */
  swapInputRoute: DirectSwapQuote["inputRoute"] | null;
  /** Fresh previewed token return (null for add-to-balance). */
  expectedTokens: bigint | null;
  reservedTokens: bigint | null;
  minReturned: bigint;
  needsApproval: boolean;
  needsPermit2Approval: boolean;
  tokenApprovalComplete: boolean;
  routerAuthorizationComplete: boolean;
  tokenApproval: PreparedV6TransactionAction | null;
  routerApproval: PreparedV6TransactionAction | null;
  routerSignature: PreparedV6SignatureAction | null;
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
  "approving-token":
    "Confirm token access in your wallet. The payment will continue automatically…",
  "approving-router":
    "Sign or confirm the swap-router authorization in your wallet. The payment will continue automatically…",
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
  const busy =
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
            {phase === "success"
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
              {phase === "success" ? (
                <div className="py-2">
                  <p className="text-sm text-zinc-700">
                    {mode === "pay"
                      ? "Your payment went through."
                      : "The balance grew — no tokens were minted."}
                  </p>
                  {txHash && etherscanLink(txHash, { type: "tx", chainId }) ? (
                    <a
                      href={etherscanLink(txHash, { type: "tx", chainId })}
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
                      {prepared.swapInputRoute && prepared.swapInputRoute.kind !== "single-v4" ? (
                        <SummaryRow label="Route">
                          {prepared.token.symbol} → {prepared.swapInputRoute.bridgeTokenSymbol} →{" "}
                          {projectTokenSymbol}
                        </SummaryRow>
                      ) : null}
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
                          Your wallet will ask for {walletActionCount(prepared)} actions. This
                          dialog stays open and advances through each one.
                        </p>
                      ) : (
                        <p className="text-xs text-zinc-500">
                          Your wallet will ask for one action to execute this{" "}
                          {prepared.mode === "pay" ? "payment" : "balance addition"}.
                        </p>
                      )}

                      <ol className="space-y-1 rounded border border-melon-200 bg-melon-50 p-3 text-xs">
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
                            <span
                              className={
                                activeStepIndex(prepared, phase) === index
                                  ? "font-medium text-zinc-900"
                                  : "text-zinc-500"
                              }
                            >
                              {step}
                            </span>
                          </li>
                        ))}
                      </ol>

                      <p className="border border-peel-200 bg-peel-25 p-3 text-sm leading-relaxed text-peel-800">
                        This is the exact wallet action that will be sent to your wallet. Review it
                        before signing.
                      </p>

                      <PreparedPaymentReview
                        prepared={prepared}
                        action={activeWalletAction(prepared, phase)}
                        chainLabel={chainMeta?.name ?? String(prepared.chainId)}
                        projectTokenSymbol={projectTokenSymbol}
                        beneficiary={address}
                      />

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
    steps.push(
      prepared.routerSignature
        ? "Sign the swap authorization"
        : "Authorize the Uniswap swap router",
    );
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
  if (prepared.needsApproval && !prepared.tokenApprovalComplete) return 0;
  if (prepared.needsPermit2Approval && !prepared.routerAuthorizationComplete) {
    return prepared.needsApproval ? 1 : 0;
  }
  return steps.length - 1;
}

function PreparedPaymentReview({
  prepared,
  action,
  chainLabel,
  projectTokenSymbol,
  beneficiary,
}: {
  prepared: PreparedV6Pay;
  action: PreparedV6WalletAction;
  chainLabel: string;
  projectTokenSymbol: string;
  beneficiary: Address | undefined;
}) {
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  if (action.kind === "router-signature") {
    return (
      <Permit2SignatureReview
        action={action}
        chainLabel={chainLabel}
        amount={`${formatPayAmount(prepared.amount, prepared.token.decimals)} ${prepared.token.symbol}`}
      />
    );
  }
  const request = action.request;
  const destination = knownDestination(request.address, prepared);
  const reviewRequest: TransactionReviewRequest = {
    title: action.label,
    calls: [
      {
        chainId: prepared.chainId,
        to: request.address,
        from: beneficiary,
        value: request.value,
        data: action.calldata,
        abi: request.abi,
        functionName: request.functionName,
        args: request.args,
        label: action.label,
        contractName: destination.split(" | ")[0],
      },
    ],
  };
  return (
    <div className="rounded border border-melon-200 bg-melon-50 p-3 text-xs">
      <div>
        <p className="uppercase tracking-wide text-zinc-500">{chainLabel}</p>
        <p className="mt-1 break-all text-zinc-600">{destination}</p>
        <p className="mt-2 text-sm font-medium text-zinc-900">{action.label}</p>
      </div>
      <dl className="mt-2 space-y-1">
        <div className="flex items-start gap-1">
          <dt className="shrink-0 text-zinc-500">
            {action.kind === "payment" ? "Amount in:" : "Amount authorized:"}
          </dt>
          <dd className="min-w-0 text-zinc-800">
            {formatPayAmount(prepared.amount, prepared.token.decimals)} {prepared.token.symbol}
          </dd>
        </div>
        {action.kind === "token-approval" ? (
          <div className="flex items-start gap-1">
            <dt className="shrink-0 text-zinc-500">Spender:</dt>
            <dd className="min-w-0 break-all font-mono text-xs text-zinc-800">
              {knownDestination(String(request.args[0]) as Address, prepared)}
            </dd>
          </div>
        ) : null}
        {action.kind === "router-approval" ? (
          <>
            <div className="flex items-start gap-1">
              <dt className="shrink-0 text-zinc-500">Token:</dt>
              <dd className="min-w-0 break-all font-mono text-xs text-zinc-800">
                {knownTokenAddress(request.args[0], prepared.chainId)}
              </dd>
            </div>
            <div className="flex items-start gap-1">
              <dt className="shrink-0 text-zinc-500">Spender:</dt>
              <dd className="min-w-0 break-all font-mono text-xs text-zinc-800">
                {knownDestination(String(request.args[1]) as Address, prepared)}
              </dd>
            </div>
            <div className="flex items-start gap-1">
              <dt className="shrink-0 text-zinc-500">Expires:</dt>
              <dd className="min-w-0 text-zinc-800">
                {new Date(Number(request.args[3]) * 1000).toLocaleString()}
              </dd>
            </div>
          </>
        ) : null}
        {prepared.mode === "pay" && action.kind === "payment" ? (
          <>
            {prepared.swapInputRoute && prepared.swapInputRoute.kind !== "single-v4" ? (
              <div className="flex items-start gap-1">
                <dt className="shrink-0 text-zinc-500">Route:</dt>
                <dd className="min-w-0 text-zinc-800">
                  {prepared.token.symbol} → {prepared.swapInputRoute.bridgeTokenSymbol} →{" "}
                  {projectTokenSymbol}
                </dd>
              </div>
            ) : null}
            <div className="flex items-start gap-1">
              <dt className="shrink-0 text-zinc-500">Minimum received:</dt>
              <dd className="min-w-0 text-zinc-800">
                {formatPayAmount(prepared.minReturned, 18)} {projectTokenSymbol}
              </dd>
            </div>
          </>
        ) : null}
        {beneficiary && prepared.mode === "pay" && action.kind === "payment" ? (
          <div className="flex items-start gap-1">
            <dt className="shrink-0 text-zinc-500">Beneficiary:</dt>
            <dd className="min-w-0 break-all font-mono text-xs text-zinc-800">{beneficiary}</dd>
          </div>
        ) : null}
        {prepared.memo && action.kind === "payment" ? (
          <div className="flex items-start gap-1">
            <dt className="shrink-0 text-zinc-500">Note:</dt>
            <dd className="min-w-0 break-words text-zinc-800">{prepared.memo}</dd>
          </div>
        ) : null}
      </dl>
      <details className="mt-3 border-t border-melon-200 pt-2">
        <summary className="cursor-pointer select-none text-zinc-500">Show raw data</summary>
        <pre className="mt-2 max-h-52 overflow-auto whitespace-pre-wrap break-all border border-melon-300 bg-melon-100 p-3 font-mono text-xs leading-relaxed text-melon-950">
          {preparedPaymentJson(prepared, action, chainLabel)}
        </pre>
      </details>
      <div className="mt-3 flex justify-end">
        <button
          type="button"
          className="border border-melon-500 bg-melon-100 px-3 py-2 text-xs font-medium hover:bg-melon-200"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(buildTransactionReviewPrompt(reviewRequest));
              setCopyState("copied");
            } catch {
              setCopyState("failed");
            }
            window.setTimeout(() => setCopyState("idle"), 2200);
          }}
        >
          {copyState === "copied"
            ? "Prompt copied — paste into your LLM"
            : copyState === "failed"
              ? "Could not copy prompt"
              : "[copy tx audit prompt]"}
        </button>
      </div>
    </div>
  );
}

function Permit2SignatureReview({
  action,
  chainLabel,
  amount,
}: {
  action: PreparedV6SignatureAction;
  chainLabel: string;
  amount: string;
}) {
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  const typedData = permit2TypedData(action.authorization);
  const reviewRequest: TransactionReviewRequest = {
    title: action.label,
    calls: [],
    kind: "authorization",
    authorization: typedData,
  };
  return (
    <div className="rounded border border-melon-200 bg-melon-50 p-3 text-xs">
      <div>
        <p className="uppercase tracking-wide text-zinc-500">{chainLabel}</p>
        <p className="mt-1 break-all text-zinc-600">Permit2 | {PERMIT2_ADDRESS}</p>
        <p className="mt-2 text-sm font-medium text-zinc-900">{action.label}</p>
      </div>
      <dl className="mt-2 space-y-1">
        <div className="flex items-start gap-1">
          <dt className="shrink-0 text-zinc-500">Token:</dt>
          <dd className="min-w-0 break-all font-mono text-xs text-zinc-800">
            {knownTokenAddress(action.authorization.token, action.authorization.chainId)}
          </dd>
        </div>
        <div className="flex items-start gap-1">
          <dt className="shrink-0 text-zinc-500">Spender:</dt>
          <dd className="min-w-0 break-all font-mono text-xs text-zinc-800">
            Uniswap Universal Router | {action.authorization.spender}
          </dd>
        </div>
        <div className="flex items-start gap-1">
          <dt className="shrink-0 text-zinc-500">Amount:</dt>
          <dd className="min-w-0 text-zinc-800">{amount}</dd>
        </div>
        <div className="flex items-start gap-1">
          <dt className="shrink-0 text-zinc-500">Expires:</dt>
          <dd className="min-w-0 text-zinc-800">
            {new Date(action.authorization.expiration * 1000).toLocaleString()}
          </dd>
        </div>
        <div className="flex items-start gap-1">
          <dt className="shrink-0 text-zinc-500">Gas:</dt>
          <dd className="min-w-0 text-zinc-800">
            No transaction fee — this is an EIP-712 signature
          </dd>
        </div>
      </dl>
      <details className="mt-3 border-t border-melon-200 pt-2">
        <summary className="cursor-pointer select-none text-zinc-500">Show raw data</summary>
        <pre className="mt-2 max-h-52 overflow-auto whitespace-pre-wrap break-all border border-melon-300 bg-melon-100 p-3 font-mono text-xs leading-relaxed text-melon-950">
          {JSON.stringify(
            typedData,
            (_, value) => (typeof value === "bigint" ? value.toString() : value),
            2,
          )}
        </pre>
      </details>
      <div className="mt-3 flex justify-end">
        <button
          type="button"
          className="border border-melon-500 bg-melon-100 px-3 py-2 text-xs font-medium hover:bg-melon-200"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(buildTransactionReviewPrompt(reviewRequest));
              setCopyState("copied");
            } catch {
              setCopyState("failed");
            }
            window.setTimeout(() => setCopyState("idle"), 2200);
          }}
        >
          {copyState === "copied"
            ? "Prompt copied — paste into your LLM"
            : copyState === "failed"
              ? "Could not copy prompt"
              : "[copy tx audit prompt]"}
        </button>
      </div>
    </div>
  );
}

function knownDestination(address: Address, prepared: PreparedV6Pay | null): string {
  if (
    prepared?.directSwapRoute &&
    address.toLowerCase() === prepared.request.address.toLowerCase()
  ) {
    return `Uniswap Universal Router | ${address}`;
  }
  if (prepared && address.toLowerCase() === prepared.token.token.toLowerCase()) {
    return `${prepared.token.symbol} token | ${address}`;
  }
  if (prepared && address.toLowerCase() === prepared.terminal.toLowerCase()) {
    return `${prepared.viaRouterRoute ? "Juicebox Router Terminal" : "Juicebox Multi Terminal"} | ${address}`;
  }
  if (address.toLowerCase() === "0x000000000022d473030f116ddee9f6b43ac78ba3") {
    return `Permit2 | ${address}`;
  }
  return address;
}

function knownTokenAddress(value: unknown, chainId: JBChainId): string {
  const address = typeof value === "string" ? value : String(value ?? "");
  const name = USDC_ADDRESSES[chainId]?.toLowerCase() === address.toLowerCase() ? "USDC" : null;
  return name ? `${name} | ${address}` : address;
}

function activeWalletAction(prepared: PreparedV6Pay, phase: V6PayPhase): PreparedV6WalletAction {
  if (
    (phase === "ready" || phase === "approving-token") &&
    prepared.tokenApproval &&
    !prepared.tokenApprovalComplete
  ) {
    return prepared.tokenApproval;
  }
  if (
    (phase === "ready" || phase === "approving-router") &&
    (!prepared.tokenApproval || prepared.tokenApprovalComplete) &&
    !prepared.routerAuthorizationComplete &&
    (prepared.routerSignature || prepared.routerApproval)
  ) {
    return prepared.routerSignature ?? prepared.routerApproval!;
  }
  if (
    phase === "approving-router" &&
    prepared.routerSignature &&
    !prepared.routerAuthorizationComplete
  ) {
    return prepared.routerSignature;
  }
  if (
    phase === "approving-router" &&
    prepared.routerApproval &&
    !prepared.routerAuthorizationComplete
  ) {
    return prepared.routerApproval;
  }
  return {
    kind: "payment",
    label: prepared.directSwapRoute
      ? "Execute the swap"
      : prepared.mode === "pay"
        ? "Execute the payment"
        : "Add to the project balance",
    request: prepared.request,
    calldata: prepared.calldata,
  };
}

function preparedPaymentJson(
  prepared: PreparedV6Pay,
  action: PreparedV6TransactionAction,
  chainLabel: string,
): string {
  return JSON.stringify(
    {
      chain: chainLabel,
      chainId: prepared.chainId,
      contract: knownDestination(action.request.address, prepared).split(" | ")[0],
      address: action.request.address,
      function: action.request.functionName,
      args: action.request.args,
      value: action.request.value,
      calldata: action.calldata,
    },
    (_, value) => (typeof value === "bigint" ? value.toString() : value),
    2,
  );
}
