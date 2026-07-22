"use client";

import { resumeSafeProposalTracking } from "@/hooks/useReviewedWriteContract";
import {
  recordTransactionActivity,
  transactionActivitySnapshot,
  updateTransactionActivity,
} from "@/lib/transaction-activity";
import { requireTransactionReview } from "@/lib/transaction-review";
import {
  erc2771ForwarderAbi,
  jbContractAddress,
  type JBChainId,
  type JBVersion,
} from "@bananapus/nana-sdk-core";
import type {
  ChainPayment,
  RelayrGetBundleResponse,
  RelayrPostBundleResponse,
} from "@bananapus/nana-sdk-react";
import { getAccount, getPublicClient, waitForTransactionReceipt } from "@wagmi/core";
import { useCallback, useEffect, useState } from "react";
import { encodeFunctionData, isAddress, type Abi, type Address, type Hex } from "viem";
import { useAccount, useConfig, useSendTransaction, useSignTypedData, useSwitchChain } from "wagmi";

const RELAYR_API = "https://api.relayr.ba5ed.com";
const FORWARD_REQUEST_TYPES = {
  ForwardRequest: [
    { name: "from", type: "address" },
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "gas", type: "uint256" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint48" },
    { name: "data", type: "bytes" },
  ],
} as const;

export type ReviewedRelayrRequest = {
  chainId: JBChainId;
  version?: JBVersion;
  data: {
    from: Address;
    to: Address;
    value: bigint;
    gas: bigint;
    data: Hex;
  };
  review?: {
    abi?: Abi;
    functionName?: string;
    args?: readonly unknown[];
    label?: string;
    contractName?: string;
  };
};

type RememberedQuote = {
  bundleUuid: string;
  chainIds: number[];
  payments: ChainPayment[];
};

const quotes = new Map<string, RememberedQuote>();
const bundleInflight = new Map<string, Promise<RelayrGetBundleResponse>>();

function paymentKey(payment: ChainPayment): string {
  return `${payment.chain}:${payment.target.toLowerCase()}:${payment.amount}:${payment.calldata}`;
}

function rememberQuote(quote: RelayrPostBundleResponse, requests: ReviewedRelayrRequest[]): void {
  const remembered = {
    bundleUuid: quote.bundle_uuid,
    chainIds: requests.map((request) => request.chainId),
    payments: quote.payment_info,
  };
  quote.payment_info.forEach((payment) => quotes.set(paymentKey(payment), remembered));
}

function stateIsSuccess(state?: string): boolean {
  return state === "Success" || state === "Completed";
}

function stateIsFailed(state?: string): boolean {
  return state === "Failed" || state === "Reverted" || state === "Dropped";
}

function safeConnection(config: ReturnType<typeof useConfig>): boolean {
  const connector = getAccount(config).connector;
  return `${connector?.id ?? ""} ${connector?.name ?? ""}`.toLowerCase().includes("safe");
}

async function fetchBundle(bundleUuid: string): Promise<RelayrGetBundleResponse> {
  const response = await fetch(`${RELAYR_API}/v1/bundle/${bundleUuid}`);
  if (!response.ok) throw new Error(`Relayr bundle check failed (${response.status}).`);
  return response.json();
}

function bundleSummary(bundle: RelayrGetBundleResponse): string {
  return bundle.transactions
    .map((transaction) => {
      const data = transaction.status?.data as
        | { hash?: Hex; transaction?: { hash?: Hex } }
        | undefined;
      const hash = data?.hash ?? data?.transaction?.hash;
      return `Chain ${transaction.request.chain}: ${transaction.status?.state ?? "Pending"}${hash ? ` (${hash})` : ""}`;
    })
    .join(" · ");
}

function bundleChainStates(bundle: RelayrGetBundleResponse) {
  return bundle.transactions.map((transaction) => {
    const data = transaction.status?.data as
      | { hash?: Hex; transaction?: { hash?: Hex } }
      | undefined;
    return {
      chainId: Number(transaction.request.chain),
      status: transaction.status?.state ?? "Pending",
      hash: data?.hash ?? data?.transaction?.hash,
    };
  });
}

export async function waitForRelayrBundle(
  bundleUuid: string,
  onUpdate?: (bundle: RelayrGetBundleResponse) => void,
): Promise<RelayrGetBundleResponse> {
  const existing = bundleInflight.get(bundleUuid);
  if (existing) return existing;
  const activityId = `relayr:${bundleUuid}`;
  const request = (async () => {
    let last: RelayrGetBundleResponse | null = null;
    for (let attempt = 0; attempt < 180; attempt += 1) {
      try {
        last = await fetchBundle(bundleUuid);
        onUpdate?.(last);
        const states = last.transactions.map((transaction) => transaction.status?.state);
        const summary = bundleSummary(last);
        if (states.some(stateIsFailed)) {
          updateTransactionActivity(activityId, {
            status: "failed",
            message: `Relayr reported a failed destination transaction. ${summary}`,
            chainStates: bundleChainStates(last),
          });
          throw new Error(`Relayr bundle ${bundleUuid} failed. ${summary}`);
        }
        if (states.length > 0 && states.every(stateIsSuccess)) {
          updateTransactionActivity(activityId, {
            status: "success",
            message: `All ${states.length} destination transactions confirmed. ${summary}`,
            chainStates: bundleChainStates(last),
          });
          return last;
        }
        updateTransactionActivity(activityId, {
          status: "pending",
          message: `Relayr payment confirmed; destination transactions are still executing. ${summary}`,
          chainStates: bundleChainStates(last),
        });
      } catch (error) {
        if (error instanceof Error && /bundle .* failed/.test(error.message)) throw error;
        updateTransactionActivity(activityId, {
          status: "pending",
          message:
            "Relayr was paid, but its status endpoint is temporarily unavailable. Do not pay again; check this bundle again.",
        });
      }
      await new Promise((resolve) => window.setTimeout(resolve, 2_000));
    }
    throw new Error(
      `Relayr bundle ${bundleUuid} is still pending after the status timeout. Do not pay again; resume checking this bundle.`,
    );
  })();
  bundleInflight.set(bundleUuid, request);
  void request.finally(() => bundleInflight.delete(bundleUuid)).catch(() => undefined);
  return request;
}

export function resumePendingRelayrBundles(): void {
  transactionActivitySnapshot()
    .filter(
      (activity) =>
        activity.kind === "relayr-bundle" &&
        activity.bundleUuid &&
        (activity.status === "submitted" || activity.status === "pending"),
    )
    .forEach((activity) => void waitForRelayrBundle(activity.bundleUuid!).catch(() => undefined));
}

export function useGetRelayrTxQuote() {
  const config = useConfig();
  const { address } = useAccount();
  const { switchChainAsync } = useSwitchChain();
  const { signTypedDataAsync } = useSignTypedData();
  const [data, setData] = useState<RelayrPostBundleResponse>();
  const [error, setError] = useState<Error | null>(null);
  const [isPending, setIsPending] = useState(false);

  const reset = useCallback(() => {
    setData(undefined);
    setError(null);
    setIsPending(false);
  }, []);

  const getRelayrTxQuote = useCallback(
    async (requests: ReviewedRelayrRequest[]) => {
      if (!address) throw new Error("Connect a wallet first.");
      if (!requests.length) throw new Error("There are no Relayr calls to quote.");
      if (safeConnection(config)) {
        throw new Error(
          "A Safe cannot authorize these ERC-2771 requests as an EOA. Submit each action through the Safe proposal flow instead.",
        );
      }
      setIsPending(true);
      setError(null);
      try {
        const transactions: Array<{
          chain: JBChainId;
          data: Hex;
          target: Address;
          value: string;
          version?: JBVersion;
        }> = [];
        for (const request of requests) {
          await switchChainAsync({ chainId: request.chainId });
          const current = getAccount(config).address;
          if (!current || current.toLowerCase() !== address.toLowerCase()) {
            throw new Error("Connected account changed. Review the Relayr authorization again.");
          }
          const version = request.version ?? 6;
          const forwarder = jbContractAddress[version].ERC2771Forwarder[request.chainId];
          const client = getPublicClient(config, { chainId: request.chainId });
          if (!client || !forwarder)
            throw new Error(`Relayr is unavailable on chain ${request.chainId}.`);
          await client.call({
            account: address,
            to: request.data.to,
            value: request.data.value,
            data: request.data.data,
          });
          const nonce = await client.readContract({
            address: forwarder,
            abi: erc2771ForwarderAbi,
            functionName: "nonces",
            args: [address],
          });
          const deadline = Math.floor(Date.now() / 1_000) + 48 * 60 * 60;
          const domain = {
            name: "Juicebox",
            version: "1",
            chainId: request.chainId,
            verifyingContract: forwarder,
          } as const;
          const message = { ...request.data, nonce, deadline };
          await requireTransactionReview({
            kind: "authorization",
            title: `Review Relayr authorization on chain ${request.chainId}`,
            description:
              "This EIP-712 signature authorizes Relayr's forwarder to submit the exact destination call below. The separate Relayr payment will be reviewed later.",
            confirmLabel: "Agree & sign Relayr request",
            authorization: {
              type: "EIP-712 ForwardRequest",
              domain,
              primaryType: "ForwardRequest",
              types: FORWARD_REQUEST_TYPES,
              message,
            },
            calls: [
              {
                chainId: request.chainId,
                from: address,
                to: request.data.to,
                value: request.data.value,
                data: request.data.data,
                abi: request.review?.abi,
                functionName: request.review?.functionName,
                args: request.review?.args,
                label: request.review?.label,
                contractName: request.review?.contractName,
              },
            ],
          });
          const live = getAccount(config).address;
          if (!live || live.toLowerCase() !== address.toLowerCase()) {
            throw new Error("Connected account changed. Review the Relayr authorization again.");
          }
          const signature = await signTypedDataAsync({
            domain,
            types: FORWARD_REQUEST_TYPES,
            primaryType: "ForwardRequest",
            message,
          });
          const afterSignature = getAccount(config).address;
          if (!afterSignature || afterSignature.toLowerCase() !== address.toLowerCase()) {
            throw new Error(
              "Connected account changed while signing. Review the Relayr authorization again.",
            );
          }
          const signedData = encodeFunctionData({
            abi: erc2771ForwarderAbi,
            functionName: "execute",
            args: [{ ...message, signature }],
          });
          transactions.push({
            chain: request.chainId,
            target: forwarder,
            data: signedData,
            value: request.data.value.toString(),
            version: request.version,
          });
        }
        const response = await fetch(`${RELAYR_API}/v1/bundle/prepaid`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ transactions, virtual_nonce_mode: "Disabled" }),
        });
        if (!response.ok) throw new Error(await response.text());
        const quote = (await response.json()) as RelayrPostBundleResponse;
        rememberQuote(quote, requests);
        setData(quote);
        return quote;
      } catch (cause) {
        const next =
          cause instanceof Error ? cause : new Error("Could not request a Relayr quote.");
        setError(next);
        throw next;
      } finally {
        setIsPending(false);
      }
    },
    [address, config, signTypedDataAsync, switchChainAsync],
  );

  return { getRelayrTxQuote, data, reset, error, isPending, isSuccess: !!data };
}

export function useSendRelayrTx() {
  const config = useConfig();
  const { address } = useAccount();
  const { switchChainAsync } = useSwitchChain();
  const transaction = useSendTransaction();

  const sendRelayrTx = useCallback(
    async (payment: ChainPayment): Promise<Hex> => {
      if (!address) throw new Error("Connect a wallet first.");
      if (!Number.isSafeInteger(payment.chain) || payment.chain <= 0) {
        throw new Error("Relayr returned an invalid payment chain.");
      }
      if (!isAddress(payment.target)) {
        throw new Error("Relayr returned an invalid payment destination.");
      }
      if (!/^0x(?:[0-9a-fA-F]{2})*$/.test(payment.calldata)) {
        throw new Error("Relayr returned invalid payment calldata.");
      }
      const value = BigInt(payment.amount);
      if (value < 0n) throw new Error("Relayr returned an invalid payment amount.");
      const deadline = (payment as ChainPayment & { payment_deadline?: number }).payment_deadline;
      if (deadline && deadline <= Math.floor(Date.now() / 1_000) + 15) {
        throw new Error("This Relayr quote expired. Review the action again for a new quote.");
      }
      await switchChainAsync({ chainId: payment.chain });
      const current = getAccount(config).address;
      if (!current || current.toLowerCase() !== address.toLowerCase()) {
        throw new Error("Connected account changed. Review the Relayr payment again.");
      }
      await requireTransactionReview({
        kind: "transaction",
        title: "Review Relayr payment",
        description:
          "This payment funds the already-reviewed Relayr bundle. Submitting it does not mean the destination transactions have confirmed.",
        confirmLabel: safeConnection(config)
          ? "Agree & propose payment to Safe"
          : "Agree & pay Relayr",
        calls: [
          {
            chainId: payment.chain,
            from: address,
            to: payment.target,
            value,
            data: payment.calldata,
            label: "Pay Relayr bundle fee",
          },
        ],
      });
      const live = getAccount(config).address;
      if (!live || live.toLowerCase() !== address.toLowerCase()) {
        throw new Error("Connected account changed. Review the Relayr payment again.");
      }
      const publicClient = getPublicClient(config, { chainId: payment.chain });
      if (!publicClient) throw new Error("Relayr payment network is unavailable.");
      await publicClient.estimateGas({
        account: address,
        to: payment.target,
        value,
        data: payment.calldata,
      });
      const accountBeforeSend = getAccount(config).address;
      if (!accountBeforeSend || accountBeforeSend.toLowerCase() !== address.toLowerCase()) {
        throw new Error("Connected account changed. Review the Relayr payment again.");
      }
      const remembered = quotes.get(paymentKey(payment));
      const callKey = `${address.toLowerCase()}:relayr-payment:${paymentKey(payment)}`;
      const duplicate = transactionActivitySnapshot().find(
        (activity) =>
          activity.callKey === callKey &&
          (activity.status === "submitted" ||
            activity.status === "pending" ||
            activity.status === "safe-proposed"),
      );
      if (duplicate?.hash) {
        throw new Error(
          `This Relayr payment is already pending as ${duplicate.hash}. Do not pay again; check the existing hash and bundle.`,
        );
      }
      const hash = await transaction.sendTransactionAsync({
        chainId: payment.chain,
        to: payment.target,
        value,
        data: payment.calldata,
      });
      const safe = safeConnection(config);
      const activityId = remembered
        ? `relayr:${remembered.bundleUuid}`
        : `relayr-payment:${payment.chain}:${hash}`;
      recordTransactionActivity({
        id: activityId,
        kind: safe ? "safe" : remembered ? "relayr-bundle" : "relayr-payment",
        title: remembered ? "Relayr multi-chain bundle" : "Relayr payment",
        status: safe ? "safe-proposed" : "submitted",
        message: safe
          ? "Relayr payment proposed to Safe. The bundle is not paid or executing until the Safe approves and executes this proposal."
          : "Relayr payment submitted. Do not pay again while its receipt is pending.",
        chainId: payment.chain,
        account: address,
        hash,
        safeProposalHash: safe ? hash : undefined,
        bundleUuid: remembered?.bundleUuid,
        chainStates: remembered?.chainIds.map((chainId) => ({
          chainId,
          status: "Pending",
        })),
        callKey,
      });
      if (safe) {
        resumeSafeProposalTracking();
        return hash;
      }
      let receipt;
      try {
        receipt = await waitForTransactionReceipt(config, { chainId: payment.chain, hash });
      } catch {
        updateTransactionActivity(activityId, {
          status: "pending",
          message:
            "Relayr payment was submitted, but its receipt is uncertain. Do not pay again; check this hash and bundle.",
        });
        throw new Error(
          `Relayr payment ${hash} was submitted, but confirmation is uncertain. Do not pay again.`,
        );
      }
      if (receipt.status !== "success") {
        updateTransactionActivity(activityId, {
          status: "failed",
          message: "The Relayr payment was mined but reverted. The bundle was not funded.",
        });
        throw new Error(`Relayr payment ${hash} reverted onchain.`);
      }
      updateTransactionActivity(activityId, {
        status: remembered ? "pending" : "success",
        message: remembered
          ? "Relayr payment confirmed. Destination transactions are now pending."
          : "Relayr payment confirmed.",
      });
      if (remembered) void waitForRelayrBundle(remembered.bundleUuid).catch(() => undefined);
      return hash;
    },
    [address, config, switchChainAsync, transaction],
  );

  return {
    sendRelayrTx,
    isPending: transaction.isPending,
    error: transaction.error,
    isSuccess: transaction.isSuccess,
    data: transaction.data,
  };
}

export function useGetRelayrTxBundle() {
  const [uuid, setUuid] = useState<string>();
  const [response, setResponse] = useState<RelayrGetBundleResponse>();
  const [error, setError] = useState<unknown>();
  const [isPolling, setIsPolling] = useState(false);
  const startPolling = useCallback((bundleUuid: string) => setUuid(bundleUuid), []);

  useEffect(() => {
    if (!uuid) return;
    let active = true;
    setIsPolling(true);
    void waitForRelayrBundle(uuid, (next) => active && setResponse(next))
      .then((next) => active && setResponse(next))
      .catch((cause) => active && setError(cause))
      .finally(() => active && setIsPolling(false));
    return () => {
      active = false;
    };
  }, [uuid]);

  const states = response?.transactions.map((item) => item.status?.state) ?? [];
  const isComplete = states.length > 0 && states.every(stateIsSuccess);
  const hasFailed = states.some(stateIsFailed);
  return { startPolling, isComplete, hasFailed, uuid, response, isPolling, error };
}
