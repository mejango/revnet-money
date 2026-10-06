import { BorrowDialog } from "@/app/[slug]/components/Value/BorrowDialog";
import { BridgeDialog } from "@/app/[slug]/components/Value/BridgeDialog";
import { ReallocateDialog } from "@/app/[slug]/components/Value/ReallocateDialog";
import { RedeemDialog } from "@/app/[slug]/components/Value/RedeemDialog";
import { RepayDialog } from "@/app/[slug]/components/Value/RepayDialog";
import { SafeProposalPendingError } from "@/hooks/useReviewedWriteContract";
import { recordTransactionActivity } from "@/lib/transaction-activity";
import { NATIVE_TOKEN, type JBChainId } from "@bananapus/nana-sdk-core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
}));

const tokenBalance = (chainId: number, projectId: number) => ({
  chainId,
  projectId,
  balance: { value: 5n * 10n ** 18n, format: () => "5" },
});

vi.mock("wagmi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("wagmi")>()),
  useAccount: () => ({ address: "0x1111111111111111111111111111111111111111" }),
  usePublicClient: () => ({ readContract: async () => 0n }),
  useWalletClient: () => ({ data: {} }),
  useSimulateContract: () => ({ isLoading: false, error: null }),
  // The chain's own receipt read, which a Safe proposal never makes.
  useWaitForTransactionReceipt: () => ({
    data: undefined,
    error: null,
    isError: false,
    isLoading: false,
    isSuccess: false,
  }),
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
  }) => <button {...props}>{children}</button>,
}));
vi.mock("@/components/ChainLogo", () => ({ ChainLogo: () => null }));
vi.mock("@/app/[slug]/components/Value/SimulatedLoanCard", () => ({
  SimulatedLoanCard: () => null,
}));
vi.mock("@/components/ui/use-toast", () => ({
  toast: mocks.toast,
  useToast: () => ({ toast: mocks.toast }),
}));
vi.mock("@/hooks/useReviewedWriteContract", async (importOriginal) => ({
  // The write hook's own refusals, their tests and their lines, as the flows read them.
  ...(await importOriginal<typeof import("@/hooks/useReviewedWriteContract")>()),
  requireOnchainExecution: () => undefined,
  useWriteContract: () => ({
    writeContractAsync: mocks.write,
    isPending: false,
    data: undefined,
    reset: vi.fn(),
  }),
}));
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
  isNativeToken: () => true,
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

  it("repay", async () => {
    await confirmRepay();
    await waitFor(() => expect(mocks.write).toHaveBeenCalledTimes(1));
    tryEveryWayOut("Repay loan");
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

const LOAN = {
  id: "3",
  chainId: 1,
  borrowAmount: (10n ** 18n).toString(),
  collateral: (2n * 10n ** 18n).toString(),
  projectId: 7,
};
