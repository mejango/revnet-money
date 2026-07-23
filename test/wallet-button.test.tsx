import { ButtonWithWallet } from "@/components/ButtonWithWallet";
import { WalletButton, WalletConnectButton } from "@/components/WalletButton";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const wallet = vi.hoisted(() => ({
  account: vi.fn(),
  balance: vi.fn(),
  chainId: vi.fn(),
  connectAsync: vi.fn(),
  connectors: vi.fn(),
  disconnect: vi.fn(),
  jbChainId: vi.fn(),
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
  useDisconnect: () => ({ disconnect: wallet.disconnect, isPending: false }),
  useSwitchChain: () => ({
    isPending: false,
    switchChainAsync: wallet.switchChainAsync,
  }),
}));

vi.mock("@/lib/nana/project", () => ({ useJBChainId: wallet.jbChainId }));

describe("local wallet controls", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    wallet.account.mockReturnValue({
      address: undefined,
      chain: undefined,
      isConnected: false,
    });
    wallet.balance.mockReturnValue({ data: undefined });
    wallet.chainId.mockReturnValue(1);
    wallet.jbChainId.mockReturnValue(1);
    wallet.connectors.mockReturnValue([
      { id: "injected", name: "Browser Wallet", uid: "browser-wallet" },
    ]);
    wallet.connectAsync.mockResolvedValue(undefined);
    wallet.switchChainAsync.mockResolvedValue(undefined);
  });

  it("lets a disconnected user explicitly choose a discovered wallet", async () => {
    render(<WalletConnectButton />);

    fireEvent.click(screen.getByRole("button", { name: "Connect wallet" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Browser Wallet" }));

    await waitFor(() => {
      expect(wallet.connectAsync).toHaveBeenCalledWith({
        connector: expect.objectContaining({ uid: "browser-wallet" }),
      });
    });
  });

  it("prefers named EIP-6963 wallets and supports complete menu keyboard navigation", () => {
    wallet.connectors.mockReturnValue([
      { id: "injected", name: "Injected", uid: "injected" },
      { id: "io.metamask", name: "MetaMask", uid: "metamask" },
      { id: "com.example.wallet", name: "Example Wallet", uid: "example" },
    ]);
    render(<WalletConnectButton />);

    const trigger = screen.getByRole("button", { name: "Connect wallet" });
    fireEvent.keyDown(trigger, { key: "ArrowDown" });

    const first = screen.getByRole("menuitem", { name: "MetaMask" });
    const last = screen.getByRole("menuitem", { name: "Example Wallet" });
    expect(screen.queryByRole("menuitem", { name: "Injected" })).not.toBeInTheDocument();
    expect(first).toHaveFocus();

    fireEvent.keyDown(first, { key: "End" });
    expect(last).toHaveFocus();
    fireEvent.keyDown(last, { key: "Home" });
    expect(first).toHaveFocus();
    fireEvent.keyDown(first, { key: "ArrowUp" });
    expect(last).toHaveFocus();
    fireEvent.keyDown(last, { key: "ArrowDown" });
    expect(first).toHaveFocus();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("menu", { name: "Available wallets" })).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it("dismisses the wallet picker with Escape", () => {
    render(<WalletConnectButton />);

    fireEvent.click(screen.getByRole("button", { name: "Connect wallet" }));
    expect(screen.getByRole("menu", { name: "Available wallets" })).toBeVisible();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("menu", { name: "Available wallets" })).not.toBeInTheDocument();
  });

  it("shows the connected address, native balance, network, and disconnect action", async () => {
    wallet.account.mockReturnValue({
      address: "0x1234567890abcdef1234567890abcdef12345678",
      chain: { name: "Ethereum" },
      isConnected: true,
    });
    wallet.balance.mockReturnValue({
      data: { value: 1_234_567_000_000_000_000n, decimals: 18, symbol: "ETH" },
    });

    render(<WalletButton />);

    const account = await screen.findByRole("button", { name: /0x1234.*5678/i });
    expect(account).toHaveTextContent("1.2346 ETH");
    fireEvent.click(account);

    expect(screen.getByText("Ethereum")).toBeVisible();
    fireEvent.click(screen.getByRole("menuitem", { name: "Disconnect" }));
    expect(wallet.disconnect).toHaveBeenCalledOnce();
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
