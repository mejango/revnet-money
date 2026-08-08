"use client";

import { explorerBaseUrl } from "@/lib/utils";
import { encodeFunctionData, type Abi, type Address, type Hex } from "viem";

export type TransactionReviewCall = {
  chainId: number;
  to: Address;
  data: Hex;
  value?: bigint;
  from?: Address;
  abi?: Abi;
  functionName?: string;
  args?: readonly unknown[];
  label?: string;
  contractName?: string;
};

export type TransactionReviewRequest = {
  calls: readonly TransactionReviewCall[];
  title?: string;
  description?: string;
  confirmLabel?: string;
  kind?: "transaction" | "authorization";
  authorization?: unknown;
};

export type ContractTransactionReviewCall = {
  chainId: number;
  address: Address;
  abi: Abi;
  functionName: string;
  args?: readonly unknown[];
  value?: bigint;
  account?: Address;
};

export type TransactionReviewOptions = Omit<TransactionReviewRequest, "calls"> & {
  label?: string;
  contractName?: string;
};

type ReviewHandler = (request: TransactionReviewRequest) => Promise<boolean>;
const handlers: ReviewHandler[] = [];

export function registerTransactionReviewHandler(next: ReviewHandler): () => void {
  handlers.push(next);
  return () => {
    const index = handlers.lastIndexOf(next);
    if (index >= 0) handlers.splice(index, 1);
  };
}

async function requestTransactionReview(request: TransactionReviewRequest): Promise<boolean> {
  if (!request.calls.length && !request.authorization)
    throw new Error("There is no transaction to review.");
  const handler = handlers[handlers.length - 1];
  if (!handler) {
    throw new Error("Transaction review is unavailable. Reload the page before continuing.");
  }
  return handler(request);
}

function encodedCall(
  call: ContractTransactionReviewCall,
  options: Pick<TransactionReviewOptions, "label" | "contractName"> = {},
): TransactionReviewCall {
  return {
    chainId: call.chainId,
    to: call.address,
    from: call.account,
    value: call.value,
    data: encodeFunctionData({
      abi: call.abi,
      functionName: call.functionName,
      args: call.args,
    }),
    abi: call.abi,
    functionName: call.functionName,
    args: call.args,
    ...options,
  };
}

export async function requireTransactionReview(request: TransactionReviewRequest): Promise<void> {
  if (!(await requestTransactionReview(request))) {
    throw new Error("Review closed. Nothing was sent.");
  }
}

export async function requireContractTransactionReview(
  call: ContractTransactionReviewCall,
  options: TransactionReviewOptions = {},
): Promise<void> {
  const { label, contractName, ...request } = options;
  const before = encodedCall(call, { label, contractName });
  if (!(await requestTransactionReview({ ...request, calls: [before] }))) {
    throw new Error("Review closed. Nothing was sent.");
  }
  const after = encodedCall(call, { label, contractName });
  if (
    before.chainId !== after.chainId ||
    before.to.toLowerCase() !== after.to.toLowerCase() ||
    (before.value ?? 0n) !== (after.value ?? 0n) ||
    before.data !== after.data
  ) {
    throw new Error("Transaction data changed after review. Nothing was sent; review it again.");
  }
}

export function transactionReviewJson(request: TransactionReviewRequest): string {
  const transactions = request.calls.map((call) => ({
    chainId: call.chainId,
    from: call.from,
    to: call.to,
    value: `0x${(call.value ?? 0n).toString(16)}`,
    data: call.data,
  }));
  const resultingCall = transactions.length === 1 ? transactions[0] : { transactions };
  return JSON.stringify(
    request.authorization
      ? transactions.length > 0
        ? { authorization: request.authorization, resultingCall }
        : { authorization: request.authorization }
      : resultingCall,
    (_, value) => (typeof value === "bigint" ? value.toString() : value),
    2,
  );
}

export function buildTransactionReviewPrompt(request: TransactionReviewRequest): string {
  const lines = [
    "I am about to authorize a blockchain action in revnet.money using Juicebox V6 contracts. Act as a careful transaction security reviewer. Trust the exact payload and verified V6 source over the page, independently decode it, compare it with my intent, and give a go/no-go.",
    "",
    "Exact app-controlled payload:",
    "```json",
    transactionReviewJson(request),
    "```",
    "",
    "Verify against the Juicebox V6 repositories: https://github.com/Bananapus/version-6",
  ];
  if (typeof window !== "undefined")
    lines.push(`Audit the app page/build: ${window.location.href}`);
  request.calls.forEach((call, index) => {
    lines.push(
      explorerBaseUrl(call.chainId)
        ? `${request.calls.length > 1 ? `Target ${index + 1}` : "Target"}: ${explorerBaseUrl(call.chainId)}/address/${call.to}`
        : `Target ${index + 1}: chain ${call.chainId}, ${call.to}`,
    );
  });
  lines.push(
    "",
    "Check the chain, destination, native value, selector, every argument, recipients, beneficiaries, spenders, permissions, ownership changes, token movement, unlimited approvals, delegatecalls, upgrade paths, and every cross-chain call. For Relayr or Safe, distinguish the authorization/proposal from later onchain execution.",
    "",
    "Before a verdict, ask me 2–4 short questions about what I expect to change, who controls or receives what, how much moves, and on which chains. Wait for my answers and flag every mismatch.",
    "",
    "End with exactly one verdict: SAFE TO SIGN / DO NOT SIGN / NEEDS MORE INFO, followed by the key reasons. Explicitly warn if a target is not a verified Juicebox V6 deployment.",
  );
  return lines.join("\n");
}
