import { V6BurnTokensDialog } from "@/app/[slug]/components/v6/owners/accounts/V6BurnTokensDialog";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import type { Hex } from "viem";
import { describe, expect, it, vi } from "vitest";

// wallet-action:burn

const PROPOSAL = `0x${"ce".repeat(32)}` as Hex;
const CONTROLLER = "0x5555555555555555555555555555555555555555";

const mocks = vi.hoisted(() => ({
  write: vi.fn(),
  readContract: vi.fn(),
}));

vi.mock("wagmi", () => ({
  useAccount: () => ({ address: "0x1111111111111111111111111111111111111111" }),
  usePublicClient: () => ({ readContract: mocks.readContract }),
}));
vi.mock("@/components/ButtonWithWallet", () => ({
  ButtonWithWallet: ({
    children,
    loading: _loading,
    targetChainId: _chain,
    variant: _variant,
    ...props
  }: {
    children: ReactNode;
    loading?: boolean;
    targetChainId?: unknown;
    variant?: string;
  }) => <button {...props}>{children}</button>,
}));
vi.mock("@/components/ChainLogo", () => ({ ChainLogo: () => null }));
vi.mock("@/components/ui/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@/hooks/useReviewedWriteContract", async (importOriginal) => ({
  SAFE_PROPOSAL_UNCONFIRMED_LINE: (
    await importOriginal<typeof import("@/hooks/useReviewedWriteContract")>()
  ).SAFE_PROPOSAL_UNCONFIRMED_LINE,
  useWriteContract: () => ({ writeContractAsync: mocks.write, isPending: false }),
  // The burn's own Safe proposal ends where the app can't confirm its result.
  useWaitForTransactionReceipt: ({ hash }: { hash?: Hex }) => ({
    isLoading: false,
    isSuccess: false,
    isSafeResultUnconfirmed: hash === PROPOSAL,
  }),
}));

describe("wallet-action:burn — a burn left open over its own Safe proposal the app can't confirm", () => {
  it("says to check the proposal in Safe", async () => {
    mocks.readContract.mockImplementation(async ({ functionName }: { functionName: string }) =>
      functionName === "totalBalanceOf" ? 10n ** 21n : CONTROLLER,
    );
    mocks.write.mockResolvedValue(PROPOSAL);
    render(
      <V6BurnTokensDialog
        rows={[{ chainId: 1, projectId: 7n, balance: 10n ** 21n }]}
        tokenSymbol="REV"
      >
        <button type="button">Open burn</button>
      </V6BurnTokensDialog>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Open burn" }));
    fireEvent.change(await screen.findByPlaceholderText("Amount of REV"), {
      target: { value: "1" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Burn permanently" }));
    await waitFor(() => expect(document.querySelector("[data-tx-confirm]")).not.toBeNull());
    const confirm = document.querySelector<HTMLElement>("[data-tx-confirm]")!;

    fireEvent.click(within(confirm).getByRole("button", { name: "Burn permanently" }));

    await waitFor(() => expect(mocks.write).toHaveBeenCalledTimes(1));
    await screen.findByText(
      "This step's Safe proposal can't be confirmed here. Check it in Safe, then dismiss it in your account activity.",
    );
  });
});
