import { DeploySection } from "@/app/create/form/DeploySection";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { validRevnetForm } from "./fixtures/revnet";

const mocks = vi.hoisted(() => ({
  account: { connector: { id: "injected", name: "Injected" }, chainId: 10 },
  form: {} as Record<string, unknown>,
  submitForm: vi.fn(),
}));
vi.mock("wagmi", () => ({ useAccount: () => mocks.account }));
vi.mock("@/lib/wagmiConfig", () => ({ wagmiConfig: {} }));
vi.mock("@/hooks/useReviewedWriteContract", () => ({
  isSafeConnector: (connector: { id: string }) => connector.id === "safe",
}));
vi.mock("@/app/create/form/useCreateForm", () => ({ useCreateForm: () => mocks.form }));
vi.mock("@/components/ButtonWithWallet", () => ({
  ButtonWithWallet: ({
    children,
    disabled,
    onClick,
    targetChainId,
  }: {
    children: React.ReactNode;
    disabled: boolean;
    onClick: () => void;
    targetChainId: number;
  }) => (
    <button disabled={disabled} onClick={onClick} data-chain={targetChainId}>
      {children}
    </button>
  ),
}));
vi.mock("@/components/ui/TxConfirmDialog", () => ({
  SummaryRow: () => null,
  TxConfirmDialog: () => <div>Deployment review</div>,
}));

beforeEach(() => {
  mocks.account = { connector: { id: "injected", name: "Injected" }, chainId: 10 };
  mocks.form = {
    values: { ...validRevnetForm(), chainIds: [1, 10] },
    revnetTokenSymbol: "TEST",
    reserveAssetSymbol: "ETH",
    submitForm: mocks.submitForm,
    isSubmitting: false,
    isValid: true,
    errors: {},
    submitCount: 0,
  };
});

describe("wallet-action:create-revnet — creation route eligibility", () => {
  it("keeps the connected funding preference while reviewing supported mainnet EOA launch", () => {
    render(<DeploySection />);
    const button = screen.getByRole("button", { name: "Sign and get quote" });
    expect(button).toBeEnabled();
    expect(button).toHaveAttribute("data-chain", "10");
    fireEvent.click(button);
    expect(screen.getByText("Deployment review")).toBeVisible();
  });

  it.each(["Safe", "testnets"])(
    "guides %s multichain launch back to single-chain deployment before review",
    (route) => {
      if (route === "Safe") mocks.account.connector = { id: "safe", name: "Safe" };
      else mocks.form.values = { ...validRevnetForm(), chainIds: [11155111, 84532] };
      render(<DeploySection />);
      expect(screen.getByRole("alert")).toHaveTextContent("select one chain");
      const button = screen.getByRole("button", { name: "Sign and get quote" });
      expect(button).toBeDisabled();
      fireEvent.click(button);
      expect(screen.queryByText("Deployment review")).not.toBeInTheDocument();
      expect(mocks.submitForm).not.toHaveBeenCalled();
    },
  );

  it("retains direct single-chain Safe/testnet deployment", () => {
    mocks.account.connector = { id: "safe", name: "Safe" };
    mocks.form.values = { ...validRevnetForm(), chainIds: [11155111] };
    render(<DeploySection />);
    expect(screen.getByRole("button", { name: "Deploy the revnet" })).toBeEnabled();
  });
});
