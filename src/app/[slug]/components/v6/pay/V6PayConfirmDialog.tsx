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
import { JB_CHAINS, JBChainId } from "@bananapus/nana-sdk-core";
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

export interface PreparedV6WalletAction {
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
  tokenApproval: PreparedV6WalletAction | null;
  routerApproval: PreparedV6WalletAction | null;
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
  const request = action.request;
  return (
    <div className="rounded border border-zinc-200 bg-zinc-50 p-3 text-xs">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="uppercase tracking-wide text-zinc-500">Exact wallet action</p>
          <p className="mt-1 text-sm font-medium text-zinc-900">{action.label}</p>
        </div>
        <span className="text-zinc-500">{chainLabel}</span>
      </div>
      <dl className="mt-3 space-y-2">
        <div>
          <dt className="text-zinc-500">Destination</dt>
          <dd className="mt-0.5 break-all text-zinc-800">
            {knownDestination(request.address, prepared)}
          </dd>
        </div>
        <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
          <dt className="text-zinc-500">
            {action.kind === "payment" ? "Amount in" : "Amount authorized"}
          </dt>
          <dd className="text-right text-zinc-800">
            {formatPayAmount(prepared.amount, prepared.token.decimals)} {prepared.token.symbol}
          </dd>
          {action.kind === "token-approval" ? (
            <>
              <dt className="text-zinc-500">Spender</dt>
              <dd className="break-all text-right font-mono text-[10px] text-zinc-800">
                {knownDestination(String(request.args[0]) as Address, prepared)}
              </dd>
            </>
          ) : null}
          {action.kind === "router-approval" ? (
            <>
              <dt className="text-zinc-500">Token</dt>
              <dd className="break-all text-right font-mono text-[10px] text-zinc-800">
                {String(request.args[0])}
              </dd>
              <dt className="text-zinc-500">Spender</dt>
              <dd className="break-all text-right font-mono text-[10px] text-zinc-800">
                {knownDestination(String(request.args[1]) as Address, prepared)}
              </dd>
              <dt className="text-zinc-500">Expires</dt>
              <dd className="text-right text-zinc-800">
                {new Date(Number(request.args[3]) * 1000).toLocaleString()}
              </dd>
            </>
          ) : null}
          {prepared.mode === "pay" && action.kind === "payment" ? (
            <>
              <dt className="text-zinc-500">Minimum received</dt>
              <dd className="text-right text-zinc-800">
                {formatPayAmount(prepared.minReturned, 18)} {projectTokenSymbol}
              </dd>
            </>
          ) : null}
          {beneficiary && prepared.mode === "pay" && action.kind === "payment" ? (
            <>
              <dt className="text-zinc-500">Beneficiary</dt>
              <dd className="break-all text-right font-mono text-[10px] text-zinc-800">
                {beneficiary}
              </dd>
            </>
          ) : null}
          {prepared.memo && action.kind === "payment" ? (
            <>
              <dt className="text-zinc-500">Note</dt>
              <dd className="text-right text-zinc-800">{prepared.memo}</dd>
            </>
          ) : null}
        </div>
      </dl>
      <details className="mt-3 border-t border-zinc-200 pt-2">
        <summary className="cursor-pointer select-none text-zinc-500">Show raw data</summary>
        <pre className="mt-2 max-h-52 overflow-auto whitespace-pre-wrap break-all rounded bg-zinc-900 p-3 font-mono text-[10px] leading-relaxed text-zinc-100">
          {preparedPaymentJson(prepared, action, chainLabel)}
        </pre>
      </details>
    </div>
  );
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

function activeWalletAction(prepared: PreparedV6Pay, phase: V6PayPhase): PreparedV6WalletAction {
  if ((phase === "ready" || phase === "approving-token") && prepared.tokenApproval) {
    return prepared.tokenApproval;
  }
  if (
    (phase === "ready" || phase === "approving-router") &&
    !prepared.tokenApproval &&
    prepared.routerApproval
  ) {
    return prepared.routerApproval;
  }
  if (phase === "approving-router" && prepared.routerApproval) return prepared.routerApproval;
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
  action: PreparedV6WalletAction,
  chainLabel: string,
): string {
  return JSON.stringify(
    {
      chain: chainLabel,
      chainId: prepared.chainId,
      contract: knownDestination(action.request.address, prepared).split(" · ")[0],
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
