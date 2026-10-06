import { BorrowDialog } from "@/app/[slug]/components/Value/BorrowDialog";
import { BridgeDialog } from "@/app/[slug]/components/Value/BridgeDialog";
import { ReallocateDialog } from "@/app/[slug]/components/Value/ReallocateDialog";
import { RedeemDialog } from "@/app/[slug]/components/Value/RedeemDialog";
import { RepayDialog } from "@/app/[slug]/components/Value/RepayDialog";
import { SafeProposalPendingError } from "@/hooks/useReviewedWriteContract";
import { recordTransactionActivity, updateTransactionActivity } from "@/lib/transaction-activity";
import { NATIVE_TOKEN, type JBChainId } from "@bananapus/nana-sdk-core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState, type ReactNode } from "react";
import type { Hex } from "viem";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Cash out, bridge, borrow, refinance and repay each host their confirm in
// their own dialog, whose owner resets and closes it on any request. While a
// send is in flight, from Confirm through the reads that precede the wallet
// prompt, the confirm must hold that dialog: before the hold, Escape, a
// backdrop press or the × dropped the run's only view while it kept going, and
// the next open could send again.

const mocks = vi.hoisted(() => ({
  write: vi.fn(),
  prepareCashOut: vi.fn(),
  freshBorrowable: vi.fn(),
  ensureAllowance: vi.fn(),
  hasPermissions: vi.fn(),
  toast: vi.fn(),
  /**
   * The hash each of a flow's write hooks sent last, as the hook reports it, in
   * the order the flow mounts its hooks (cash out: its sale, then its approval).
   */
  sent: [] as (`0x${string}` | undefined)[],
  /** How many write hooks have mounted, which picks each one's entry in `sent`. */
  writeHooks: 0,
  /** Whether the loan's base token is native, so repay skips its allowance read. */
  nativeBase: true,
  /**
   * When set, the allowance is enough on chain 1 (the loan's) and nothing on the
   * client usePublicClient returns without a chain (the wallet's).
   */
  allowanceOnLoanChainOnly: false,
  /** A pool sale beats cashing out, and the claimed tokens cover it. */
  directSell: false,
  /** A write goes to the Safe as a proposal, which reads as loading until it executes. */
  safeProposal: false,
  /** The chain whose node has a sent hash's receipt; no other chain's node has it. */
  receiptOn: null as number | null,
  /** Whether that receipt shows a revert. */
  reverted: false,
  /** A sent hash's receipt never lands: an unbounded watch waits forever, a bounded one ends. */
  neverLands: false,
}));

const tokenBalance = (chainId: number, projectId: number) => ({
  chainId,
  projectId,
  balance: { value: 5n * 10n ** 18n, format: () => "5" },
});

vi.mock("wagmi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("wagmi")>()),
  useAccount: () => ({ address: "0x1111111111111111111111111111111111111111" }),
  usePublicClient: (parameters?: { chainId?: number }) => ({
    readContract: async ({ functionName }: { functionName?: string }) =>
      mocks.directSell && functionName === "balanceOf"
        ? 5n * 10n ** 18n
        : mocks.allowanceOnLoanChainOnly && parameters?.chainId === 1
          ? 10n ** 30n
          : 0n,
  }),
  useWalletClient: () => ({ data: {} }),
  useSimulateContract: () => ({ isLoading: false, error: null }),
  // The chain's own receipt read, which a Safe proposal never makes. A sent
  // hash's receipt is only on `receiptOn`'s node; a bounded watch of one that
  // never lands ends at its timeout.
  useWaitForTransactionReceipt: ({
    hash,
    chainId,
    timeout,
    query,
  }: {
    hash?: string;
    chainId?: number;
    timeout?: number;
    query?: { enabled?: boolean };
  }) => {
    const idle = {
      data: undefined,
      error: null,
      isError: false,
      isLoading: false,
      isSuccess: false,
    };
    if (!hash || query?.enabled === false) return idle;
    if (chainId === mocks.receiptOn) {
      const status = mocks.reverted ? "reverted" : "success";
      return { ...idle, isSuccess: true, data: { status, transactionHash: hash } };
    }
    if (mocks.neverLands && typeof timeout === "number") {
      const error = Object.assign(new Error("Timed out while waiting for transaction."), {
        name: "WaitForTransactionReceiptTimeoutError",
      });
      return { ...idle, isError: true, error };
    }
    return { ...idle, isLoading: true };
  },
  useReadContract: ({ functionName }: { functionName?: string }) => {
    const loan = { amount: 10n ** 18n, collateral: 2n * 10n ** 18n };
    const answers: Record<string, unknown> = {
      PERMISSIONS: "0x4444444444444444444444444444444444444444",
      suckerPairsOf: [{ local: "0x3333333333333333333333333333333333333333", remoteChainId: 10n }],
      loanOf: loan,
      determineSourceFeeAmount: 1_000n,
      borrowableAmountFrom: [0n, 5n * 10n ** 17n],
    };
    return { data: functionName ? answers[functionName] : undefined, isLoading: false };
  },
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/lib/cache", () => ({ revalidateCacheTag: async () => undefined }));
vi.mock("@/components/ButtonWithWallet", () => ({
  ButtonWithWallet: ({
    children,
    loading: _loading,
    targetChainId: _chain,
    connectWalletText: _connect,
    variant: _variant,
    size: _size,
    ...props
  }: {
    children: ReactNode;
    loading?: boolean;
    targetChainId?: unknown;
    connectWalletText?: string;
    variant?: string;
    size?: string;
  }) => (
    // A loading button shows a spinner: aria-busy stands in for it.
    <button {...props} aria-busy={_loading || undefined}>
      {children}
    </button>
  ),
}));
vi.mock("@/components/ChainLogo", () => ({ ChainLogo: () => null }));
vi.mock("@/app/[slug]/components/Value/SimulatedLoanCard", () => ({
  SimulatedLoanCard: () => null,
}));
vi.mock("@/components/ui/use-toast", () => ({
  toast: mocks.toast,
  useToast: () => ({ toast: mocks.toast }),
}));
vi.mock("@/hooks/useReviewedWriteContract", async (importOriginal) => {
  const { useState } = await import("react");
  const activity = await import("@/lib/transaction-activity");
  return {
    // The write hook's own refusals, their tests and their lines, as the flows read them.
    ...(await importOriginal<typeof import("@/hooks/useReviewedWriteContract")>()),
    requireOnchainExecution: () => undefined,
    // Like wagmi's mutation, `data` is the hash the last write returned. Like the
    // reviewed write, a send is tracked on the chain it names, as a Safe proposal
    // when one is made.
    useWriteContract: () => {
      const [data, setData] = useState<string | undefined>(() => mocks.sent[mocks.writeHooks++]);
      return {
        writeContractAsync: async (variables: { chainId?: number }) => {
          const hash = await mocks.write(variables);
          // As the reviewed write does, read the stored activity before recording.
          activity.refreshTransactionActivities();
          if (hash && !activity.transactionActivityForHash(hash)) {
            activity.recordTransactionActivity({
              id: `tx:${variables.chainId}:${hash}`,
              kind: mocks.safeProposal ? "safe" : "direct",
              title: "The step",
              status: mocks.safeProposal ? "safe-proposed" : "pending",
              message: mocks.safeProposal ? "Submitted to Safe." : "Pending onchain confirmation.",
              chainId: variables.chainId,
              hash,
              ...(mocks.safeProposal ? { safeProposalHash: hash } : {}),
            });
          }
          setData(hash);
          return hash;
        },
        isPending: false,
        data,
        reset: vi.fn(),
      };
    },
  };
});
vi.mock("@/hooks/useAllowance", () => ({
  useAllowance: () => ({ ensureAllowance: mocks.ensureAllowance, isApproving: false }),
}));
vi.mock("@/hooks/useProjectBaseToken", () => ({
  useProjectBaseToken: () => ({ symbol: "ETH", decimals: 18, tokenMap: {} }),
}));
vi.mock("@/hooks/useBorrowableAmountFrom", () => ({
  useBorrowableAmountFrom: () => ({ data: 10n ** 18n, capacity: 2n * 10n ** 18n }),
}));
vi.mock("@/hooks/useCashOutRoute", () => ({
  useCashOutRoute: () => ({
    data: { expectedReturn: 10n ** 17n, minimumReturn: 9n * 10n ** 16n },
    isFetching: false,
    isError: false,
    refetch: vi.fn(),
  }),
}));
vi.mock("@/lib/directPaySwap", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/directPaySwap")>()),
  quoteDirectSellSwap: async () =>
    mocks.directSell
      ? { poolKey: {}, zeroForOne: true, quotedOutput: 2n * 10n ** 17n, minimumOutput: 10n ** 17n }
      : null,
}));
vi.mock("@/app/[slug]/components/v6/owners/market/lib", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/app/[slug]/components/v6/owners/market/lib")>()),
  readPoolSnapshot: async () => ({ pool: mocks.directSell ? { key: {} } : null }),
}));
vi.mock("@/lib/cashOutQuote", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/cashOutQuote")>()),
  cashOutPoolBufferBps: () => null,
}));
vi.mock("@/lib/bendystraw", () => ({
  ProjectOperation: { id: "Project" },
  SuckerGroupOperation: { id: "SuckerGroup" },
  useBendystrawQuery: () => ({ data: undefined }),
}));
vi.mock("@/lib/nana/project", () => ({
  useJBChainId: () => 1,
  useJBContractContext: () => ({
    contractAddress: () => "0x5555555555555555555555555555555555555555",
  }),
  useJBTokenContext: () => ({ token: { data: { decimals: 18, symbol: "REV" } } }),
}));
vi.mock("@/lib/nana/suckers", () => ({
  useSuckers: () => ({ data: [{ peerChainId: 1, projectId: 7n }] }),
  useSuckersUserTokenBalance: () => ({
    data: [tokenBalance(1, 7), tokenBalance(10, 8)],
    isLoading: false,
  }),
}));
vi.mock("@/lib/tokenUtils", () => ({
  getTokenConfigForChain: () => ({
    token: "0x000000000000000000000000000000000000EEEe",
    decimals: 18,
    currency: 61166,
    symbol: "ETH",
  }),
  getTokenSymbolFromAddress: () => "ETH",
  isNativeToken: () => mocks.nativeBase,
}));
vi.mock("@/lib/token", () => ({
  getTokenAddress: async () => "0x2222222222222222222222222222222222222222",
}));
vi.mock("@/lib/bridgePrepare", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/bridgePrepare")>()),
  quoteBridgePrepare: async () => ({
    netReclaimAmount: 10n ** 17n,
    minTokensReclaimed: 9n * 10n ** 16n,
    tokenDecimals: 18,
  }),
}));
vi.mock("@/lib/loanTransactions", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/loanTransactions")>()),
  readFreshBorrowableAmount: mocks.freshBorrowable,
}));
vi.mock("@bananapus/nana-sdk-core/v6", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@bananapus/nana-sdk-core/v6")>()),
  getTokenAddress: async () => "0x2222222222222222222222222222222222222222",
  hasPermissions: mocks.hasPermissions,
  prepareHookAwareCashOut: mocks.prepareCashOut,
}));

/** A read or wallet prompt that has not answered yet. */
const never = () => new Promise<never>(() => undefined);

function renderWithQueries(ui: ReactNode) {
  return render(<QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider>);
}

const dialogNamed = (name: string) => screen.getByRole("dialog", { name }) as HTMLDialogElement;
const confirmPanel = async () => {
  await waitFor(() => expect(document.querySelector("[data-tx-confirm]")).not.toBeNull());
  return document.querySelector<HTMLElement>("[data-tx-confirm]")!;
};
const hostClose = (dialog: HTMLDialogElement) =>
  [...dialog.querySelectorAll<HTMLButtonElement>("button")].find(
    (button) => !button.closest("[data-tx-confirm]") && button.textContent === "Close",
  )!;

/** Every way out of the dialog while the send is in flight; none may close it. */
function tryEveryWayOut(name: string) {
  const dialog = dialogNamed(name);
  fireEvent.keyDown(document, { key: "Escape" });
  fireEvent.pointerDown(dialog);
  fireEvent.click(hostClose(dialog));
  expect(dialog.open).toBe(true);
  expect(dialogNamed(name)).toBe(dialog);
  expect(document.querySelector("[data-tx-confirm]")).not.toBeNull();
}

beforeEach(() => {
  window.localStorage.clear();
  mocks.sent = [];
  mocks.writeHooks = 0;
  mocks.nativeBase = true;
  mocks.allowanceOnLoanChainOnly = false;
  mocks.directSell = false;
  mocks.safeProposal = false;
  mocks.receiptOn = null;
  mocks.neverLands = false;
  mocks.reverted = false;
  mocks.write.mockReset().mockImplementation(never);
  mocks.prepareCashOut.mockReset().mockImplementation(never);
  mocks.freshBorrowable.mockReset().mockImplementation(never);
  mocks.ensureAllowance.mockReset().mockResolvedValue(null);
  mocks.hasPermissions.mockReset().mockResolvedValue(true);
});

/** Each flow, opened as the app opens it, run up to its confirm's action. */
async function confirmCashOut() {
  renderWithQueries(
    <RedeemDialog projectId={7n} tokenSymbol="REV">
      <button type="button">Open cash out</button>
    </RedeemDialog>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Open cash out" }));
  fireEvent.click(await screen.findByRole("combobox"));
  fireEvent.click(await screen.findByRole("option", { name: /Ethereum/ }));
  fireEvent.change(screen.getByLabelText("Tokens to cash out"), { target: { value: "1" } });
  fireEvent.click(screen.getByRole("button", { name: "Cash out" }));
  const confirm = await confirmPanel();
  fireEvent.click(within(confirm).getByRole("button", { name: "Cash out" }));
}

async function confirmBridge() {
  renderWithQueries(
    <BridgeDialog
      projects={[
        { projectId: 7, chainId: 1, token: NATIVE_TOKEN },
        { projectId: 8, chainId: 10, token: NATIVE_TOKEN },
      ]}
    >
      <button type="button">Open move</button>
    </BridgeDialog>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Open move" }));
  const [, to] = await screen.findAllByRole("combobox");
  fireEvent.click(to);
  fireEvent.click(await screen.findByRole("option", { name: /Optimism/ }));
  fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "1" } });
  const move = screen.getByRole("button", { name: "Move REV" });
  await waitFor(() => expect(move).toBeEnabled());
  fireEvent.click(move);
  const confirm = await confirmPanel();
  await waitFor(() =>
    expect(within(confirm).getByRole("button", { name: "Move REV" })).toBeEnabled(),
  );
  fireEvent.click(within(confirm).getByRole("button", { name: "Move REV" }));
}

async function confirmBorrow() {
  renderWithQueries(
    <BorrowDialog projectId={7n} tokenSymbol="REV">
      <button type="button">Open borrow</button>
    </BorrowDialog>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Open borrow" }));
  fireEvent.change(await screen.findByLabelText(/How much REV/), { target: { value: "1" } });
  const open = screen.getByRole("button", { name: "Open loan" });
  await waitFor(() => expect(open).toBeEnabled());
  fireEvent.click(open);
  const confirm = await confirmPanel();
  fireEvent.click(within(confirm).getByRole("button", { name: "Open loan" }));
}

async function confirmRefinance() {
  renderWithQueries(
    <ReallocateDialog projectId={7n} tokenSymbol="REV" selectedLoan={LOAN}>
      <button type="button">Open refinance</button>
    </ReallocateDialog>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Open refinance" }));
  const refinance = await screen.findByRole("button", { name: "Refinance loan" });
  await waitFor(() => expect(refinance).toBeEnabled());
  fireEvent.click(refinance);
  const confirm = await confirmPanel();
  fireEvent.click(within(confirm).getByRole("button", { name: "Refinance loan" }));
}

async function confirmRepay() {
  function Loans() {
    const [open, setOpen] = useState(true);
    return (
      <RepayDialog
        loanId="3"
        chainId={1 as JBChainId}
        projectId={7n}
        loanProjectId={7n}
        open={open}
        onOpenChange={setOpen}
      />
    );
  }
  renderWithQueries(<Loans />);
  const repay = await screen.findByRole("button", { name: "Repay loan" });
  await waitFor(() => expect(repay).toBeEnabled());
  fireEvent.click(repay);
  const confirm = await confirmPanel();
  fireEvent.click(within(confirm).getByRole("button", { name: "Repay loan" }));
}

describe("value flows hold their dialog while a send is in flight", () => {
  it("cash out, from Confirm through the route read before the wallet prompt", async () => {
    await confirmCashOut();
    await waitFor(() => expect(mocks.prepareCashOut).toHaveBeenCalledTimes(1));
    tryEveryWayOut("Cash out");
  });

  it("bridge", async () => {
    await confirmBridge();
    await waitFor(() => expect(mocks.write).toHaveBeenCalledTimes(1));
    tryEveryWayOut("Move between networks");
  });

  it("borrow, from Confirm through the fresh quote read before the wallet prompt", async () => {
    await confirmBorrow();
    await waitFor(() => expect(mocks.freshBorrowable).toHaveBeenCalledTimes(1));
    tryEveryWayOut("New loan");
  });

  it("refinance, from Confirm through the fresh quote read before the wallet prompt", async () => {
    await confirmRefinance();
    await waitFor(() => expect(mocks.freshBorrowable).toHaveBeenCalledTimes(1));
    tryEveryWayOut("Refinance loan");
  });

  it("wallet-action:repay repay", async () => {
    await confirmRepay();
    await waitFor(() => expect(mocks.write).toHaveBeenCalledTimes(1));
    tryEveryWayOut("Repay loan");
  });
});

/** Opens a market sale on Ethereum and presses its confirm's token approval. */
async function approveSale() {
  mocks.directSell = true;
  mocks.write.mockResolvedValue(`0x${"cd".repeat(32)}`);
  renderWithQueries(
    <RedeemDialog projectId={7n} tokenSymbol="REV">
      <button type="button">Open cash out</button>
    </RedeemDialog>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Open cash out" }));
  fireEvent.click(await screen.findByRole("combobox"));
  fireEvent.click(await screen.findByRole("option", { name: /Ethereum/ }));
  fireEvent.change(screen.getByLabelText("Tokens to cash out"), { target: { value: "1" } });
  const sell = await screen.findByRole("button", { name: "Sell on market" });
  await waitFor(() => expect(sell).toBeEnabled());
  fireEvent.click(sell);
  const confirm = await confirmPanel();
  fireEvent.click(within(confirm).getByRole("button", { name: "Approve tokens" }));
  await waitFor(() => expect(mocks.write).toHaveBeenCalledOnce());
  expect(mocks.write.mock.calls[0]![0]).toMatchObject({ functionName: "approve", chainId: 1 });
  return confirm;
}

describe("cash out's sale approval", () => {
  it("ends on Done, with the sale locked, when the approval's receipt never lands", async () => {
    mocks.neverLands = true;
    const confirm = await approveSale();

    const done = await within(confirm).findByRole("button", { name: "Done" });
    expect(confirm).toHaveTextContent("Couldn't confirm the approval yet.");
    expect(within(confirm).queryByRole("button", { name: /Approv|Sell/ })).toBeNull();
    fireEvent.click(done);
    await waitFor(() => expect(document.querySelector("[data-tx-confirm]")).toBeNull());
    const cashOut = dialogNamed("Cash out");
    expect(cashOut.open).toBe(true);
    // Settled, not spinning: the sale stays locked and says why.
    const sell = within(cashOut).getByRole("button", { name: "Sell on market" });
    expect(sell).toBeDisabled();
    expect(sell).not.toHaveAttribute("aria-busy");
    expect(cashOut).toHaveTextContent("Couldn't confirm the approval yet.");
    expect(mocks.write).toHaveBeenCalledOnce();
  });

  it("holds the confirm until the approval's receipt lands", async () => {
    const confirm = await approveSale();

    await waitFor(() =>
      expect(within(confirm).getByRole("button", { name: "Cancel" })).toBeDisabled(),
    );
    tryEveryWayOut("Cash out");
    expect(mocks.write).toHaveBeenCalledOnce();
  });

  it("wallet-action:cash-out releases the confirm once the approval's receipt lands on the cash-out chain", async () => {
    mocks.receiptOn = 1;
    const confirm = await approveSale();

    await waitFor(() =>
      expect(within(confirm).getByRole("button", { name: "Cancel" })).toBeEnabled(),
    );
    expect(mocks.write).toHaveBeenCalledOnce();
  });

  it("shows a reverted approval, and Cancel goes back with nothing more sent", async () => {
    mocks.receiptOn = 1;
    mocks.reverted = true;
    const confirm = await approveSale();

    const cancel = within(confirm).getByRole("button", { name: "Cancel" });
    await waitFor(() => expect(cancel).toBeEnabled());
    expect(confirm).toHaveTextContent("reverted onchain");
    fireEvent.click(cancel);
    await waitFor(() => expect(document.querySelector("[data-tx-confirm]")).toBeNull());
    expect(dialogNamed("Cash out").open).toBe(true);
    expect(mocks.write).toHaveBeenCalledOnce();
  });

  it("ends on Done when proposed to Safe, rather than holding the confirm until the Safe executes it", async () => {
    mocks.safeProposal = true;
    const confirm = await approveSale();

    const done = await within(confirm).findByRole("button", { name: "Done" });
    expect(confirm).toHaveTextContent("The approval was proposed to Safe.");
    expect(mocks.write).toHaveBeenCalledOnce();
    fireEvent.click(done);
    await waitFor(() => expect(document.querySelector("[data-tx-confirm]")).toBeNull());
    const cashOut = dialogNamed("Cash out");
    expect(cashOut.open).toBe(true);
    const sell = within(cashOut).getByRole("button", { name: "Sell on market" });
    expect(sell).toBeDisabled();
    expect(sell).not.toHaveAttribute("aria-busy");
    expect(cashOut).toHaveTextContent("The approval was proposed to Safe.");
  });

  it("ends on Done with its line, the sale locked, once the approval's Safe proposal can't be confirmed", async () => {
    mocks.safeProposal = true;
    const confirm = await approveSale();
    await within(confirm).findByRole("button", { name: "Done" });

    // The watch gives up on the proposal: its result can't be confirmed here.
    act(() =>
      updateTransactionActivity(`tx:1:0x${"cd".repeat(32)}`, { safeResultUnconfirmed: true }),
    );

    const line =
      "This step's Safe proposal can't be confirmed here. Check it in Safe, then dismiss it in your account activity.";
    await waitFor(() => expect(confirm).toHaveTextContent(line));
    expect(confirm).not.toHaveTextContent("The approval was proposed to Safe.");
    expect(within(confirm).queryByRole("button", { name: /Approv|Sell/ })).toBeNull();
    fireEvent.click(within(confirm).getByRole("button", { name: "Done" }));
    await waitFor(() => expect(document.querySelector("[data-tx-confirm]")).toBeNull());
    const cashOut = dialogNamed("Cash out");
    const sell = within(cashOut).getByRole("button", { name: "Sell on market" });
    expect(sell).toBeDisabled();
    expect(sell).not.toHaveAttribute("aria-busy");
    expect(cashOut).toHaveTextContent(line);
    expect(mocks.write).toHaveBeenCalledOnce();
  });
});

// The confirm no longer switches the wallet before it sends, so a flow's reads
// must name the chain they are about rather than follow the wallet's.
describe("repay reads on the loan's chain", () => {
  it("checks the allowance on the loan's chain, whichever chain the wallet is on", async () => {
    mocks.nativeBase = false;
    mocks.allowanceOnLoanChainOnly = true;
    function Loans() {
      const [open, setOpen] = useState(true);
      return (
        <RepayDialog
          loanId="3"
          chainId={1 as JBChainId}
          projectId={7n}
          loanProjectId={7n}
          open={open}
          onOpenChange={setOpen}
        />
      );
    }
    renderWithQueries(<Loans />);

    const repay = await screen.findByRole("button", { name: "Repay loan" });
    await waitFor(() => expect(repay).toBeEnabled());
    expect(screen.queryByText("Token approval needed")).toBeNull();
  });
});

// Each send pays out to the account that pressed Confirm (the cash out, the
// sale, the loan, the bridged tokens, the returned collateral), so each names
// it: the reviewed write refuses it from any other account, such as one the
// wallet switched to while an approval or a quote was still in flight.
describe("value sends name the account they pay", () => {
  it.each([
    ["cash out", confirmCashOut],
    ["bridge", confirmBridge],
    ["borrow", confirmBorrow],
    ["refinance", confirmRefinance],
    ["repay", confirmRepay],
  ])("%s", async (_, confirmFlow) => {
    mocks.prepareCashOut.mockResolvedValue({
      route: { expectedReturn: 10n ** 17n },
      transaction: {
        chainId: 1,
        address: "0x6666666666666666666666666666666666666666",
        abi: [],
        functionName: "cashOutTokensOf",
        args: [],
      },
    });
    mocks.freshBorrowable.mockResolvedValue(10n ** 18n);
    await confirmFlow();
    await waitFor(() => expect(mocks.write).toHaveBeenCalledTimes(1));
    expect(mocks.write.mock.calls[0]![0]).toMatchObject({
      account: "0x1111111111111111111111111111111111111111",
    });
  });
});

// A step whose identical Safe proposal ended where the app can't confirm its result is refused.
// Each flow says to check that proposal in Safe, and neither that the step failed nor that
// permission was denied.
describe("loan flows refused by a Safe proposal the app can't confirm", () => {
  const PROPOSAL = `0x${"ab".repeat(32)}` as Hex;

  it.each([
    ["borrow's permission step", confirmBorrow, false],
    ["borrow", confirmBorrow, true],
    ["refinance", confirmRefinance, true],
    ["repay", confirmRepay, true],
  ])("%s", async (_flow, confirmFlow, permitted) => {
    mocks.hasPermissions.mockResolvedValue(permitted);
    mocks.freshBorrowable.mockResolvedValue(10n ** 18n);
    mocks.write.mockRejectedValue(new SafeProposalPendingError(PROPOSAL, "The step", true));

    await confirmFlow();

    const confirm = await confirmPanel();
    await within(confirm).findByText(
      "This step's Safe proposal can't be confirmed here. Check it in Safe, then dismiss it in your account activity.",
    );
    expect(confirm.textContent).not.toMatch(/denied|failed|not granted|could not/i);
    expect(mocks.toast).toHaveBeenCalledExactlyOnceWith({
      title: "Safe proposal unconfirmed",
      description: `The step was proposed to Safe as ${PROPOSAL}, and its result can't be confirmed here. Check it in Safe, then dismiss it in your account activity.`,
    });
  });
});

describe("value flows open over their own Safe proposal the app can't confirm", () => {
  async function openBridge() {
    renderWithQueries(
      <BridgeDialog
        projects={[
          { projectId: 7, chainId: 1, token: NATIVE_TOKEN },
          { projectId: 8, chainId: 10, token: NATIVE_TOKEN },
        ]}
      >
        <button type="button">Open move</button>
      </BridgeDialog>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Open move" }));
  }

  async function openCashOut() {
    renderWithQueries(
      <RedeemDialog projectId={7n} tokenSymbol="REV">
        <button type="button">Open cash out</button>
      </RedeemDialog>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Open cash out" }));
  }

  // Only the named step's own hook holds the flagged hash, so each line is pinned on its own.
  it.each([
    ["bridge", openBridge, 0],
    ["cash out's sale", openCashOut, 0],
    ["cash out's approval", openCashOut, 1],
  ])("%s says to check the proposal in Safe", async (_flow, open, hook) => {
    const proposal = `0x${"ce".repeat(32)}` as Hex;
    recordTransactionActivity({
      id: `tx:1:${proposal}`,
      kind: "safe",
      title: "The step",
      status: "safe-proposed",
      message:
        "This Safe transaction's result can't be confirmed here. Check it in Safe before retrying.",
      chainId: 1,
      hash: proposal,
      safeProposalHash: proposal,
      safeResultUnconfirmed: true,
    });
    mocks.sent[hook] = proposal;

    await open();

    expect(
      await screen.findByText(
        "This step's Safe proposal can't be confirmed here. Check it in Safe, then dismiss it in your account activity.",
      ),
    ).toBeVisible();
  });
});

describe("cash out refused by a Safe proposal the app can't confirm", () => {
  it("says to check that proposal in Safe, and not that the cash out failed", async () => {
    const proposal = `0x${"ab".repeat(32)}` as Hex;
    mocks.prepareCashOut.mockResolvedValue({
      route: { expectedReturn: 10n ** 17n },
      transaction: {
        chainId: 1,
        address: "0x6666666666666666666666666666666666666666",
        abi: [],
        functionName: "cashOutTokensOf",
        args: [],
      },
    });
    mocks.write.mockRejectedValue(new SafeProposalPendingError(proposal, "The step", true));

    await confirmCashOut();

    const confirm = await confirmPanel();
    await within(confirm).findByText(
      "This step's Safe proposal can't be confirmed here. Check it in Safe, then dismiss it in your account activity.",
    );
    expect(confirm.textContent).not.toMatch(/failed|could not/i);
    expect(within(confirm).queryByRole("alert")).toBeNull();
    expect(mocks.toast).toHaveBeenCalledExactlyOnceWith({
      title: "Safe proposal unconfirmed",
      description: `The step was proposed to Safe as ${proposal}, and its result can't be confirmed here. Check it in Safe, then dismiss it in your account activity.`,
    });
  });
});

describe("a repayment left open over its own Safe proposal the app can't confirm", () => {
  it("stops reading as pending and says to check the proposal in Safe", async () => {
    const proposal = `0x${"cd".repeat(32)}` as Hex;
    recordTransactionActivity({
      id: `tx:1:${proposal}`,
      kind: "safe",
      title: "repayLoan",
      status: "safe-proposed",
      message:
        "This Safe transaction's result can't be confirmed here. Check it in Safe before retrying.",
      chainId: 1,
      hash: proposal,
      safeProposalHash: proposal,
      safeResultUnconfirmed: true,
    });
    mocks.write.mockResolvedValue(proposal);

    await confirmRepay();

    expect(
      (
        await screen.findAllByText(
          "This step's Safe proposal can't be confirmed here. Check it in Safe, then dismiss it in your account activity.",
        )
      ).length,
    ).toBeGreaterThan(0);
    expect(screen.queryByText("Repayment pending...")).toBeNull();
  });
});

// The wallet may sit on another chain by the time a send confirms: each flow
// watches its receipt on the chain it sent on.
describe("value sends watch their receipt on the chain they sent on", () => {
  beforeEach(() => {
    mocks.write.mockResolvedValue(`0x${"cd".repeat(32)}`);
    mocks.freshBorrowable.mockResolvedValue(10n ** 18n);
    mocks.receiptOn = 1;
  });

  it("bridge", async () => {
    await confirmBridge();
    expect(await screen.findByText(/First step confirmed/)).toBeInTheDocument();
  });

  it("borrow", async () => {
    await confirmBorrow();
    expect(await screen.findByText("Loan opened.")).toBeInTheDocument();
  });

  it("refinance", async () => {
    await confirmRefinance();
    expect(await screen.findByText("Loan refinanced.")).toBeInTheDocument();
  });

  it("repay", async () => {
    await confirmRepay();
    const dialog = dialogNamed("Repay loan");
    await waitFor(() =>
      expect(within(dialog).queryByRole("button", { name: "Repay loan" })).toBeNull(),
    );
    expect(within(dialog).getAllByRole("button", { name: "Close" }).length).toBeGreaterThan(0);
  });
});

const LOAN = {
  id: "3",
  chainId: 1,
  borrowAmount: (10n ** 18n).toString(),
  collateral: (2n * 10n ** 18n).toString(),
  projectId: 7,
};
