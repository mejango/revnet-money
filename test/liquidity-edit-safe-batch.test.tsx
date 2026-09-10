import { EditPositionPanel } from "@/app/[slug]/components/v6/owners/market/EditPositionPanel";
import type {
  AmmChainState,
  EditLiquidityPlan,
  MarketEditPlan,
  PoolSnapshot,
  UserLpPosition,
} from "@/app/[slug]/components/v6/owners/market/lib";
import {
  PERMIT2_ADDRESS,
  POSITION_MANAGER_BY_CHAIN,
} from "@/app/[slug]/components/v6/owners/market/lib";
import { liquidityBatchCalls } from "@/app/[slug]/components/v6/owners/market/liquidityWrite";
import { MarketEditPanel } from "@/app/[slug]/components/v6/owners/market/MarketEditPanel";
import type { JBChainId } from "@bananapus/nana-sdk-core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render as rtlRender, screen, waitFor } from "@testing-library/react";
import { erc20Abi, type Address, type Hex } from "viem";
import { beforeEach, describe, expect, it, vi } from "vitest";

// wallet-action:liquidity-management
//
// Under a Safe app, an LP edit with pending approvals goes out as ONE batch
// (approve → Permit2 → modifyLiquidities), in that order, through the reviewed
// proposeSafeBatch boundary — never as separate proposals.

const ACCOUNT = "0x1111111111111111111111111111111111111111" as Address;
const PROJECT_TOKEN = "0x2222222222222222222222222222222222222222" as Address;
const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as Address;
const UNLOCK = `0x${"ab".repeat(40)}` as Hex;

const mocks = vi.hoisted(() => ({
  proposeSafeBatch: vi.fn(),
  writeContractAsync: vi.fn(),
  reverifyEditLiquidity: vi.fn(),
  reverifyMarketEdit: vi.fn(),
}));

vi.mock("wagmi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("wagmi")>()),
  useAccount: () => ({ address: ACCOUNT }),
  useConfig: () => ({ id: "config" }),
  usePublicClient: () => ({
    readContract: async () => 10n ** 30n,
    getBalance: async () => 10n ** 30n,
  }),
}));
vi.mock("@/components/ButtonWithWallet", () => ({
  ButtonWithWallet: ({
    children,
    loading: _loading,
    targetChainId: _chain,
    connectWalletText: _connect,
    ...props
  }: {
    children: React.ReactNode;
    loading?: boolean;
    targetChainId?: unknown;
    connectWalletText?: string;
  }) => <button {...props}>{children}</button>,
}));
vi.mock("@/hooks/useAllowance", () => ({
  useAllowance: () => ({ ensureAllowance: vi.fn(), isApproving: false }),
}));
vi.mock("@/hooks/useReviewedWriteContract", () => ({
  isSafeConnection: () => true,
  submittedViaSafe: () => false,
  proposeSafeBatch: mocks.proposeSafeBatch,
  useWriteContract: () => ({ writeContractAsync: mocks.writeContractAsync, isPending: false }),
}));
vi.mock("@/app/[slug]/components/v6/owners/market/lib", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/app/[slug]/components/v6/owners/market/lib")>();
  return {
    ...actual,
    refreshPoolAndPosition: async (pool: PoolSnapshot, tokenId: bigint) => ({
      pool,
      position: { ...position, tokenId },
    }),
    prepareEditLiquidity: () => editPlan,
    prepareMarketEdit: () => marketPlan,
    reverifyEditLiquidity: mocks.reverifyEditLiquidity,
    reverifyMarketEdit: mocks.reverifyMarketEdit,
  };
});
// Two live approvals still owed, so the reviewed list is approve → Permit2 → edit.
vi.mock("@/app/[slug]/components/v6/owners/market/liquidityWrite", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("@/app/[slug]/components/v6/owners/market/liquidityWrite")
    >();
  return {
    ...actual,
    approvalStepsFor: async () => [
      {
        title: "Approve USDC access",
        detail: "Permit2 is what moves your USDC into the pool.",
        approval: { kind: "erc20", currency: USDC, max: 5_000n },
      },
      {
        title: "Authorize the Uniswap position manager for USDC",
        detail: "A capped, expiring USDC allowance.",
        approval: { kind: "permit2", currency: USDC, max: 5_000n },
      },
    ],
  };
});

const pool = {
  chainId: 8453 as JBChainId,
  projectId: 6,
  price: 0.5,
  poolId: "0xpool",
  pair: { addr: USDC, decimals: 6, symbol: "USDC", currency: 1n },
  pairIsC0: false,
  projectToken: PROJECT_TOKEN,
} as unknown as PoolSnapshot;

const position = {
  tokenId: 42n,
  owner: ACCOUNT,
  info: 1n,
  liquidity: 100n,
  tickLower: -600,
  tickUpper: 600,
  pairAmount: 1_000n,
  tokenAmount: 2_000n,
} as UserLpPosition;

const state: AmmChainState = {
  chainId: 8453 as JBChainId,
  hook: "0x0000000000000000000000000000000000000001",
  pool,
  composition: null,
  reference: { cashOut: 0.1, issuance: 1 },
};

const editPlan = {
  kind: "increase",
  tokenId: 42n,
  unlockData: UNLOCK,
  value: 0n,
  erc20Sides: [{ currency: USDC, max: 5_000n }],
  tickLower: -600,
  tickUpper: 600,
  tokenHolding: 3_000n,
  pairHolding: 1_500n,
  tokenFlow: 1_000n,
  pairFlow: 500n,
  tokenFunding: 1_010n,
  pairFunding: 505n,
  tokenMinimum: 0n,
  pairMinimum: 0n,
} as unknown as EditLiquidityPlan;

const marketPlan = {
  unlockData: UNLOCK,
  token: {
    kind: "increase",
    tokenId: 42n,
    liquidityBefore: 100n,
    holding: 3_000n,
    flow: 1_000n,
    funding: 1_010n,
    minimum: 0n,
    tickLower: -600,
    tickUpper: 600,
    liquidity: 150n,
    liquidityDelta: 50n,
    amount0Max: 0n,
    amount1Max: 0n,
  },
  pair: null,
  value: 0n,
  erc20Sides: [{ currency: USDC, max: 5_000n }],
  tokenFlow: 1_000n,
  pairFlow: 0n,
  tokenFunding: 1_010n,
  pairFunding: 0n,
  tokenMinimum: 0n,
  pairMinimum: 0n,
  tokenHolding: 3_000n,
  pairHolding: 0n,
  refit: false,
} as unknown as MarketEditPlan;

const render = (ui: React.ReactElement) =>
  rtlRender(<QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider>);

/** The batch every converted flow must hand to proposeSafeBatch, in this order. */
function expectOneOrderedBatch(title: string) {
  expect(mocks.proposeSafeBatch).toHaveBeenCalledTimes(1);
  const [config, chainId, seenTitle, calls] = mocks.proposeSafeBatch.mock.calls[0]!;
  expect(config).toEqual({ id: "config" });
  expect(chainId).toBe(8453);
  expect(seenTitle).toBe(title);
  expect(
    calls.map((call: { functionName: string; address: Address }) => call.functionName),
  ).toEqual(["approve", "approve", "modifyLiquidities"]);
  expect(calls[0]).toMatchObject({ address: USDC, abi: erc20Abi, args: [PERMIT2_ADDRESS, 5_000n] });
  expect(calls[1]).toMatchObject({ address: PERMIT2_ADDRESS, functionName: "approve" });
  expect(calls[1].args.slice(0, 3)).toEqual([USDC, POSITION_MANAGER_BY_CHAIN[8453], 5_000n]);
  expect(calls[2]).toMatchObject({
    address: POSITION_MANAGER_BY_CHAIN[8453],
    dependsOnPrior: true,
    value: 0n,
  });
  expect(calls[2].args[0]).toBe(UNLOCK);
  // The direct path was never taken: nothing went through the per-write hook.
  expect(mocks.writeContractAsync).not.toHaveBeenCalled();
}

describe("LP edits under a Safe app go out as one batch", () => {
  beforeEach(() => {
    mocks.proposeSafeBatch.mockReset().mockResolvedValue(`0x${"cd".repeat(32)}`);
    mocks.writeContractAsync.mockReset();
    mocks.reverifyEditLiquidity.mockReset().mockResolvedValue(undefined);
    mocks.reverifyMarketEdit.mockReset().mockResolvedValue(undefined);
  });

  it("EditPositionPanel proposes approve → Permit2 → modifyLiquidities once, after re-verifying", async () => {
    const onDone = vi.fn();
    render(
      <EditPositionPanel
        state={state}
        pool={pool}
        position={position}
        tokenSymbol="ART"
        onClose={vi.fn()}
        onDone={onDone}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Increase the position" }));
    const dialog = await screen.findByRole("dialog", { name: "Confirm position edit" });
    await waitFor(() =>
      expect(dialog.textContent).toContain("Goes to your Safe as one batch of 3 calls"),
    );
    expect(dialog.textContent).toContain("Approve USDC access");

    fireEvent.click(screen.getAllByRole("button", { name: "Increase the position" }).at(-1)!);
    await waitFor(() => expect(mocks.proposeSafeBatch).toHaveBeenCalled());
    expectOneOrderedBatch("Edit position");
    expect(mocks.reverifyEditLiquidity).toHaveBeenCalledWith(pool, editPlan, ACCOUNT);
    expect(mocks.reverifyEditLiquidity.mock.invocationCallOrder[0]!).toBeLessThan(
      mocks.proposeSafeBatch.mock.invocationCallOrder[0]!,
    );
    await waitFor(() => expect(onDone).toHaveBeenCalledWith(null));
  });

  it("MarketEditPanel proposes the same ordered batch once", async () => {
    const onDone = vi.fn();
    render(
      <MarketEditPanel
        state={state}
        pool={pool}
        sides={{ tokenSide: position, pairSide: null }}
        tokenSymbol="ART"
        onClose={vi.fn()}
        onDone={onDone}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Edit the market" }));
    const dialog = await screen.findByRole("dialog", { name: "Confirm market edit" });
    await waitFor(() =>
      expect(dialog.textContent).toContain("Goes to your Safe as one batch of 3 calls"),
    );

    fireEvent.click(screen.getAllByRole("button", { name: "Edit the market" }).at(-1)!);
    await waitFor(() => expect(mocks.proposeSafeBatch).toHaveBeenCalled());
    expectOneOrderedBatch("Edit the market");
    expect(mocks.reverifyMarketEdit).toHaveBeenCalledWith(pool, marketPlan, ACCOUNT);
    await waitFor(() => expect(onDone).toHaveBeenCalledWith(null));
  });

  it("builds the batch list the three LP flows share, with only the final write dependent", () => {
    const calls = liquidityBatchCalls({
      chainId: 8453 as JBChainId,
      steps: [
        { title: "a", detail: "", approval: { kind: "erc20", currency: USDC, max: 1n } },
        { title: "b", detail: "", approval: { kind: "permit2", currency: USDC, max: 1n } },
        { title: "c", detail: "" },
      ],
      unlockData: UNLOCK,
      value: 7n,
    });
    expect(calls.map((call) => call.dependsOnPrior ?? false)).toEqual([false, false, true]);
    expect(calls.map((call) => call.functionName)).toEqual([
      "approve",
      "approve",
      "modifyLiquidities",
    ]);
    expect(calls[2]).toMatchObject({ functionName: "modifyLiquidities", value: 7n });
    expect(() =>
      liquidityBatchCalls({ chainId: 999 as JBChainId, steps: [], unlockData: UNLOCK, value: 0n }),
    ).toThrow(/unavailable on this chain/);
  });
});
