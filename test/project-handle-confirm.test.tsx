import { ProjectHandleEditor } from "@/app/[slug]/components/v6/operator/ProjectHandleEditor";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import type { Hex } from "viem";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { expectEveryWayOutRefused } from "./support/confirm";

const RESOLVER = "0x4444444444444444444444444444444444444444";
const HASH = `0x${"cd".repeat(32)}` as Hex;

const mocks = vi.hoisted(() => ({
  write: vi.fn(),
  requireOnchain: vi.fn(),
  /** The block the editor pins its ENS reads to, its first read after Confirm. */
  blockNumber: vi.fn(),
  /** What the authority query shows; the operator Safe is missing on Ethereum when set. */
  authority: undefined as unknown,
  /** The live operator check, the first read after the deployment's Confirm. */
  liveOperator: vi.fn(),
  /** The live authority read: missing on Ethereum before the deployment, ready after it. */
  liveAuthority: vi.fn(),
  prepareDeployment: vi.fn(),
}));

// The operator, authority and ENS reads need bendystraw and two chains' RPC;
// each query answers with a verified operator and a name that needs its record.
vi.mock("@tanstack/react-query", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-query")>();
  const queryClient = new actual.QueryClient();
  return {
    ...actual,
    useQueryClient: () => queryClient,
    useQuery: ({ queryKey }: { queryKey: unknown[] }) => {
      const data: Record<string, unknown> = {
        "v6-project-handle-operator": "0x2222222222222222222222222222222222222222",
        "v6-project-handle-authority": mocks.authority ?? {
          allowed: true,
          status: "valid",
          source: { kind: "eoa" },
        },
        "v6-project-handle-current": null,
        "v6-project-handle-setup": {
          resolver: "0x4444444444444444444444444444444444444444",
          textRecord: null,
          verifiedHandle: null,
          ensController: "0x2222222222222222222222222222222222222222",
        },
      };
      return {
        data: data[String(queryKey[0])],
        isLoading: false,
        isError: false,
        refetch: vi.fn(),
      };
    },
  };
});
vi.mock("@/hooks/useCompleteBendystrawLists", () => ({
  useCompleteProjectPermissions: () => ({ data: [], isLoading: false }),
}));
vi.mock("@/hooks/useReviewedWriteContract", () => ({
  useWriteContract: () => ({ writeContractAsync: mocks.write }),
  requireOnchainExecution: mocks.requireOnchain,
  isSafeProposalPendingError: (error: unknown) =>
    error instanceof Error && error.name === "SafeProposalPendingError",
}));
vi.mock("@/lib/projectHandles", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/projectHandles")>()),
  readExactEnsText: async () => null,
  readExactProjectHandle: async () => null,
}));
// Ethereum's client: the name's resolver and its registry controller.
vi.mock("@/app/[slug]/components/v6/operator/operatorLib", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/app/[slug]/components/v6/operator/operatorLib")>()),
  isLiveRevnetOperator: mocks.liveOperator,
  publicClientFor: () => ({
    getBlockNumber: mocks.blockNumber,
    readContract: async ({ functionName }: { functionName: string }) =>
      functionName === "resolver"
        ? "0x4444444444444444444444444444444444444444"
        : "0x2222222222222222222222222222222222222222",
  }),
}));
// The operator Safe's authority on both chains, and its same-address deployment on Ethereum.
vi.mock("@/lib/handle-authority", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/handle-authority")>()),
  readHandleAuthority: mocks.liveAuthority,
}));
vi.mock("@bananapus/nana-sdk-core/safe", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@bananapus/nana-sdk-core/safe")>()),
  prepareSafeSameAddressDeployment: mocks.prepareDeployment,
  validateSafeCreationForCurrentPolicy: () => ({ valid: true }),
}));
vi.mock("@/lib/waitForReceipt", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/waitForReceipt")>()),
  waitForReceiptWithRetry: async () => ({ status: "success" }),
}));
vi.mock("@/lib/wagmiConfig", () => ({ wagmiConfig: {} }));
vi.mock("wagmi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("wagmi")>()),
  useAccount: () => ({ address: "0x2222222222222222222222222222222222222222" }),
}));
vi.mock("@/components/ui/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@/components/ButtonWithWallet", () => ({
  ButtonWithWallet: ({
    children,
    loading: _loading,
    targetChainId: _chain,
    ...props
  }: {
    children: ReactNode;
    loading?: boolean;
    targetChainId?: number;
  }) => <button {...props}>{children}</button>,
}));

const FACTORY = "0x5555555555555555555555555555555555555555";
/** The operator is a one-owner Safe on Base, the connected wallet, not yet on Ethereum. */
const MISSING_ON_ETHEREUM = {
  allowed: false,
  status: "missing-mainnet-safe",
  source: {
    kind: "safe",
    owners: ["0x2222222222222222222222222222222222222222"],
    threshold: 1,
  },
  // Base's record of how the Safe was made, which the deployment replays.
  creation: { factory: FACTORY, saltNonce: 7n },
};
const READY_ON_ETHEREUM = { ...MISSING_ON_ETHEREUM, allowed: true, status: "valid-safe" };

/** Opens the editor for a Base revnet whose operator Safe is missing on Ethereum. */
async function openDeployConfirm() {
  mocks.authority = MISSING_ON_ETHEREUM;
  render(<ProjectHandleEditor project={{ chainId: 8453, projectId: 4 }} />);
  fireEvent.click(screen.getByRole("button", { name: "Set project handle" }));
  fireEvent.click(await screen.findByRole("button", { name: "Deploy operator Safe on Ethereum" }));
  return (await screen.findByRole("dialog", {
    name: "Confirm Safe deployment",
  })) as HTMLDialogElement;
}

/** Opens the editor for art.eth and its ENS record step's confirm. */
async function openConfirm() {
  render(<ProjectHandleEditor project={{ chainId: 1, projectId: 4 }} />);
  fireEvent.click(screen.getByRole("button", { name: "Set project handle" }));
  fireEvent.change(await screen.findByLabelText("Your .eth name"), {
    target: { value: "art.eth" },
  });
  fireEvent.click(await screen.findByRole("button", { name: "Set art.eth record" }));
  return (await screen.findByRole("dialog", { name: "Confirm ENS record" })) as HTMLDialogElement;
}

beforeEach(() => {
  mocks.authority = undefined;
  mocks.liveOperator.mockReset().mockResolvedValue(true);
  mocks.liveAuthority
    .mockReset()
    .mockResolvedValueOnce(MISSING_ON_ETHEREUM)
    .mockResolvedValue(READY_ON_ETHEREUM);
  mocks.prepareDeployment.mockReset().mockResolvedValue({
    valid: true,
    call: {
      target: FACTORY,
      abi: [],
      functionName: "createProxyWithNonce",
      args: ["0x", "0x", 7n],
    },
  });
  mocks.blockNumber.mockResolvedValue(24_000_000n);
  mocks.write.mockResolvedValue(HASH);
  mocks.requireOnchain.mockImplementation(() => {
    throw Object.assign(new Error("Set ENS project record was proposed to Safe."), {
      name: "SafeProposalPendingError",
    });
  });
});

describe("project handle confirm", () => {
  it("goes back to the editor with Cancel, and sends nothing", async () => {
    const confirm = await openConfirm();

    fireEvent.click(within(confirm).getByRole("button", { name: "Cancel" }));

    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Confirm ENS record" })).toBeNull(),
    );
    expect(screen.getByRole("dialog", { name: "Set project handle" })).toBeInTheDocument();
    expect(mocks.blockNumber).not.toHaveBeenCalled();
    expect(mocks.write).not.toHaveBeenCalled();
  });

  it("wallet-action:project-handle refuses every way out from Confirm through the resolver check before the prompt", async () => {
    let answer!: () => void;
    mocks.blockNumber.mockReturnValue(
      new Promise((resolve) => {
        answer = () => resolve(24_000_000n);
      }),
    );
    const confirm = await openConfirm();
    fireEvent.click(within(confirm).getByRole("button", { name: "Set art.eth record" }));
    await waitFor(() => expect(mocks.blockNumber).toHaveBeenCalledOnce());

    const cancel = within(confirm).getByRole("button", { name: "Cancel" });
    const close = within(confirm).getByRole("button", { name: "Close" });
    expect(cancel).toBeDisabled();
    expect(close).toBeDisabled();
    fireEvent.click(cancel);
    fireEvent.click(close);
    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.pointerDown(confirm);
    expect(screen.getByRole("dialog", { name: "Confirm ENS record" })).toBe(confirm);
    expect(mocks.write).not.toHaveBeenCalled();

    await act(async () => answer());
    await waitFor(() => expect(mocks.write).toHaveBeenCalledOnce());
    expect(mocks.write.mock.calls[0][0]).toMatchObject({
      chainId: 1,
      address: RESOLVER,
      functionName: "setText",
    });
  });

  it("ends on Done when the record went to the Safe as a proposal", async () => {
    const confirm = await openConfirm();
    fireEvent.click(within(confirm).getByRole("button", { name: "Set art.eth record" }));

    const done = await within(confirm).findByRole("button", { name: "Done" });
    expect(confirm).toHaveTextContent("Set ENS project record was proposed to Safe.");
    expect(within(confirm).queryByRole("button", { name: "Set art.eth record" })).toBeNull();
    fireEvent.click(done);

    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Confirm ENS record" })).toBeNull(),
    );
    const editor = screen.getByRole("dialog", { name: "Set project handle" });
    expect(editor).toHaveTextContent("Set ENS project record was proposed to Safe.");
    expect(within(editor).queryByRole("alert")).toBeNull();
    expect(mocks.write).toHaveBeenCalledOnce();
  });
});

describe("operator Safe deployment confirm", () => {
  it("goes back to the editor with Cancel, and deploys nothing", async () => {
    const confirm = await openDeployConfirm();

    fireEvent.click(within(confirm).getByRole("button", { name: "Cancel" }));

    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Confirm Safe deployment" })).toBeNull(),
    );
    expect(screen.getByRole("dialog", { name: "Set project handle" })).toBeInTheDocument();
    expect(mocks.liveOperator).not.toHaveBeenCalled();
    expect(mocks.write).not.toHaveBeenCalled();
  });

  it("wallet-action:project-handle refuses every way out from Confirm through the live checks, then closes once deployed", async () => {
    mocks.requireOnchain.mockImplementation(() => undefined);
    let answer!: () => void;
    mocks.liveOperator.mockReturnValue(new Promise((resolve) => (answer = () => resolve(true))));
    const confirm = await openDeployConfirm();
    const action = within(confirm).getByRole("button", {
      name: "Deploy operator Safe on Ethereum",
    });
    fireEvent.click(action);
    await waitFor(() => expect(mocks.liveOperator).toHaveBeenCalledOnce());

    expectEveryWayOutRefused(confirm);
    expect(action).toBeDisabled();
    expect(mocks.write).not.toHaveBeenCalled();

    await act(async () => answer());
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Confirm Safe deployment" })).toBeNull(),
    );
    expect(mocks.write).toHaveBeenCalledOnce();
    expect(mocks.write.mock.calls[0][0]).toMatchObject({
      chainId: 1,
      address: FACTORY,
      functionName: "createProxyWithNonce",
    });
    expect(screen.getByRole("dialog", { name: "Set project handle" })).toHaveTextContent(
      "The operator Safe is ready on Ethereum.",
    );
  });

  it("ends on Done when the deployment went to the Safe as a proposal", async () => {
    mocks.requireOnchain.mockImplementation(() => {
      throw Object.assign(new Error("Deploy operator Safe on Ethereum was proposed to Safe."), {
        name: "SafeProposalPendingError",
      });
    });
    const confirm = await openDeployConfirm();
    fireEvent.click(
      within(confirm).getByRole("button", { name: "Deploy operator Safe on Ethereum" }),
    );

    const done = await within(confirm).findByRole("button", { name: "Done" });
    expect(confirm).toHaveTextContent("Deploy operator Safe on Ethereum was proposed to Safe.");
    fireEvent.click(done);

    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Confirm Safe deployment" })).toBeNull(),
    );
    const editor = screen.getByRole("dialog", { name: "Set project handle" });
    expect(editor).toHaveTextContent("Deploy operator Safe on Ethereum was proposed to Safe.");
    expect(within(editor).queryByRole("alert")).toBeNull();
    expect(mocks.write).toHaveBeenCalledOnce();
  });
});
