import { ButtonWithWallet } from "@/components/ButtonWithWallet";
import { WalletButton, WalletConnectButton } from "@/components/WalletButton";
import { clearViewAs, setViewAs } from "@/lib/view-as";
import { ParaAuthContext } from "@/providers/ParaAuthContext";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { Address } from "viem";
import { beforeEach, describe, expect, it, vi } from "vitest";

const wallet = vi.hoisted(() => ({
  account: vi.fn(),
  balance: vi.fn(),
  chainId: vi.fn(),
  connectAsync: vi.fn(),
  connectors: vi.fn(),
  disconnectAsync: vi.fn(),
  jbChainId: vi.fn(),
  logoutParaSession: vi.fn(),
  readContract: vi.fn(),
  reset: vi.fn(),
  switchChainAsync: vi.fn(),
}));

vi.mock("wagmi", () => ({
  useAccount: wallet.account,
  useBalance: wallet.balance,
  useChainId: wallet.chainId,
  useConnect: () => ({
    connectAsync: wallet.connectAsync,
    error: null,
    isPending: false,
    reset: wallet.reset,
  }),
  useConnectors: wallet.connectors,
  useDisconnect: () => ({ disconnectAsync: wallet.disconnectAsync, isPending: false }),
  useReadContract: wallet.readContract,
  useSwitchChain: () => ({
    isPending: false,
    switchChainAsync: wallet.switchChainAsync,
  }),
}));

vi.mock("@/lib/nana/project", () => ({
  useJBChainId: wallet.jbChainId,
  useJBProject: () => undefined,
  useJBTokenContext: vi.fn(),
}));
vi.mock("@/lib/nana/suckers", () => ({
  useSuckersUserTokenBalance: vi.fn(),
}));
vi.mock("@/hooks/ens/useEnsName", () => ({ useEnsName: () => ({ data: null }) }));
vi.mock("@/providers/para-logout", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/providers/para-logout")>();
  return { ...original, logoutParaSession: wallet.logoutParaSession };
});

describe("local wallet controls", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearViewAs();
    wallet.account.mockReturnValue({
      address: undefined,
      chain: undefined,
      isConnected: false,
    });
    wallet.balance.mockReturnValue({ data: undefined });
    wallet.readContract.mockReturnValue({ data: undefined });
    wallet.chainId.mockReturnValue(1);
    wallet.jbChainId.mockReturnValue(1);
    wallet.connectors.mockReturnValue([
      { id: "injected", name: "Browser Wallet", uid: "browser-wallet" },
    ]);
    wallet.connectAsync.mockResolvedValue(undefined);
    wallet.disconnectAsync.mockResolvedValue(undefined);
    wallet.logoutParaSession.mockResolvedValue(undefined);
    wallet.switchChainAsync.mockResolvedValue(undefined);
  });

  it("sends a disconnected visitor straight to the sign-in sheet", () => {
    // The sheet carries email, phone, socials and wallets, so a menu in front
    // of it would only ask which door to use twice.
    const requestSignIn = vi.fn();
    render(
      <ParaAuthContext.Provider
        value={{
          enabled: true,
          modalOpen: false,
          requestSignIn,
          requestAddFunds: vi.fn(),
          sessionVersion: 0,
        }}
      >
        <WalletConnectButton />
      </ParaAuthContext.Provider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));

    expect(requestSignIn).toHaveBeenCalledOnce();
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(wallet.connectAsync).not.toHaveBeenCalled();
  });

  it("keeps View as reachable beside Sign in while signed out", async () => {
    // It used to be the last entry of the sign-in menu; with that menu gone it
    // has to stand on its own next to the button.
    render(<WalletButton />);

    expect(await screen.findByRole("button", { name: "Sign in" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "View as…" })).toBeInTheDocument();
  });

  it("shows the connected address, native balance, network, and disconnect action", async () => {
    wallet.account.mockReturnValue({
      address: "0x1234567890abcdef1234567890abcdef12345678",
      chain: { id: 1, name: "Ethereum" },
      isConnected: true,
    });
    wallet.balance.mockReturnValue({
      data: { value: 1_234_567_000_000_000_000n, decimals: 18, symbol: "ETH" },
    });
    wallet.readContract.mockReturnValue({ data: 12_500_000n });

    render(<WalletButton />);

    const account = await screen.findByRole("button", { name: /0x1234.*5678/i });
    const nativeBalance = screen.getByText("1.2346 ETH");
    expect(account).toContainElement(nativeBalance);
    expect(nativeBalance).toHaveClass("whitespace-nowrap");
    fireEvent.click(account);

    expect(screen.getByText("Ethereum")).toBeVisible();
    expect(screen.getByText("12.5 USDC")).toBeVisible();
    fireEvent.click(screen.getByRole("menuitem", { name: "Disconnect" }));
    await waitFor(() => expect(wallet.disconnectAsync).toHaveBeenCalledOnce());
  });

  it("replaces the connected wallet with the viewed identity and returns through its menu", async () => {
    wallet.account.mockReturnValue({
      address: "0x1234567890abcdef1234567890abcdef12345678",
      chain: { name: "Ethereum" },
      isConnected: true,
    });
    setViewAs("0x2222222222222222222222222222222222222222" as Address);

    render(<WalletButton />);

    const viewed = await screen.findByRole("button", { name: /Viewing as 0x2222.*2222/i });
    expect(screen.queryByRole("button", { name: /0x1234.*5678/i })).not.toBeInTheDocument();

    fireEvent.click(viewed);
    fireEvent.click(screen.getByRole("menuitem", { name: "View as connected wallet" }));

    expect(await screen.findByRole("button", { name: /0x1234.*5678/i })).toBeVisible();
  });

  it("keeps a failed Para logout connected and offers a sanitized retry", async () => {
    const { ParaSessionLogoutError } = await import("@/providers/para-logout");
    wallet.account.mockReturnValue({
      address: "0x1234567890abcdef1234567890abcdef12345678",
      chain: { name: "Ethereum" },
      connector: { id: "para" },
      isConnected: true,
    });
    wallet.logoutParaSession.mockRejectedValueOnce(new ParaSessionLogoutError());

    render(<WalletButton />);
    fireEvent.click(await screen.findByRole("button", { name: /0x1234.*5678/i }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Disconnect" }));

    expect(
      await screen.findByText(
        "The embedded wallet could not sign out. Your session is still connected; try again.",
      ),
    ).toBeVisible();
    expect(screen.getByRole("menuitem", { name: "Disconnect" })).toBeVisible();
  });

  it("offers connection before chain switching when the user is disconnected", () => {
    wallet.chainId.mockReturnValue(1);
    wallet.jbChainId.mockReturnValue(10);

    render(<ButtonWithWallet>Submit transaction</ButtonWithWallet>);

    expect(screen.getByRole("button", { name: "Connect Wallet" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "Switch to OP Mainnet" })).not.toBeInTheDocument();
    expect(wallet.switchChainAsync).not.toHaveBeenCalled();
  });
});
