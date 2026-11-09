import type { Hex } from "viem";
import type { PreparedV6Pay, V6PayPhase } from "./V6PayConfirmDialog";

/** How a failed payment is offered again: with a looser tolerance, or quoted afresh. */
type PayRecovery = { kind: "slippage"; bps: number } | { kind: "reverted" };

type Sending = "approving-token" | "simulating" | "signing";

/**
 * The pay card's confirm, one state at a time. `open` is the confirm dialog's; a Safe proposal
 * keeps being followed while it is closed.
 */
export type PayFlow = { open: boolean } & (
  | { phase: "preparing"; notice: string | null }
  | {
      phase: "ready";
      prepared: PreparedV6Pay | null;
      error: string | null;
      recovery: PayRecovery | null;
    }
  | { phase: Sending; prepared: PreparedV6Pay }
  | { phase: "pending"; prepared: PreparedV6Pay; hash: Hex }
  | { phase: "safe-proposed"; prepared: PreparedV6Pay; hash: Hex; approval: boolean }
  | { phase: "success"; prepared: PreparedV6Pay | null; hash: Hex | null }
);

export type PayFlowAction =
  /** Open the confirm on a fresh preparation. */
  | { type: "open" }
  /** Show or close the confirm; closing abandons a recovery. */
  | { type: "show"; open: boolean }
  /** Prepare again, saying why when the payer should know. */
  | { type: "prepare"; notice?: string }
  | { type: "prepared"; prepared: PreparedV6Pay }
  | { type: "prepare-failed"; error: string }
  | { type: "send"; phase: Sending }
  /** The approval's receipt succeeded: the payment step is next. */
  | { type: "approved" }
  | { type: "submitted"; hash: Hex }
  /** The review was closed without a send. */
  | { type: "closed" }
  | { type: "proposed"; hash: Hex; approval: boolean }
  | { type: "done" }
  | { type: "failed"; error: string | null; recovery?: PayRecovery | null }
  | { type: "slippage"; bps: number }
  | { type: "reset" };

export const PAY_FLOW_START: PayFlow = { open: false, phase: "preparing", notice: null };

const preparedOf = (flow: PayFlow) => ("prepared" in flow ? flow.prepared : null);
const hashOf = (flow: PayFlow) => ("hash" in flow ? flow.hash : null);

export function payFlow(flow: PayFlow, action: PayFlowAction): PayFlow {
  const { open } = flow;
  switch (action.type) {
    case "open":
      return { open: true, phase: "preparing", notice: null };
    case "show":
      if (action.open || flow.phase !== "ready") return { ...flow, open: action.open };
      return { ...flow, open: false, recovery: null };
    case "prepare":
      return { open, phase: "preparing", notice: action.notice ?? null };
    case "prepared":
      if (flow.phase !== "preparing") return flow;
      return {
        open,
        phase: "ready",
        prepared: action.prepared,
        error: flow.notice,
        recovery: null,
      };
    case "prepare-failed":
      return { open, phase: "ready", prepared: null, error: action.error, recovery: null };
    case "send": {
      const prepared = preparedOf(flow);
      return prepared ? { open, phase: action.phase, prepared } : flow;
    }
    case "approved": {
      const prepared = preparedOf(flow);
      return prepared
        ? ({ ...flow, prepared: { ...prepared, tokenApprovalComplete: true } } as PayFlow)
        : flow;
    }
    case "submitted": {
      const prepared = preparedOf(flow);
      return prepared ? { open, phase: "pending", prepared, hash: action.hash } : flow;
    }
    case "closed":
      return {
        open: false,
        phase: "ready",
        prepared: preparedOf(flow),
        error: null,
        recovery: null,
      };
    case "proposed": {
      const prepared = preparedOf(flow);
      return prepared
        ? { open, phase: "safe-proposed", prepared, hash: action.hash, approval: action.approval }
        : flow;
    }
    case "done":
      return { open, phase: "success", prepared: preparedOf(flow), hash: hashOf(flow) };
    case "failed":
      return {
        open,
        phase: "ready",
        prepared: preparedOf(flow),
        error: action.error,
        recovery: action.recovery ?? null,
      };
    case "slippage":
      return flow.phase === "ready" && flow.recovery?.kind === "slippage"
        ? { ...flow, recovery: { kind: "slippage", bps: action.bps } }
        : flow;
    case "reset":
      return PAY_FLOW_START;
  }
}

/** What the confirm dialog reads of the flow. */
export function payFlowView(flow: PayFlow) {
  return {
    phase: flow.phase as V6PayPhase,
    prepared: preparedOf(flow),
    error: flow.phase === "preparing" ? flow.notice : flow.phase === "ready" ? flow.error : null,
    retrySlippageBps:
      flow.phase === "ready" && flow.recovery?.kind === "slippage" ? flow.recovery.bps : null,
    revertedOnchain: flow.phase === "ready" && flow.recovery?.kind === "reverted",
    txHash: hashOf(flow) ?? undefined,
  };
}
