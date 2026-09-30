import { ButtonWithWallet } from "@/components/ButtonWithWallet";
import { WalletButton, WalletConnectButton } from "@/components/WalletButton";
import { clearViewAs, setViewAs } from "@/lib/view-as";
import { ParaAuthContext } from "@/providers/ParaAuthContext";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
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
  project: vi.fn(),
  readContract: vi.fn(),
  reset: vi.fn(),
  suckerBalances: vi.fn(),
  suckers: vi.fn(),
  switchChainAsync: vi.fn(),
  tokenContext: vi.fn(),
}));

/** Whether Para reports a live session when Disconnect asks. */
const paraSessionLive = vi.hoisted(() => ({ value: false }));

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
  useConfig: () => ({}),
  useConnectors: wallet.connectors,
  useDisconnect: () => ({ disconnectAsync: wallet.disconnectAsync, isPending: false }),
  useReadContract: wallet.readContract,
  useSwitchChain: () => ({
    isPending: false,
    switchChainAsync: wallet.switchChainAsync,
  }),
}));

vi.mock("@wagmi/core", () => ({
  // No live connections in these tests: the fallback path only runs when wagmi's own
  // disconnect refuses, which none of them exercise.
  getConnections: () => [],
}));

vi.mock("@/providers/para-config", () => ({
  // Disconnect asks whether a Para session exists before deciding how to end it.
  getParaClient: () => ({ isFullyLoggedIn: async () => paraSessionLive.value }),
  PARA_APP: { appName: "Revnet" },
}));

vi.mock("@/lib/nana/project", () => ({
  useJBChainId: wallet.jbChainId,
  useJBProject: wallet.project,
  useJBTokenContext: wallet.tokenContext,
}));
vi.mock("@/lib/nana/suckers", () => ({
  useSuckers: wallet.suckers,
  useSuckersUserTokenBalance: wallet.suckerBalances,
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
    wallet.project.mockReturnValue(undefined);
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

  it("leaves View as to the sign-in sheet, not the header", async () => {
    // Impersonation moved into the sheet, so the header offers one thing.
    render(<WalletButton />);

    expect(await screen.findByRole("button", { name: "Sign in" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "View as…" })).not.toBeInTheDocument();
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
    // The trigger says who is signed in and nothing else: balances belong in the menu, where
    // every token and the chains it spans are listed rather than gestured at.
    expect(account).not.toHaveTextContent("1.2346 ETH");
    fireEvent.click(account);

    expect(screen.getByText("1.2346 ETH")).toBeVisible();
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
    paraSessionLive.value = true;
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
    paraSessionLive.value = false;
  });

  it("ends a Para session whatever the connector calls itself", async () => {
    // The old check keyed on `connector.id === "para"`. An email sign-in whose connector reads
    // as anything else took the plain Wagmi path, failed, and left the visitor signed in with
    // "the wallet could not disconnect" and no way out.
    paraSessionLive.value = true;
    wallet.account.mockReturnValue({
      address: "0x1234567890abcdef1234567890abcdef12345678",
      chain: { name: "Ethereum" },
      connector: { id: "injected" },
      isConnected: true,
    });

    render(<WalletButton />);
    fireEvent.click(await screen.findByRole("button", { name: /0x1234.*5678/i }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Disconnect" }));

    await waitFor(() => expect(wallet.logoutParaSession).toHaveBeenCalled());
    paraSessionLive.value = false;
  });

  describe("the wallet balance amounts", () => {
    const address = "0x1234567890abcdef1234567890abcdef12345678";

    async function openMenu(ether: bigint, usdc?: bigint) {
      wallet.account.mockReturnValue({
        address,
        chain: { id: 1, name: "Ethereum" },
        isConnected: true,
      });
      wallet.balance.mockReturnValue({ data: { value: ether, decimals: 18, symbol: "ETH" } });
      wallet.readContract.mockReturnValue({ data: usdc });
      render(<WalletButton />);
      fireEvent.click(await screen.findByRole("button", { name: /0x1234.*5678/i }));
    }

    it.each([
      ["nothing", "0", 0n],
      ["dust, to its first significant figure", "0.00003", 30_000_000_000_000n],
      ["a tiny amount, cut to its first significant figure", "0.00001", 12_300_000_000_000n],
      ["a single wei", "0.000000000000000001", 1n],
      ["the smallest amount that is not dust", "0.0001", 10n ** 14n],
      ["a whole amount", "1", 10n ** 18n],
      ["more decimals than four, rounded", "1.2346", 1_234_567_890_000_000_000n],
      ["a decimal tie in the fifth place, rounded up", "0.0002", 150_000_000_000_000n],
      [
        "a decimal tie in the fifth place of a larger amount, rounded up",
        "12.3457",
        12_345_650_000_000_000_000n,
      ],
      ["thousands, grouped", "1,234.5", 1_234_500_000_000_000_000_000n],
      ["millions, grouped", "1,000,000", 10n ** 24n],
    ])("reads %s as %s ETH", async (_name, expected, wei) => {
      await openMenu(wei);

      expect(screen.getByText(`${expected} ETH`)).toBeVisible();
    });

    it("reads the same in every locale", async () => {
      const toLocaleString = Number.prototype.toLocaleString;
      vi.spyOn(Number.prototype, "toLocaleString").mockImplementation(function (
        this: number,
        locales?: never,
        options?: never,
      ) {
        return toLocaleString.call(this, locales ?? "de-DE", options);
      } as never);

      await openMenu(1_234_500_000_000_000_000_000n, 12_500_000n);

      expect(screen.getByText("1,234.5 ETH")).toBeVisible();
      expect(screen.getByText("12.5 USDC")).toBeVisible();
    });
  });

  describe("the project token balance", () => {
    const address = "0x1234567890abcdef1234567890abcdef12345678";

    // A project is in view, with no project chains to read, so the ETH and USDC rows make no request and the token row is the one under test.
    function signedInOnAProject(...perChain: bigint[]) {
      wallet.account.mockReturnValue({
        address,
        chain: { id: 1, name: "Ethereum" },
        isConnected: true,
      });
      wallet.project.mockReturnValue({});
      wallet.suckers.mockReturnValue({ data: [], isLoading: false });
      wallet.suckerBalances.mockReturnValue({
        data: perChain.map((value) => ({ balance: { value } })),
        isLoading: false,
      });
      wallet.tokenContext.mockReturnValue({
        token: { isLoading: false, data: { symbol: "$REV" } },
      });
    }

    async function openMenu() {
      render(
        <QueryClientProvider client={new QueryClient()}>
          <WalletButton />
        </QueryClientProvider>,
      );
      fireEvent.click(await screen.findByRole("button", { name: /0x1234.*5678/i }));
    }

    it.each([
      ["nothing", "0", [0n]],
      ["dust, to its first significant figure", "0.00003", [30_000_000_000_000n]],
      [
        "thousands, grouped, summed across chains",
        "1,234.5",
        [1_000_000_000_000_000_000_000n, 234_500_000_000_000_000_000n],
      ],
    ])("reads %s as %s REV", async (_name, expected, perChain) => {
      signedInOnAProject(...perChain);
      await openMenu();

      expect(screen.getByText(`${expected} REV`)).toBeVisible();
    });

    it("says it is loading while the balances are", async () => {
      signedInOnAProject();
      wallet.suckerBalances.mockReturnValue({ data: undefined, isLoading: true });
      await openMenu();

      expect(screen.getByText("Loading…")).toBeVisible();
    });
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
