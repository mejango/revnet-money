import type { JBChainId } from "@bananapus/nana-sdk-core";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { AddLiquidityForm } from "@/app/[slug]/components/v6/owners/market/AmmCard";
import type { AmmChainState, PoolSnapshot } from "@/app/[slug]/components/v6/owners/market/lib";

// Render-level lock on the redesigned add-liquidity form: amounts-first by
// default (both fields typed, range solved and explained), with a range mode
// whose derived amount is visibly automatic.

vi.mock("wagmi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("wagmi")>()),
  useAccount: () => ({ address: "0x1111111111111111111111111111111111111111" }),
  useConfig: () => ({}),
  usePublicClient: () => undefined,
}));
vi.mock("@/hooks/useAllowance", () => ({
  useAllowance: () => ({ ensureAllowance: vi.fn(), isApproving: false }),
}));
vi.mock("@/hooks/useReviewedWriteContract", () => ({
  isSafeConnection: () => false,
  submittedViaSafe: () => false,
  useWaitForTransactionReceipt: () => ({}),
  useWriteContract: () => ({ writeContractAsync: vi.fn(), isPending: false }),
}));

const pool = {
  chainId: 8453 as JBChainId,
  price: 0.00001,
  poolId: "0xpool",
  pair: {
    addr: "0x0000000000000000000000000000000000000000",
    decimals: 18,
    symbol: "ETH",
    currency: 1n,
  },
} as unknown as PoolSnapshot;

const state: AmmChainState = {
  chainId: 8453 as JBChainId,
  hook: "0x0000000000000000000000000000000000000001",
  pool,
  composition: null,
  reference: { cashOut: 6.68961e-8, issuance: 0.0016 },
};

describe("AddLiquidityForm", () => {
  it("defaults to amounts mode and explains the solved range", () => {
    render(<AddLiquidityForm state={state} tokenSymbol="MARKEE" />);

    expect(screen.getByRole("button", { name: "By amounts" })).toBeInTheDocument();
    expect(screen.queryByText("Min price")).not.toBeInTheDocument();

    fireEvent.change(screen.getByRole("spinbutton", { name: /MARKEE/ }), {
      target: { value: "100000" },
    });
    fireEvent.change(screen.getByRole("spinbutton", { name: /^ETH/ }), {
      target: { value: "0.08" },
    });

    expect(screen.getByText(/Uses your 100000 MARKEE \+ 0\.08 ETH/)).toBeInTheDocument();
    expect(screen.getByText(/issuance price/)).toBeInTheDocument();
  });

  it("offers a v2-style full-range mode that derives the pool-ratio counterpart", () => {
    render(<AddLiquidityForm state={state} tokenSymbol="MARKEE" />);

    fireEvent.click(screen.getByRole("button", { name: "Full range" }));
    fireEvent.change(screen.getByRole("spinbutton", { name: /^ETH/ }), {
      target: { value: "0.08" },
    });

    // 0.08 ETH at spot 1e-5 pairs with ~8,000 MARKEE across the whole curve.
    const tokenInput = screen.getByRole("spinbutton", { name: /MARKEE/ }) as HTMLInputElement;
    expect(Number(tokenInput.value)).toBeCloseTo(8000, -1);
    expect(
      screen.getByText(/Spreads 8000 MARKEE \+ 0\.08 ETH across every price/),
    ).toBeInTheDocument();
    expect(screen.getByText(/like a classic v2 pool/)).toBeInTheDocument();
  });

  it("switches to range mode with the solved range carried over and a derived amount", () => {
    render(<AddLiquidityForm state={state} tokenSymbol="MARKEE" />);

    fireEvent.change(screen.getByRole("spinbutton", { name: /MARKEE/ }), {
      target: { value: "1000" },
    });
    fireEvent.change(screen.getByRole("spinbutton", { name: /^ETH/ }), {
      target: { value: "0.08" },
    });
    fireEvent.click(screen.getByRole("button", { name: "By price range" }));

    expect(screen.getByText("Min price")).toBeInTheDocument();
    expect(screen.getByText("Max price")).toBeInTheDocument();
    const minInput = screen.getByRole("spinbutton", { name: "Min price" }) as HTMLInputElement;
    expect(Number(minInput.value)).toBeCloseTo(6.68961e-8, 12);

    // Typing a token amount derives the pair side and marks it automatic.
    fireEvent.change(screen.getByRole("spinbutton", { name: /MARKEE/ }), {
      target: { value: "2000" },
    });
    expect(screen.getByText("≈ auto")).toBeInTheDocument();
    const pairInput = screen.getByRole("spinbutton", { name: /^ETH/ }) as HTMLInputElement;
    expect(Number(pairInput.value)).toBeGreaterThan(0);
  });
});
