"use client";

import { submittedViaSafe, type ProposeSafeBatch } from "@/hooks/useReviewedWriteContract";
import { erc20ApproveAbi } from "@/lib/erc20-approve";
import { waitForReceiptWithRetry } from "@/lib/waitForReceipt";
import { withWriteIntent } from "@/lib/write-hold";
import type { JBChainId } from "@bananapus/nana-sdk-core";
import { approvalIntent } from "@bananapus/nana-sdk-core/review";
import { erc20Abi, parseUnits, type Address, type Hex, type PublicClient } from "viem";
import {
  lpDeadline,
  PERMIT2_ABI,
  PERMIT2_ADDRESS,
  permit2AllowanceCovers,
  permit2ApprovalArgs,
  POSITION_MANAGER_ABI,
  POSITION_MANAGER_BY_CHAIN,
} from "./lib";

export { SummaryRow } from "@/components/ui/TxConfirmDialog";

/**
 * A wallet prompt a liquidity write will actually raise. Deciding the sequence
 * while reviewing — not while executing — is what lets the signer see the
 * whole queue before the first prompt, and keeps the list from naming
 * approvals it skips.
 */
export type LiquidityStep = {
  title: string;
  detail: string;
  approval?: { kind: "erc20" | "permit2"; currency: Address; max: bigint };
};

/**
 * The approvals a plan's ERC-20 sides still need: the token's allowance to
 * Permit2, then Permit2's capped, expiring allowance to the position manager.
 * Each is checked live so the list never names a step the wallet already
 * granted.
 */
export async function approvalStepsFor({
  publicClient,
  chainId,
  address,
  erc20Sides,
  symbolOf,
}: {
  publicClient: PublicClient;
  chainId: JBChainId;
  address: Address;
  erc20Sides: ReadonlyArray<{ currency: Address; max: bigint }>;
  symbolOf: (currency: Address) => string;
}): Promise<LiquidityStep[]> {
  const steps: LiquidityStep[] = [];
  for (const side of erc20Sides) {
    const symbol = symbolOf(side.currency);
    const allowance = await publicClient.readContract({
      address: side.currency,
      abi: erc20Abi,
      functionName: "allowance",
      args: [address, PERMIT2_ADDRESS],
    });
    if (allowance < side.max) {
      steps.push({
        title: `Approve ${symbol} access`,
        detail: `Permit2 is what moves your ${symbol} into the pool.`,
        approval: { kind: "erc20", currency: side.currency, max: side.max },
      });
    }
    if (!(await permit2AllowanceCovers(chainId, address, side.currency, side.max))) {
      steps.push({
        title: `Authorize the Uniswap position manager for ${symbol}`,
        detail: `A capped, expiring ${symbol} allowance — not an open-ended one.`,
        approval: { kind: "permit2", currency: side.currency, max: side.max },
      });
    }
  }
  return steps;
}

export type ApprovalContext = {
  chainId: JBChainId;
  address: Address;
  publicClient: PublicClient;
  ensureAllowance: (token: Address, spender: Address, amount: bigint) => Promise<unknown>;
  /** Send `Permit2.approve(args)` through the caller's reviewed write and return its hash. */
  approvePermit2: (args: ReturnType<typeof permit2ApprovalArgs>) => Promise<Hex>;
};

/**
 * Run one approval step. Permit2 allowances are re-checked rather than
 * trusted, since the review's reading can age out. A Safe connection turns
 * the Permit2 approval into a proposal that must execute before the flow can
 * continue, so that outcome is reported instead of waited on.
 */
export async function runApprovalStep(
  step: LiquidityStep,
  context: ApprovalContext,
): Promise<"done" | "safe-proposed"> {
  if (!step.approval) return "done";
  if (step.approval.kind === "erc20") {
    await context.ensureAllowance(step.approval.currency, PERMIT2_ADDRESS, step.approval.max);
    return "done";
  }
  const covered = await permit2AllowanceCovers(
    context.chainId,
    context.address,
    step.approval.currency,
    step.approval.max,
  );
  if (covered) return "done";
  const approvalHash = await context.approvePermit2(
    permit2ApprovalArgs(context.chainId, step.approval.currency, step.approval.max),
  );
  if (submittedViaSafe(approvalHash)) return "safe-proposed";
  const receipt = await waitForReceiptWithRetry(context.publicClient, approvalHash);
  if (receipt.status !== "success") {
    throw new Error(`Permit2 authorization ${approvalHash} reverted.`);
  }
  return "done";
}

export type LiquidityBatchCall = Parameters<ProposeSafeBatch>[3][number];

/**
 * The reviewed step list as ONE Safe batch: each approval becomes its call,
 * and the position-manager write comes last, marked as depending on them so
 * a standalone simulation never runs it before its allowances exist.
 */
export function liquidityBatchCalls({
  chainId,
  steps,
  unlockData,
  value,
}: {
  chainId: JBChainId;
  steps: readonly LiquidityStep[];
  unlockData: Hex;
  value: bigint;
}): LiquidityBatchCall[] {
  const positionManager = POSITION_MANAGER_BY_CHAIN[Number(chainId)];
  if (!positionManager) throw new Error("LP management is unavailable on this chain.");
  return steps.map((step) =>
    step.approval?.kind === "erc20"
      ? {
          address: step.approval.currency,
          abi: erc20ApproveAbi,
          functionName: "approve",
          args: [PERMIT2_ADDRESS, step.approval.max],
        }
      : step.approval
        ? {
            address: PERMIT2_ADDRESS,
            abi: PERMIT2_ABI,
            functionName: "approve",
            args: permit2ApprovalArgs(chainId, step.approval.currency, step.approval.max),
          }
        : {
            address: positionManager,
            abi: POSITION_MANAGER_ABI,
            functionName: "modifyLiquidities",
            args: [unlockData, lpDeadline(true)],
            value,
            dependsOnPrior: true,
          },
  );
}

/**
 * The approvals of one liquidity action, each held as a step of its intent (the SDK's
 * approvalIntent of `parent`): the ERC-20 allowance to Permit2, and Permit2's to the position
 * manager. Their amounts, the plan's calculated maxima, are not part of it.
 */
export function heldLiquidityApprovals(
  parent: string,
  {
    chainId,
    account,
    ensureAllowance,
    writeContractAsync,
  }: {
    chainId: number;
    account: Address;
    ensureAllowance: (
      token: Address,
      spender: Address,
      amount: bigint,
      namespace: string,
    ) => Promise<unknown>;
    writeContractAsync: (variables: never) => Promise<Hex>;
  },
): Pick<ApprovalContext, "ensureAllowance" | "approvePermit2"> {
  return {
    ensureAllowance: (token, spender, amount) =>
      ensureAllowance(
        token,
        spender,
        amount,
        approvalIntent(parent, { step: "erc20", token, spender }),
      ),
    approvePermit2: (args) =>
      withWriteIntent(
        writeContractAsync,
        approvalIntent(parent, { step: "permit2", token: args[0], spender: args[1] }),
      )({
        chainId,
        address: PERMIT2_ADDRESS,
        abi: PERMIT2_ABI,
        functionName: "approve",
        args,
        account,
      } as never),
  };
}

/** The confirm's intro line when the whole step list goes to a Safe at once. */
export function safeBatchIntro(steps: readonly unknown[]): string {
  return `Goes to your Safe as one batch of ${steps.length} calls: approved once, executed together.`;
}

/** A typed amount as raw units; "" is zero, anything unparsable names the side. */
export function parseAmountText(text: string, decimals: number, symbol: string): bigint {
  const trimmed = text.trim();
  if (trimmed === "") return 0n;
  try {
    const amount = parseUnits(trimmed, decimals);
    if (amount < 0n) throw new Error();
    return amount;
  } catch {
    throw new Error(`Enter a valid ${symbol} amount.`);
  }
}
