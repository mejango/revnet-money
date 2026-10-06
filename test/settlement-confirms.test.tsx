import { GossipCard } from "@/app/[slug]/components/v6/owners/settlement/GossipCard";
import { QueuedMovementsCard } from "@/app/[slug]/components/v6/owners/settlement/QueuedMovementsCard";
import type { JBChainId } from "@bananapus/nana-sdk-core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import type { Hex } from "viem";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { expectEveryWayOutRefused } from "./support/confirm";

// wallet-action:settlement-sync
// wallet-action:queued-movements

const SUCKER = "0x3333333333333333333333333333333333333333";
const PEER_SUCKER = "0x4444444444444444444444444444444444444444";
const TOKEN = "0x000000000000000000000000000000000000EEEe";
const HASH = `0x${"cd".repeat(32)}` as Hex;

const mocks = vi.hoisted(() => ({
  simulate: vi.fn(),
  write: vi.fn(),
  rows: [] as unknown[],
}));

vi.mock("wagmi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("wagmi")>()),
  useAccount: () => ({ address: "0x1111111111111111111111111111111111111111", isConnected: true }),
  usePublicClient: () => ({ simulateContract: mocks.simulate }),
}));
vi.mock("@/components/ButtonWithWallet", () => ({
  ButtonWithWallet: ({
    children,
    loading: _loading,
    targetChainId: _chain,
    forceChildren: _force,
    ...props
  }: {
    children: ReactNode;
    loading?: boolean;
    targetChainId?: unknown;
    forceChildren?: boolean;
  }) => <button {...props}>{children}</button>,
}));
vi.mock("@/components/ChainLogo", () => ({ ChainLogo: () => null }));
vi.mock("@/components/EthereumAddress", () => ({ EthereumAddress: () => null }));
vi.mock("@/components/ui/use-toast", () => ({ toast: vi.fn() }));
vi.mock("@/hooks/useReviewedWriteContract", () => ({
  submittedViaSafe: () => false,
  useWriteContract: () => ({ writeContractAsync: mocks.write }),
}));
vi.mock("@/lib/waitForReceipt", () => ({
  waitForReceiptWithRetry: async () => ({ status: "success" }),
}));
// Base's view of Optimism is stale, and Optimism's sucker can re-push it.
vi.mock("@/app/[slug]/components/v6/owners/settlement/lib", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/app/[slug]/components/v6/owners/settlement/lib")>()),
  fetchGossip: async () => [
    {
      chainId: 8453,
      peers: [
        {
          peerChainId: 10,
          supply: 10n ** 18n,
          balances: [],
          snapshot: 1_700_000_000,
          level: "danger",
          label: "Stale",
          syncSucker: PEER_SUCKER,
        },
      ],
    },
  ],
  findSyncValue: async () => 10n ** 15n,
  tokenSymbolOf: async () => "ETH",
}));
vi.mock("@/lib/v6/suckerProofs", () => ({
  fetchV6BridgeRows: async () => mocks.rows,
  findToRemoteValue: async () => 10n ** 15n,
  buildV6ClaimTxFromRow: () => ({
    chainId: 10,
    address: PEER_SUCKER,
    abi: [],
    functionName: "claim",
    args: [],
  }),
}));

const CHAINS = [
  { chainId: 8453 as JBChainId, projectId: 4n },
  { chainId: 10 as JBChainId, projectId: 4n },
];

function bridgeRow(status: "claimable" | "pending") {
  return {
    createdAt: 1_700_000_000,
    chainId: 8453,
    peerChainId: 10,
    beneficiary: "0x1111111111111111111111111111111111111111",
    beneficiary32: `0x${"00".repeat(32)}`,
    projectTokenCount: 10n ** 18n,
    terminalTokenAmount: 10n ** 15n,
    status,
    index: 0,
    sourceSucker: SUCKER,
    peerSucker: PEER_SUCKER,
    metadata: "0x",
    proof: null,
    canExecute: status === "pending",
    token: TOKEN,
    remoteToken: TOKEN,
    tokenDecimals: 18,
    infra: "optimism",
  };
}

function renderWithQueries(node: ReactNode) {
  render(<QueryClientProvider client={new QueryClient()}>{node}</QueryClientProvider>);
}

/** Holds the confirm's simulation until the returned function is called. */
function holdSimulation() {
  let answer!: () => void;
  const held = new Promise<void>((resolve) => (answer = resolve));
  mocks.simulate.mockImplementation(async () => {
    await held;
    return {};
  });
  return () => act(async () => answer());
}

beforeEach(() => {
  mocks.simulate.mockReset().mockResolvedValue({});
  mocks.write.mockReset().mockResolvedValue(HASH);
  mocks.rows = [];
});

describe.each([
  {
    name: "sync",
    title: "Confirm sync",
    action: "Sync",
    open: async () => {
      renderWithQueries(<GossipCard chains={CHAINS} />);
      fireEvent.click(await screen.findByRole("button", { name: "Sync" }));
    },
  },
  {
    name: "claim",
    title: "Confirm claim",
    action: "Claim",
    open: async () => {
      mocks.rows = [bridgeRow("claimable")];
      renderWithQueries(<QueuedMovementsCard chains={CHAINS} tokenSymbol="ART" />);
      fireEvent.click(await screen.findByRole("button", { name: "Claim" }));
    },
  },
  {
    name: "execute",
    title: "Confirm execution",
    action: "Execute",
    open: async () => {
      mocks.rows = [bridgeRow("pending")];
      renderWithQueries(<QueuedMovementsCard chains={CHAINS} tokenSymbol="ART" />);
      fireEvent.click(await screen.findByRole("button", { name: "Execute" }));
    },
  },
])("the $name confirm", ({ title, action, open }) => {
  async function confirmOpen() {
    await open();
    const confirm = await screen.findByRole("dialog", { name: title });
    await waitFor(() =>
      expect(within(confirm).getByRole("button", { name: action })).toBeEnabled(),
    );
    return confirm;
  }

  it("goes back with Cancel, and sends nothing", async () => {
    const confirm = await confirmOpen();

    fireEvent.click(within(confirm).getByRole("button", { name: "Cancel" }));

    await waitFor(() => expect(screen.queryByRole("dialog", { name: title })).toBeNull());
    expect(mocks.simulate).not.toHaveBeenCalled();
    expect(mocks.write).not.toHaveBeenCalled();
  });

  it("refuses every way out from Confirm through the simulation before the wallet prompt", async () => {
    const release = holdSimulation();
    const confirm = await confirmOpen();
    fireEvent.click(within(confirm).getByRole("button", { name: action }));
    await waitFor(() => expect(mocks.simulate).toHaveBeenCalledOnce());

    expectEveryWayOutRefused(confirm);
    expect(mocks.write).not.toHaveBeenCalled();

    await release();
    await waitFor(() => expect(mocks.write).toHaveBeenCalledOnce());
    await waitFor(() => expect(screen.queryByRole("dialog", { name: title })).toBeNull());
  });
});
