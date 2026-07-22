"use client";

import { resumePendingRelayrBundles, waitForRelayrBundle } from "@/hooks/useReviewedRelayr";
import { resumeSafeProposalTracking } from "@/hooks/useReviewedWriteContract";
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
import { JB_CHAINS, jbContractAddress, type JBChainId } from "@bananapus/nana-sdk-core";
import { useCallback, useEffect, useRef, useState, type PropsWithChildren } from "react";
import { formatEther, toFunctionSelector, type AbiFunction, type Address } from "viem";
import { useAccount } from "wagmi";

type PendingReview = {
  id: number;
  request: TransactionReviewRequest;
  resolve: (approved: boolean) => void;
};

const TX_EXPLORER: Record<number, string> = {
  1: "https://etherscan.io",
  10: "https://optimistic.etherscan.io",
  8453: "https://basescan.org",
  42161: "https://arbiscan.io",
  11155111: "https://sepolia.etherscan.io",
  11155420: "https://sepolia-optimism.etherscan.io",
  84532: "https://sepolia.basescan.org",
  421614: "https://sepolia.arbiscan.io",
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

function knownContract(call: TransactionReviewCall): string | null {
  if (call.contractName) return call.contractName;
  const contracts = jbContractAddress["6"] as unknown as Record<
    string,
    Partial<Record<number, Address>>
  >;
  return (
    Object.entries(contracts).find(
      ([, addresses]) => addresses[call.chainId]?.toLowerCase() === call.to.toLowerCase(),
    )?.[0] ?? null
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
    <section className="border border-melon-300 bg-melon-25 p-4">
      <div className="flex flex-wrap justify-between gap-2 text-xs uppercase text-melon-700">
        <span>{total > 1 ? `Call ${index + 1} of ${total}` : "Exact call"}</span>
        <span>
          {chain?.name ?? `Chain ${call.chainId}`} · {call.chainId}
        </span>
      </div>
      {call.label ? (
        <h3 className="mt-3 text-base font-bold text-melon-950">{call.label}</h3>
      ) : null}
      <dl className="mt-3 space-y-3 text-xs">
        {call.from ? (
          <div>
            <dt className="text-melon-700">From</dt>
            <dd className="mt-1 break-all font-mono">{call.from}</dd>
          </div>
        ) : null}
        <div>
          <dt className="text-melon-700">Destination{contract ? ` · ${contract}` : ""}</dt>
          <dd className="mt-1 break-all font-mono">{call.to}</dd>
        </div>
        <div>
          <dt className="text-melon-700">Native value</dt>
          <dd className="mt-1 font-mono">
            {formatEther(call.value ?? 0n)} native · {(call.value ?? 0n).toString()} wei
          </dd>
        </div>
      </dl>
      {fn ? (
        <div className="mt-4 border-t border-melon-200 pt-3">
          <p className="text-xs text-melon-700">Contract function</p>
          <p className="mt-1 break-all font-mono text-sm font-bold">
            {fn.name}({fn.inputs.map((input) => input.type).join(", ")})
          </p>
          <div className="mt-3 space-y-2">
            {fn.inputs.map((input, argumentIndex) => (
              <div key={`${input.name}-${argumentIndex}`} className="bg-melon-50 p-3 text-xs">
                <p className="font-bold text-melon-800">
                  {input.name || `argument ${argumentIndex + 1}`}{" "}
                  <span className="font-normal">{input.type}</span>
                </p>
                <pre className="mt-1 overflow-auto whitespace-pre-wrap break-all font-mono">
                  {json(call.args?.[argumentIndex])}
                </pre>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="mt-4 border border-peel-200 bg-peel-25 p-3 text-xs text-peel-800">
          ABI unavailable in this flow. Verify selector {call.data.slice(0, 10)} and complete
          calldata in Raw.
        </div>
      )}
    </section>
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
  const ref = useRef<HTMLDivElement>(null);
  const authorization = pending.request.kind === "authorization";

  useEffect(() => {
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") finish(false);
    };
    document.addEventListener("keydown", keydown);
    return () => {
      document.removeEventListener("keydown", keydown);
      document.body.style.overflow = overflow;
    };
  }, [finish]);

  return (
    <div
      className="fixed inset-0 z-[1000] flex items-start justify-center overflow-y-auto bg-melon-950/60 p-3 sm:p-8"
      onMouseDown={(event) => event.target === event.currentTarget && finish(false)}
    >
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        className="flex max-h-[calc(100vh-1.5rem)] w-full max-w-3xl flex-col border border-melon-700 bg-melon-25 shadow-2xl sm:max-h-[calc(100vh-4rem)]"
      >
        <header className="flex items-start justify-between border-b border-melon-300 bg-melon-50 p-4 sm:p-6">
          <div>
            <p className="text-xs font-bold uppercase text-peel-600">Transaction safety check</p>
            <h2 className="mt-1 text-xl font-bold">
              {pending.request.title ??
                (authorization ? "Review authorization" : "Review transaction")}
            </h2>
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
          <p className="border border-peel-200 bg-peel-25 p-3 text-sm leading-relaxed text-peel-800">
            {pending.request.description ??
              (authorization
                ? "This signature authorizes the exact typed data and resulting calls below; it does not itself prove those calls have executed."
                : "These are the exact app-controlled fields your wallet will be asked to send. Wallet-selected nonce and network fees are not shown.")}
          </p>
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
          <details className="mt-4 border border-melon-300 bg-melon-50">
            <summary className="cursor-pointer px-4 py-3 text-sm font-bold">
              Raw transaction payload
            </summary>
            <pre className="max-h-96 overflow-auto border-t border-melon-300 bg-melon-950 p-4 text-[11px] leading-relaxed text-melon-25">
              {transactionReviewJson(pending.request)}
            </pre>
          </details>
          <button
            type="button"
            className="mt-4 border border-melon-600 bg-melon-100 px-4 py-2 text-xs font-bold hover:bg-melon-200"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(buildTransactionReviewPrompt(pending.request));
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
      </div>
    </div>
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
    <aside
      className="fixed bottom-3 right-3 z-[900] max-h-[70vh] w-[min(26rem,calc(100vw-1.5rem))] space-y-2 overflow-y-auto"
      aria-label="Transaction status"
    >
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
              Open pending Safe proposal · {activity.safeProposalHash ?? activity.hash}
            </a>
          ) : activity.kind !== "safe" &&
            activity.hash &&
            activity.chainId &&
            TX_EXPLORER[activity.chainId] ? (
            <a
              className="mt-2 block break-all font-mono text-[10px] underline"
              target="_blank"
              rel="noreferrer"
              href={`${TX_EXPLORER[activity.chainId]}/tx/${activity.hash}`}
            >
              View transaction · {activity.hash}
            </a>
          ) : activity.kind !== "safe" && activity.hash ? (
            <p className="mt-2 break-all font-mono text-[10px]">{activity.hash}</p>
          ) : null}
          {activity.executionHash && activity.chainId && TX_EXPLORER[activity.chainId] ? (
            <a
              className="mt-1 block break-all font-mono text-[10px] underline"
              target="_blank"
              rel="noreferrer"
              href={`${TX_EXPLORER[activity.chainId]}/tx/${activity.executionHash}`}
            >
              Safe execution · {activity.executionHash}
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
              Safe proposal · {activity.safeProposalHash}
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
                  {state.hash && TX_EXPLORER[state.chainId] ? (
                    <a
                      href={`${TX_EXPLORER[state.chainId]}/tx/${state.hash}`}
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
