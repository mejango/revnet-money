import {
  AddLiquidityForm,
  LiquidityManager,
} from "@/app/[slug]/components/v6/owners/market/AmmCard";
import { EditPositionPanel } from "@/app/[slug]/components/v6/owners/market/EditPositionPanel";
import type {
  AmmChainState,
  EditLiquidityPlan,
  MarketEditPlan,
  PoolSnapshot,
  UserLpPosition,
} from "@/app/[slug]/components/v6/owners/market/lib";
import { MarketEditPanel } from "@/app/[slug]/components/v6/owners/market/MarketEditPanel";
import type { JBChainId } from "@bananapus/nana-sdk-core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { zeroAddress, type Address, type Hex } from "viem";
import { beforeEach, describe, expect, it, vi } from "vitest";

// wallet-action:liquidity-management
//
// A liquidity plan names the account that reviewed it: a mint's position, a
// removal's two sides and an edit's freed funds all go to it. When the wallet
// switches accounts between review and confirm, the plan must not be sent
// from the new account. The flow drops it and says so; a fresh review binds
// the send to the account that is connected.

const A = "0x1111111111111111111111111111111111111111" as Address;
const B = "0x2222222222222222222222222222222222222222" as Address;
const UNLOCK = `0x${"ab".repeat(40)}` as Hex;
const HASH = `0x${"cd".repeat(32)}` as Hex;
const ACCOUNT_CHANGED = "The connected account changed. Review again.";

const mocks = vi.hoisted(() => ({
  address: "0x1111111111111111111111111111111111111111",
  write: vi.fn(),
}));

vi.mock("wagmi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("wagmi")>()),
  useAccount: () => ({ address: mocks.address }),
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
    children: ReactNode;
    loading?: boolean;
    targetChainId?: unknown;
    connectWalletText?: string;
  }) => <button {...props}>{children}</button>,
}));
vi.mock("@/components/ChainLogo", () => ({ ChainLogo: () => null }));
vi.mock("@/hooks/useAllowance", () => ({
  useAllowance: () => ({ ensureAllowance: vi.fn(), isApproving: false }),
}));
vi.mock("@/hooks/useReviewedWriteContract", () => ({
  ACCOUNT_CHANGED: "The connected account changed. Review again.",
  isSafeConnection: () => false,
  proposeSafeBatch: vi.fn(),
  submittedViaSafe: () => false,
  useSafeConnection: () => false,
  useWaitForTransactionReceipt: () => ({ isSuccess: false }),
  useWriteContract: () => ({ writeContractAsync: mocks.write, isPending: false }),
}));
vi.mock("@/lib/waitForReceipt", () => ({
  waitForReceiptWithRetry: async () => ({ status: "success" }),
}));
vi.mock("@/app/[slug]/components/v6/owners/market/lib", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/app/[slug]/components/v6/owners/market/lib")>();
  const plan = {
    unlockData: `0x${"ab".repeat(40)}`,
    value: 0n,
    erc20Sides: [],
    tokenMaximum: 0n,
    pairMaximum: 0n,
    tokenMinimum: 0n,
    pairMinimum: 0n,
    tokenSide: null,
    pairSide: null,
  };
  return {
    ...actual,
    prepareMarketLiquidity: () => plan,
    reverifyMarketLiquidity: async () => undefined,
    refreshPoolAndPosition: async (pool: PoolSnapshot) => ({ pool, position }),
    prepareEditLiquidity: () => editPlan,
    prepareMarketEdit: () => marketPlan,
    readUserLpPositions: async () => [position],
    readLpPositionFees: async () => ({ tokenFees: 5n, pairFees: 5n }),
    refreshUserLpPosition: async () => position,
    prepareRemoveLiquidity: () => plan,
  };
});
vi.mock("@/app/[slug]/components/v6/owners/market/liquidityWrite", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@/app/[slug]/components/v6/owners/market/liquidityWrite")
  >()),
  approvalStepsFor: async () => [],
}));

const pool = {
  chainId: 8453 as JBChainId,
  projectId: 6,
  price: 0.00001,
  poolId: "0xpool",
  key: { tickSpacing: 60 },
  pair: { addr: zeroAddress, decimals: 18, symbol: "ETH", currency: 1n },
  pairIsC0: true,
  projectToken: "0x3333333333333333333333333333333333333333",
} as unknown as PoolSnapshot;

const position = {
  tokenId: 42n,
  owner: A,
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
  reference: { cashOut: 6.68961e-8, issuance: 0.0016 },
};

const editPlan = {
  kind: "increase",
  tokenId: 42n,
  unlockData: UNLOCK,
  value: 0n,
  erc20Sides: [],
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
  erc20Sides: [],
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

/** Renders `flow` and returns the switch a wallet makes to another account. */
function renderFlow(flow: () => ReactNode) {
  const client = new QueryClient();
  const view = render(<QueryClientProvider client={client}>{flow()}</QueryClientProvider>);
  return (account: Address) => {
    mocks.address = account;
    view.rerender(<QueryClientProvider client={client}>{flow()}</QueryClientProvider>);
  };
}

const confirmAction = async (name: string) => {
  const confirm = await screen.findByRole("dialog", { name: /^Confirm/ });
  const action = within(confirm).getByRole("button", { name });
  await waitFor(() => expect(action).toBeEnabled());
  return action;
};

beforeEach(() => {
  mocks.address = A;
  mocks.write.mockReset().mockResolvedValue(HASH);
});

describe("wallet-action:liquidity-management — a plan sent only from the account that reviewed it", () => {
  it("add liquidity refuses to mint the reviewed position from another account", async () => {
    const switchTo = renderFlow(() => <AddLiquidityForm state={state} tokenSymbol="MARKEE" />);
    fireEvent.change(screen.getByRole("spinbutton", { name: /MARKEE/ }), {
      target: { value: "20000000" },
    });
    fireEvent.change(screen.getByRole("spinbutton", { name: /^ETH/ }), {
      target: { value: "0.08" },
    });
    fireEvent.click(screen.getAllByRole("button", { name: "Make the market" }).at(-1)!);
    const mint = await confirmAction("Make the market");

    switchTo(B);
    fireEvent.click(mint);

    await screen.findByText(ACCOUNT_CHANGED);
    expect(mocks.write).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog", { name: /^Confirm/ })).toBeNull();

    // A fresh review is B's, and the mint is bound to B.
    fireEvent.click(screen.getAllByRole("button", { name: "Make the market" }).at(-1)!);
    fireEvent.click(await confirmAction("Make the market"));
    await waitFor(() => expect(mocks.write).toHaveBeenCalledTimes(1));
    expect(mocks.write).toHaveBeenCalledWith(
      expect.objectContaining({ functionName: "modifyLiquidities", account: B }),
    );
  });

  it("remove refuses to burn the reviewed position from another account", async () => {
    const switchTo = renderFlow(() => (
      <LiquidityManager states={[state]} tokenSymbol="ART" heading={null} />
    ));
    await waitFor(() => expect(screen.getByRole("button", { name: "Remove" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    await confirmAction("Remove the position");

    // The list reloads for B, and the removal reviewed for A is still on screen.
    switchTo(B);
    fireEvent.click(await confirmAction("Remove the position"));

    await screen.findByText(ACCOUNT_CHANGED);
    expect(mocks.write).not.toHaveBeenCalled();
  });

  it("edit position refuses to send the reviewed edit from another account", async () => {
    const switchTo = renderFlow(() => (
      <EditPositionPanel
        state={state}
        pool={pool}
        position={position}
        tokenSymbol="ART"
        onClose={vi.fn()}
        onDone={vi.fn()}
      />
    ));
    fireEvent.click(screen.getByRole("button", { name: "Increase the position" }));
    const increase = await confirmAction("Increase the position");

    switchTo(B);
    fireEvent.click(increase);

    await screen.findByText(ACCOUNT_CHANGED);
    expect(mocks.write).not.toHaveBeenCalled();
  });

  it("edit market refuses to send the reviewed edit from another account", async () => {
    const switchTo = renderFlow(() => (
      <MarketEditPanel
        state={state}
        pool={pool}
        sides={{ tokenSide: position, pairSide: null }}
        tokenSymbol="ART"
        onClose={vi.fn()}
        onDone={vi.fn()}
      />
    ));
    fireEvent.click(screen.getByRole("button", { name: "Edit the market" }));
    const edit = await confirmAction("Edit the market");

    switchTo(B);
    fireEvent.click(edit);

    await screen.findByText(ACCOUNT_CHANGED);
    expect(mocks.write).not.toHaveBeenCalled();
  });
});
