"use client";

import { CallRow, ExactCallCard } from "@/components/ExactCallCard";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { resumePendingRelayrBundles, waitForRelayrBundle } from "@/hooks/useReviewedRelayr";
import { resumeSafeProposalTracking } from "@/hooks/useReviewedWriteContract";
import { PERMIT2_ADDRESS, UNIVERSAL_ROUTER_BY_CHAIN } from "@/lib/directPaySwap";
import {
  dismissTransactionActivity,
  updateTransactionActivity,
  useTransactionActivities,
} from "@/lib/transaction-activity";
import {
  buildTransactionReviewPrompt,
  registerTransactionReviewHandler,
  transactionReviewJson,
  type TransactionReviewCall,
  type TransactionReviewRequest,
} from "@/lib/transaction-review";
import { explorerBaseUrl } from "@/lib/utils";
import {
  JB_CHAINS,
  jbContractAddress,
  USDC_ADDRESSES,
  type JBChainId,
} from "@bananapus/nana-sdk-core";
import { useCallback, useEffect, useRef, useState, type PropsWithChildren } from "react";
import {
  decodeAbiParameters,
  formatEther,
  toFunctionSelector,
  zeroAddress,
  type AbiFunction,
  type Address,
  type Hex,
} from "viem";
import { useAccount } from "wagmi";

type PendingReview = {
  id: number;
  request: TransactionReviewRequest;
  resolve: (approved: boolean) => void;
};

const SAFE_PREFIX: Partial<Record<number, string>> = {
  1: "eth",
  10: "oeth",
  8453: "base",
  42161: "arb1",
  11155111: "sep",
};
function json(value: unknown): string {
  return JSON.stringify(value, (_, item) => (typeof item === "bigint" ? item.toString() : item), 2);
}

function knownAddress(chainId: number, address: unknown): string | null {
  if (typeof address !== "string" || !/^0x[0-9a-f]{40}$/iu.test(address)) return null;
  if (address.toLowerCase() === PERMIT2_ADDRESS.toLowerCase()) return "Permit2";
  if (UNIVERSAL_ROUTER_BY_CHAIN[chainId as JBChainId]?.toLowerCase() === address.toLowerCase()) {
    return "Uniswap Universal Router";
  }
  if (USDC_ADDRESSES[chainId as JBChainId]?.toLowerCase() === address.toLowerCase()) return "USDC";
  const contracts = jbContractAddress["6"] as unknown as Record<
    string,
    Partial<Record<number, Address>>
  >;
  return (
    Object.entries(contracts).find(
      ([, addresses]) => addresses[chainId]?.toLowerCase() === address.toLowerCase(),
    )?.[0] ?? null
  );
}

function knownContract(call: TransactionReviewCall): string | null {
  return call.contractName || knownAddress(call.chainId, call.to);
}

function prettyArgument(call: TransactionReviewCall, argumentIndex: number) {
  const value = call.args?.[argumentIndex];
  const label = knownAddress(call.chainId, value);
  return label ? `${label} | ${String(value)}` : json(value);
}

export type V4PlanStep =
  | {
      action: "DECREASE_LIQUIDITY";
      position: string;
      liquidity: bigint;
      minimumOut: { currency0: bigint; currency1: bigint };
    }
  | {
      action: "MINT_POSITION";
      owner: string;
      pool: { currency0: string; currency1: string; fee: number; tickSpacing: number; hook: string };
      ticks: { lower: number; upper: number };
      liquidity: bigint;
      maximumIn: { currency0: bigint; currency1: bigint };
    }
  | {
      action: "BURN_POSITION";
      position: string;
      minimumOut: { currency0: bigint; currency1: bigint };
    }
  | { action: "TAKE_PAIR"; currency0: string; currency1: string; recipient: string }
  | { action: "CLOSE_CURRENCY"; currency: string }
  | { action: "SWEEP"; currency: string; recipient: string };

/**
 * Decode a Uniswap V4 PositionManager `unlockData` plan into typed steps.
 * Covers only the actions this app builds (mint/burn/decrease/take/close/
 * sweep); anything unrecognized falls back to the raw argument view — a
 * pretty rendering must never paper over bytes it can't fully account for.
 * Amounts stay in raw token units on purpose: this dialog shows the exact
 * payload. Addresses stay raw here; the renderer resolves known names.
 */
export function describeV4UnlockData(value: unknown): V4PlanStep[] | null {
  if (typeof value !== "string" || !value.startsWith("0x")) return null;
  try {
    const [actions, params] = decodeAbiParameters(
      [{ type: "bytes" }, { type: "bytes[]" }],
      value as Hex,
    );
    const codes = actions.slice(2).match(/.{2}/g) ?? [];
    if (!codes.length || codes.length !== params.length) return null;
    const steps: V4PlanStep[] = [];
    for (const [index, byte] of codes.entries()) {
      const data = params[index];
      switch (parseInt(byte, 16)) {
        case 0x01: {
          const [tokenId, liquidity, amount0Min, amount1Min] = decodeAbiParameters(
            [
              { type: "uint256" },
              { type: "uint128" },
              { type: "uint128" },
              { type: "uint128" },
              { type: "bytes" },
            ],
            data,
          );
          steps.push({
            action: "DECREASE_LIQUIDITY",
            position: `#${tokenId}`,
            liquidity,
            minimumOut: { currency0: amount0Min, currency1: amount1Min },
          });
          break;
        }
        case 0x02: {
          const [key, tickLower, tickUpper, liquidity, amount0Max, amount1Max, owner] =
            decodeAbiParameters(
              [
                {
                  type: "tuple",
                  components: [
                    { type: "address" },
                    { type: "address" },
                    { type: "uint24" },
                    { type: "int24" },
                    { type: "address" },
                  ],
                },
                { type: "int24" },
                { type: "int24" },
                { type: "uint256" },
                { type: "uint128" },
                { type: "uint128" },
                { type: "address" },
                { type: "bytes" },
              ],
              data,
            );
          steps.push({
            action: "MINT_POSITION",
            owner,
            pool: {
              currency0: key[0],
              currency1: key[1],
              fee: key[2],
              tickSpacing: key[3],
              hook: key[4],
            },
            ticks: { lower: tickLower, upper: tickUpper },
            liquidity,
            maximumIn: { currency0: amount0Max, currency1: amount1Max },
          });
          break;
        }
        case 0x03: {
          const [tokenId, amount0Min, amount1Min] = decodeAbiParameters(
            [{ type: "uint256" }, { type: "uint128" }, { type: "uint128" }, { type: "bytes" }],
            data,
          );
          steps.push({
            action: "BURN_POSITION",
            position: `#${tokenId}`,
            minimumOut: { currency0: amount0Min, currency1: amount1Min },
          });
          break;
        }
        case 0x11: {
          const [currency0, currency1, recipient] = decodeAbiParameters(
            [{ type: "address" }, { type: "address" }, { type: "address" }],
            data,
          );
          steps.push({ action: "TAKE_PAIR", currency0, currency1, recipient });
          break;
        }
        case 0x12: {
          const [currency] = decodeAbiParameters([{ type: "address" }], data);
          steps.push({ action: "CLOSE_CURRENCY", currency });
          break;
        }
        case 0x14: {
          const [currency, recipient] = decodeAbiParameters(
            [{ type: "address" }, { type: "address" }],
            data,
          );
          steps.push({ action: "SWEEP", currency, recipient });
          break;
        }
        default:
          return null;
      }
    }
    return steps;
  } catch {
    return null;
  }
}

/** The pay-confirm row grammar: `Label: value`, addresses resolved to known names. */
function V4PlanRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-1">
      <dt className="shrink-0 text-zinc-500">{label}:</dt>
      <dd className="min-w-0 break-all font-mono text-zinc-800">{children}</dd>
    </div>
  );
}

function v4AddressLabel(chainId: number, address: string): string {
  if (address.toLowerCase() === zeroAddress) return `native ETH | ${address}`;
  const label = knownAddress(chainId, address);
  return label ? `${label} | ${address}` : address;
}

function v4Amounts(pair: { currency0: bigint; currency1: bigint }): string {
  return `${pair.currency0} (currency0) + ${pair.currency1} (currency1)`;
}

/** A decoded unlockData plan in the same row grammar the pay confirm uses. */
function V4PlanView({ steps, chainId }: { steps: V4PlanStep[]; chainId: number }) {
  return (
    <div className="mt-1 space-y-3">
      {steps.map((step, index) => {
        const title = (text: string) => (
          <p className="font-bold text-zinc-800">
            {index + 1}. {text}
          </p>
        );
        switch (step.action) {
          case "BURN_POSITION":
            return (
              <dl key={index} className="space-y-0.5">
                {title(`Burn position ${step.position}`)}
                <V4PlanRow label="Minimum out">
                  {v4Amounts(step.minimumOut)} — reverts below this
                </V4PlanRow>
              </dl>
            );
          case "DECREASE_LIQUIDITY":
            return (
              <dl key={index} className="space-y-0.5">
                {title(
                  step.liquidity === 0n
                    ? `Collect fees on position ${step.position} (liquidity untouched)`
                    : `Decrease position ${step.position}`,
                )}
                {step.liquidity !== 0n ? (
                  <>
                    <V4PlanRow label="Liquidity">{String(step.liquidity)}</V4PlanRow>
                    <V4PlanRow label="Minimum out">
                      {v4Amounts(step.minimumOut)} — reverts below this
                    </V4PlanRow>
                  </>
                ) : null}
              </dl>
            );
          case "MINT_POSITION":
            return (
              <dl key={index} className="space-y-0.5">
                {title("Mint a new position")}
                <V4PlanRow label="Owner">{v4AddressLabel(chainId, step.owner)}</V4PlanRow>
                <V4PlanRow label="Currency0">
                  {v4AddressLabel(chainId, step.pool.currency0)}
                </V4PlanRow>
                <V4PlanRow label="Currency1">
                  {v4AddressLabel(chainId, step.pool.currency1)}
                </V4PlanRow>
                <V4PlanRow label="Fee">
                  {step.pool.fee} ({step.pool.fee / 10_000}%) | tick spacing {step.pool.tickSpacing}
                </V4PlanRow>
                <V4PlanRow label="Hook">{v4AddressLabel(chainId, step.pool.hook)}</V4PlanRow>
                <V4PlanRow label="Ticks">
                  {step.ticks.lower} → {step.ticks.upper}
                </V4PlanRow>
                <V4PlanRow label="Liquidity">{String(step.liquidity)}</V4PlanRow>
                <V4PlanRow label="Maximum in">{v4Amounts(step.maximumIn)}</V4PlanRow>
              </dl>
            );
          case "TAKE_PAIR":
            return (
              <dl key={index} className="space-y-0.5">
                {title("Take both currencies")}
                <V4PlanRow label="Currency0">
                  {v4AddressLabel(chainId, step.currency0)}
                </V4PlanRow>
                <V4PlanRow label="Currency1">
                  {v4AddressLabel(chainId, step.currency1)}
                </V4PlanRow>
                <V4PlanRow label="Recipient">{v4AddressLabel(chainId, step.recipient)}</V4PlanRow>
              </dl>
            );
          case "CLOSE_CURRENCY":
            return (
              <dl key={index} className="space-y-0.5">
                {title("Close currency — settle the net; leftovers return to the caller")}
                <V4PlanRow label="Currency">{v4AddressLabel(chainId, step.currency)}</V4PlanRow>
              </dl>
            );
          case "SWEEP":
            return (
              <dl key={index} className="space-y-0.5">
                {title("Sweep — refund unused balance")}
                <V4PlanRow label="Currency">{v4AddressLabel(chainId, step.currency)}</V4PlanRow>
                <V4PlanRow label="Recipient">{v4AddressLabel(chainId, step.recipient)}</V4PlanRow>
              </dl>
            );
        }
      })}
      <p className="text-zinc-500">The exact bytes are in the raw payload below.</p>
    </div>
  );
}

function functionOf(call: TransactionReviewCall): AbiFunction | null {
  if (!call.abi || !call.functionName) return null;
  const selector = call.data.slice(0, 10);
  return (
    (call.abi.find(
      (item) =>
        item.type === "function" &&
        item.name === call.functionName &&
        toFunctionSelector(item) === selector,
    ) as AbiFunction | undefined) ?? null
  );
}

function PrettyCall({
  call,
  index,
  total,
}: {
  call: TransactionReviewCall;
  index: number;
  total: number;
}) {
  const fn = functionOf(call);
  const contract = knownContract(call);
  const chain = JB_CHAINS[call.chainId as JBChainId];
  return (
    <ExactCallCard
      eyebrow={`${total > 1 ? `Call ${index + 1} of ${total}` : "Exact call"} | ${chain?.name ?? `Chain ${call.chainId}`} | ${call.chainId}`}
      destination={contract ? `${contract} | ${call.to}` : call.to}
      title={call.label ?? fn?.name ?? `Selector ${call.data.slice(0, 10)}`}
      raw={json({
        chainId: call.chainId,
        from: call.from,
        to: call.to,
        value: call.value ?? 0n,
        functionName: call.functionName,
        args: call.args,
        data: call.data,
      })}
      auditRequest={{ title: call.label ?? fn?.name, calls: [call] }}
    >
      <dl className="mt-2 space-y-1">
        {call.from ? <CallRow label="From">{call.from}</CallRow> : null}
        <CallRow label="Native value">
          {formatEther(call.value ?? 0n)} native | {(call.value ?? 0n).toString()} wei
        </CallRow>
        {call.safeTxGas !== undefined ? (
          <CallRow label="Safe transaction gas">
            {call.safeTxGas.toString()} (signed envelope)
          </CallRow>
        ) : null}
      </dl>
      {fn ? (
        <div className="mt-3 border-t border-melon-200 pt-2">
          <p className="text-zinc-500">Contract function</p>
          <p className="mt-1 break-all font-mono text-sm font-bold text-zinc-900">
            {fn.name}({fn.inputs.map((input) => input.type).join(", ")})
          </p>
          <div className="mt-3 space-y-2">
            {fn.inputs.map((input, argumentIndex) => (
              <div key={`${input.name}-${argumentIndex}`} className="bg-melon-25 p-3">
                <p className="font-bold text-melon-800">
                  {input.name || `argument ${argumentIndex + 1}`}{" "}
                  <span className="font-normal">{input.type}</span>
                </p>
                {(() => {
                  if (fn.name === "modifyLiquidities" && input.name === "unlockData") {
                    const steps = describeV4UnlockData(call.args?.[argumentIndex]);
                    if (steps) return <V4PlanView steps={steps} chainId={call.chainId} />;
                  }
                  return (
                    <pre className="mt-1 overflow-auto whitespace-pre-wrap break-all font-mono">
                      {prettyArgument(call, argumentIndex)}
                    </pre>
                  );
                })()}
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="mt-3 border border-peel-200 bg-peel-25 p-3 text-peel-800">
          ABI unavailable in this flow. Verify selector {call.data.slice(0, 10)} and complete
          calldata in Raw.
        </div>
      )}
    </ExactCallCard>
  );
}

function ReviewModal({
  pending,
  finish,
}: {
  pending: PendingReview;
  finish: (approved: boolean) => void;
}) {
  const [agreed, setAgreed] = useState(false);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  const authorization = pending.request.kind === "authorization";
  // Callers assemble the description from optional fragments, so a blank string
  // means "nothing extra to say" and must fall back to the standing guidance
  // rather than render an empty banner.
  const description =
    pending.request.description?.trim() ||
    (authorization
      ? "This signature authorizes the exact typed data and resulting calls below; it does not itself prove those calls have executed."
      : "These are the exact app-controlled fields your wallet will be asked to send. Wallet-selected nonce and network fees are not shown.");

  // The review is the last thing opened before a wallet prompt. Transaction
  // starters close any summary dialog first, leaving this as the only active
  // confirmation surface.
  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) finish(false);
      }}
    >
      <DialogContent
        showCloseButton={false}
        className="flex w-[calc(100%-1.5rem)] max-w-3xl flex-col gap-0 border-melon-700 bg-melon-25 p-0 shadow-2xl max-h-[calc(100vh-1.5rem)] sm:w-[calc(100%-4rem)] sm:max-h-[calc(100vh-4rem)]"
      >
        <header className="flex items-start justify-between border-b border-melon-300 bg-melon-50 p-4 sm:p-6">
          <div>
            <p className="text-xs font-bold uppercase text-amber-700">Transaction safety check</p>
            <DialogTitle className="mt-1 text-xl font-bold">
              {pending.request.title ??
                (authorization ? "Review authorization" : "Review transaction")}
            </DialogTitle>
          </div>
          <button
            type="button"
            className="border border-melon-500 px-3 py-1 text-sm"
            onClick={() => finish(false)}
            aria-label="Close review"
          >
            Close
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
          <p className="border border-amber-300 bg-amber-50 p-3 text-sm leading-relaxed text-amber-900">
            {description}
          </p>
          {/* Single-call requests carry the audit prompt and raw data on the
              card itself (the same chrome the pay flow uses); the request-wide
              versions only add value when there is more than one call. */}
          {pending.request.calls.length !== 1 ? (
            <button
              type="button"
              className="mt-4 border border-melon-600 bg-melon-100 px-4 py-2 text-xs font-bold hover:bg-melon-200"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(
                    buildTransactionReviewPrompt(pending.request),
                  );
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
          ) : null}
          <div className="mt-4 space-y-4">
            {pending.request.calls.map((call, index) => (
              <PrettyCall
                key={`${call.chainId}:${call.to}:${index}`}
                call={call}
                index={index}
                total={pending.request.calls.length}
              />
            ))}
          </div>
          {pending.request.calls.length !== 1 ? (
            <details className="mt-4 border border-melon-300 bg-melon-50">
              <summary className="cursor-pointer px-4 py-3 text-sm font-bold">
                Raw transaction payload
              </summary>
              <pre className="max-h-96 overflow-auto border-t border-melon-300 bg-melon-950 p-4 text-[11px] leading-relaxed text-melon-25">
                {transactionReviewJson(pending.request)}
              </pre>
            </details>
          ) : null}
        </div>
        <footer className="border-t border-melon-300 bg-melon-50 p-4 sm:p-6">
          <label className="flex items-start gap-3 border border-melon-300 bg-melon-25 p-3 text-sm">
            <input
              className="mt-1"
              type="checkbox"
              checked={agreed}
              onChange={(event) => setAgreed(event.target.checked)}
            />
            <span>
              I reviewed the chain, destination, native value, calldata
              {authorization ? ", and exact authorization" : ""}. I agree to this exact payload.
            </span>
          </label>
          <div className="mt-4 flex justify-end gap-2">
            <button
              type="button"
              className="border border-melon-600 px-5 py-2"
              onClick={() => finish(false)}
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={!agreed}
              className="border border-melon-700 bg-melon-500 px-5 py-2 font-bold disabled:cursor-not-allowed disabled:opacity-40"
              onClick={() => finish(true)}
            >
              {pending.request.confirmLabel ??
                (authorization ? "Agree & authorize" : "Agree & continue")}
            </button>
          </div>
        </footer>
      </DialogContent>
    </Dialog>
  );
}

function TransactionStatusCenter() {
  const activities = useTransactionActivities();
  useEffect(() => {
    activities
      .filter(
        (activity) =>
          activity.kind === "safe" && activity.status === "success" && !!activity.bundleUuid,
      )
      .forEach((activity) => {
        updateTransactionActivity(activity.id, {
          kind: "relayr-bundle",
          status: "pending",
          hash: activity.executionHash,
          safeProposalHash: activity.safeProposalHash ?? activity.hash,
          executionHash: undefined,
          message:
            "Safe executed the Relayr payment onchain. Destination transactions are now pending.",
        });
        void waitForRelayrBundle(activity.bundleUuid!).catch(() => undefined);
      });
  }, [activities]);
  if (!activities.length) return null;
  const active = activities.filter(
    (activity) =>
      activity.status === "submitted" ||
      activity.status === "pending" ||
      activity.status === "safe-proposed",
  );
  const terminal = activities.filter((activity) => !active.includes(activity));
  const visible = [...active, ...terminal.slice(0, 4)];
  return (
    <aside className="hidden" aria-label="Transaction status">
      {visible.map((activity) => (
        <div
          key={activity.id}
          className={`border bg-melon-25 p-3 shadow-lg ${activity.status === "failed" ? "border-peel-500" : activity.status === "success" ? "border-melon-500" : "border-melon-700"}`}
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs font-bold uppercase text-melon-700">
                {activity.status === "safe-proposed" ? "Safe proposal pending" : activity.status}
              </p>
              <p className="mt-1 text-sm font-bold">{activity.title}</p>
            </div>
            {activity.status === "success" || activity.status === "failed" ? (
              <button
                type="button"
                className="text-xs underline"
                onClick={() => dismissTransactionActivity(activity.id)}
              >
                Dismiss
              </button>
            ) : null}
          </div>
          <p className="mt-2 text-xs leading-relaxed text-melon-800">{activity.message}</p>
          {activity.status === "safe-proposed" &&
          activity.chainId &&
          activity.account &&
          SAFE_PREFIX[activity.chainId] ? (
            <a
              className="mt-2 block break-all font-mono text-[10px] underline"
              target="_blank"
              rel="noreferrer"
              href={`https://app.safe.global/transactions/queue?safe=${SAFE_PREFIX[activity.chainId]}:${activity.account}`}
            >
              Open pending Safe proposal | {activity.safeProposalHash ?? activity.hash}
            </a>
          ) : activity.kind !== "safe" &&
            activity.hash &&
            activity.chainId &&
            explorerBaseUrl(activity.chainId) ? (
            <a
              className="mt-2 block break-all font-mono text-[10px] underline"
              target="_blank"
              rel="noreferrer"
              href={`${explorerBaseUrl(activity.chainId)}/tx/${activity.hash}`}
            >
              View transaction | {activity.hash}
            </a>
          ) : activity.kind !== "safe" && activity.hash ? (
            <p className="mt-2 break-all font-mono text-[10px]">{activity.hash}</p>
          ) : null}
          {activity.executionHash && activity.chainId && explorerBaseUrl(activity.chainId) ? (
            <a
              className="mt-1 block break-all font-mono text-[10px] underline"
              target="_blank"
              rel="noreferrer"
              href={`${explorerBaseUrl(activity.chainId)}/tx/${activity.executionHash}`}
            >
              Safe execution | {activity.executionHash}
            </a>
          ) : null}
          {activity.safeProposalHash &&
          activity.status !== "safe-proposed" &&
          activity.account &&
          activity.chainId &&
          SAFE_PREFIX[activity.chainId] ? (
            <a
              className="mt-1 block break-all font-mono text-[10px] underline"
              target="_blank"
              rel="noreferrer"
              href={`https://app.safe.global/transactions/queue?safe=${SAFE_PREFIX[activity.chainId]}:${activity.account}`}
            >
              Safe proposal | {activity.safeProposalHash}
            </a>
          ) : null}
          {activity.bundleUuid ? (
            <p className="mt-1 break-all font-mono text-[10px]">Bundle {activity.bundleUuid}</p>
          ) : null}
          {activity.chainStates?.length ? (
            <div className="mt-2 space-y-1 border-t border-melon-200 pt-2 text-[10px]">
              {activity.chainStates.map((state, index) => (
                <div
                  key={`${state.chainId}:${index}`}
                  className="flex items-center justify-between gap-2"
                >
                  <span>
                    {JB_CHAINS[state.chainId as JBChainId]?.name ?? `Chain ${state.chainId}`}:{" "}
                    {state.status}
                  </span>
                  {state.hash && explorerBaseUrl(state.chainId) ? (
                    <a
                      href={`${explorerBaseUrl(state.chainId)}/tx/${state.hash}`}
                      target="_blank"
                      rel="noreferrer"
                      className="font-mono underline"
                    >
                      {state.hash.slice(0, 8)}…{state.hash.slice(-6)}
                    </a>
                  ) : null}
                </div>
              ))}
            </div>
          ) : null}
          {activity.kind === "relayr-bundle" &&
          activity.status === "pending" &&
          activity.bundleUuid ? (
            <button
              type="button"
              className="mt-2 text-xs font-bold underline"
              onClick={() => void waitForRelayrBundle(activity.bundleUuid!).catch(() => undefined)}
            >
              Check Relayr bundle now
            </button>
          ) : null}
        </div>
      ))}
    </aside>
  );
}

export function TransactionReviewProvider({ children }: PropsWithChildren) {
  const { address } = useAccount();
  const account = useRef(address);
  account.current = address;
  const activeRef = useRef<PendingReview | null>(null);
  const queued = useRef<PendingReview[]>([]);
  const nextId = useRef(1);
  const [active, setActive] = useState<PendingReview | null>(null);

  const enqueue = useCallback(
    (request: TransactionReviewRequest) =>
      new Promise<boolean>((resolve) => {
        const item: PendingReview = {
          id: nextId.current++,
          request: {
            ...request,
            calls: request.calls.map((call) => ({
              ...call,
              from: call.from ?? account.current,
              args: call.args ? [...call.args] : undefined,
            })),
          },
          resolve,
        };
        if (activeRef.current) queued.current.push(item);
        else {
          activeRef.current = item;
          setActive(item);
        }
      }),
    [],
  );

  useEffect(() => registerTransactionReviewHandler(enqueue), [enqueue]);
  useEffect(() => resumePendingRelayrBundles(), []);
  useEffect(() => resumeSafeProposalTracking(), []);
  useEffect(
    () => () => {
      activeRef.current?.resolve(false);
      queued.current.forEach((item) => item.resolve(false));
    },
    [],
  );

  const finish = useCallback((approved: boolean) => {
    const current = activeRef.current;
    if (!current) return;
    const next = queued.current.shift() ?? null;
    activeRef.current = next;
    setActive(next);
    current.resolve(approved);
  }, []);

  return (
    <>
      {children}
      <TransactionStatusCenter />
      {active ? <ReviewModal key={active.id} pending={active} finish={finish} /> : null}
    </>
  );
}
