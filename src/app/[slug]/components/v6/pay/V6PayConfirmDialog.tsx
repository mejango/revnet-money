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

export type V6PayPhase =
  | "preparing"
  | "ready"
  | "approving"
  | "simulating"
  | "signing"
  | "pending"
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
  /** Fresh previewed token return (null for add-to-balance). */
  expectedTokens: bigint | null;
  reservedTokens: bigint | null;
  minReturned: bigint;
  needsApproval: boolean;
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

const PHASE_LABELS: Record<Exclude<V6PayPhase, "ready" | "success">, string> = {
  preparing: "Getting a fresh quote…",
  approving: "Approving the terminal to pull your tokens…",
  simulating: "Simulating the transaction…",
  signing: "Confirm in your wallet…",
  pending: "Transaction submitted, awaiting confirmation…",
};

/**
 * The confirm-before-send dialog: a human summary of exactly what will be
 * sent, plus a collapsible decode of the args and raw calldata.
 */
export function V6PayConfirmDialog({
  open,
  onOpenChange,
  prepared,
  phase,
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
  error: string | null;
  projectTokenSymbol: string;
  txHash: `0x${string}` | undefined;
  onConfirm: () => void;
  onDone: () => void;
}) {
  const busy =
    phase === "approving" || phase === "simulating" || phase === "signing" || phase === "pending";
  const chainMeta = prepared ? JB_CHAINS[prepared.chainId] : undefined;

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
              ? prepared?.mode === "pay"
                ? "Payment confirmed"
                : "Added to the balance"
              : prepared?.mode === "pay"
                ? "Confirm payment"
                : "Confirm add to balance"}
          </DialogTitle>
          <DialogDescription asChild>
            <div className="text-left">
              {phase === "preparing" ? (
                <div className="py-6 text-sm text-zinc-500">{PHASE_LABELS.preparing}</div>
              ) : phase === "success" ? (
                <div className="py-2">
                  <p className="text-sm text-zinc-700">
                    {prepared?.mode === "pay"
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
                    <Button className="bg-teal-500 hover:bg-teal-600" onClick={onDone}>
                      Done
                    </Button>
                  </div>
                </div>
              ) : prepared ? (
                <div className="flex flex-col gap-3 py-2">
                  <SummaryRow label="Send">
                    {formatPayAmount(prepared.amount, prepared.token.decimals)}{" "}
                    {prepared.token.symbol}
                  </SummaryRow>
                  <SummaryRow label="On">{chainMeta?.name ?? String(prepared.chainId)}</SummaryRow>
                  {prepared.mode === "pay" ? (
                    <SummaryRow label={prepared.viaRouterRoute ? "You get at least" : "You get"}>
                      {formatPayAmount(prepared.minReturned, 18)} {projectTokenSymbol}
                      {prepared.viaRouterRoute ? (
                        <span className="ml-2 text-xs text-zinc-500">via router</span>
                      ) : null}
                    </SummaryRow>
                  ) : (
                    <SummaryRow label="Effect">
                      Adds to the project balance — nothing else.
                    </SummaryRow>
                  )}
                  {prepared.reservedTokens != null && prepared.reservedTokens > 0n ? (
                    <SummaryRow label="Splits get">
                      {formatPayAmount(prepared.reservedTokens, 18)} {projectTokenSymbol}
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
                  {prepared.needsApproval ? (
                    <p className="text-xs text-zinc-500">
                      Two wallet steps: approve {prepared.token.symbol} for the terminal, then the{" "}
                      {prepared.mode === "pay" ? "payment" : "top-up"} itself.
                    </p>
                  ) : null}

                  <details className="mt-1 rounded border border-zinc-200 bg-zinc-50 p-2 text-xs">
                    <summary className="cursor-pointer select-none text-zinc-600">
                      Transaction details
                    </summary>
                    <div className="mt-2 space-y-1 font-mono text-[11px] text-zinc-600">
                      <div className="break-all">to: {prepared.request.address}</div>
                      <div>function: {prepared.request.functionName}</div>
                      {prepared.request.args.map((arg, i) => (
                        <div key={i} className="break-all">
                          arg[{i}]: {stringifyArg(arg)}
                        </div>
                      ))}
                      <div className="break-all">value: {prepared.request.value.toString()}</div>
                      <div className="break-all">calldata: {prepared.calldata}</div>
                    </div>
                  </details>

                  {busy ? (
                    <p className="text-sm text-zinc-500">
                      {PHASE_LABELS[phase as keyof typeof PHASE_LABELS]}
                    </p>
                  ) : null}
                  {error ? <p className="text-sm text-red-600">{error}</p> : null}

                  <div className="mt-1 flex justify-end">
                    <ButtonWithWallet
                      targetChainId={prepared.chainId}
                      loading={busy}
                      onClick={onConfirm}
                      className="bg-teal-500 hover:bg-teal-600"
                    >
                      {prepared.needsApproval
                        ? "Approve and send"
                        : prepared.mode === "pay"
                          ? "Pay"
                          : "Add to balance"}
                    </ButtonWithWallet>
                  </div>
                </div>
              ) : error ? (
                <p className="py-4 text-sm text-red-600">{error}</p>
              ) : null}
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

function stringifyArg(arg: unknown): string {
  if (typeof arg === "bigint") return arg.toString();
  if (typeof arg === "string") return arg === "" ? "\"\"" : arg;
  if (typeof arg === "boolean") return String(arg);
  try {
    return JSON.stringify(arg, (_, v) => (typeof v === "bigint" ? v.toString() : v));
  } catch {
    return String(arg);
  }
}
