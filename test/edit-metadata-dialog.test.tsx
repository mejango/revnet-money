import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  pinProjectMetadata: vi.fn(),
  refetch: vi.fn(),
  writeContractAsync: vi.fn(),
  switchChainAsync: vi.fn(),
  metadata: { data: undefined as unknown, isLoading: false } as {
    data: unknown;
    isLoading: boolean;
    refetch?: () => Promise<{ data?: unknown }>;
  },
}));

vi.mock("@/app/create/helpers/pinProjectMetaData", () => ({
  pinProjectMetadata: mocks.pinProjectMetadata,
}));

vi.mock("@/lib/nana/project", () => ({
  useJBProjectMetadataContext: () => ({ metadata: mocks.metadata }),
  useJBContractContext: () => ({
    contractAddress: () => `0x${"11".repeat(20)}`,
  }),
  useJBChainId: () => 11155111,
}));

vi.mock("@/components/ButtonWithWallet", () => ({
  ButtonWithWallet: ({ children, ...props }: { children: React.ReactNode }) => (
    <button {...props}>{children}</button>
  ),
}));

vi.mock("@/hooks/useReviewedWriteContract", () => ({
  submittedViaSafe: () => false,
  useWaitForTransactionReceipt: () => ({ isLoading: false, isSuccess: false }),
  useWriteContract: () => ({
    data: undefined,
    isPending: false,
    writeContractAsync: mocks.writeContractAsync,
  }),
}));

vi.mock("@/hooks/useReviewedRelayr", () => ({
  useGetRelayrTxQuote: () => ({ getRelayrTxQuote: vi.fn(), reset: vi.fn() }),
  useSendRelayrTx: () => ({ sendRelayrTx: vi.fn() }),
  waitForRelayrBundle: vi.fn(),
}));

vi.mock("@/hooks/useTokenA", () => ({
  useTokenA: () => ({ symbol: "ETH", decimals: 18 }),
}));

vi.mock("@/lib/wagmiConfig", () => ({ wagmiConfig: {} }));

vi.mock("wagmi/actions", () => ({
  getPublicClient: () => ({ estimateContractGas: vi.fn().mockResolvedValue(100_000n) }),
}));

vi.mock("wagmi", () => ({
  useAccount: () => ({ address: `0x${"22".repeat(20)}`, chainId: 11155111 }),
  useChainId: () => 11155111,
  useSwitchChain: () => ({ switchChainAsync: mocks.switchChainAsync }),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

import { EditMetadataDialog } from "@/app/[slug]/about/components/EditMetadataDialog";

const CURRENT_METADATA = {
  name: "Current name",
  description: "Current description",
  logoUri: "ipfs://logo",
  leagueID: "l-1",
  tags: ["defi"],
};

const PROJECTS = [{ chainId: 11155111, projectId: 4, token: `0x${"33".repeat(20)}` }] as any;

function renderDialog() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <EditMetadataDialog projects={PROJECTS} />
    </QueryClientProvider>,
  );
}

async function openDialog() {
  renderDialog();
  fireEvent.click(screen.getByRole("button", { name: /edit metadata/i }));
  await screen.findByText("Advanced");
}

function advancedTextarea() {
  return screen.getByLabelText(/custom properties/i) as HTMLTextAreaElement;
}

/**
 * The advanced editor mounts before the authoritative metadata resolves, so
 * every test that reads or edits it must wait for the prefill to land instead
 * of racing the re-initialisation that would otherwise clobber the edit.
 */
async function prefilledAdvancedTextarea() {
  await waitFor(() => expect(advancedTextarea().value).toContain("leagueID"));
  return advancedTextarea();
}

async function save() {
  fireEvent.click(screen.getByRole("button", { name: /review changes/i }));
}

async function pinnedMetadata() {
  await waitFor(() => expect(mocks.pinProjectMetadata).toHaveBeenCalled());
  return mocks.pinProjectMetadata.mock.calls[0][0] as Record<string, unknown>;
}

beforeEach(() => {
  mocks.pinProjectMetadata.mockReset();
  mocks.pinProjectMetadata.mockResolvedValue("QmTFCRTLGXQZgPjNMLxRHfnTQpsvSNvzEpx6NKCcXgSTuA");
  mocks.writeContractAsync.mockReset();
  mocks.writeContractAsync.mockResolvedValue(`0x${"ab".repeat(32)}`);
  mocks.refetch.mockReset();
  mocks.refetch.mockResolvedValue({ data: CURRENT_METADATA });
  mocks.metadata.data = CURRENT_METADATA;
  mocks.metadata.refetch = mocks.refetch;
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("EditMetadataDialog advanced custom properties", () => {
  it("collapses the advanced section and prefills the unmanaged keys as JSON", async () => {
    await openDialog();

    const details = screen.getByText("Advanced").closest("details") as HTMLDetailsElement;
    expect(details.open).toBe(false);

    const textarea = await prefilledAdvancedTextarea();
    expect(JSON.parse(textarea.value)).toEqual({ leagueID: "l-1", tags: ["defi"] });
  });

  it("shows loading and blocks saving until the metadata JSON resolves", async () => {
    let resolveMetadata: (value: { data?: unknown }) => void = () => undefined;
    mocks.refetch.mockReturnValue(
      new Promise<{ data?: unknown }>((resolve) => {
        resolveMetadata = resolve;
      }),
    );

    await openDialog();

    expect(screen.getByText(/loading current metadata/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /review changes/i })).toBeDisabled();
    expect(screen.queryByLabelText(/custom properties/i)).not.toBeInTheDocument();

    resolveMetadata({ data: CURRENT_METADATA });

    await waitFor(() =>
      expect(screen.getByRole("button", { name: /review changes/i })).not.toBeDisabled(),
    );
  });

  it("blocks saving on invalid JSON and shows an inline error", async () => {
    await openDialog();
    await prefilledAdvancedTextarea();

    fireEvent.change(advancedTextarea(), { target: { value: "{ oops" } });
    await save();

    await waitFor(() => expect(screen.getByText(/invalid json/i)).toBeInTheDocument());
    expect(mocks.pinProjectMetadata).not.toHaveBeenCalled();
  });

  it("rejects JSON that is not an object", async () => {
    await openDialog();
    await prefilledAdvancedTextarea();

    fireEvent.change(advancedTextarea(), { target: { value: "[1,2]" } });
    await save();

    await waitFor(() =>
      expect(screen.getByText(/custom properties must be a json object/i)).toBeInTheDocument(),
    );
    expect(mocks.pinProjectMetadata).not.toHaveBeenCalled();
  });

  it("keeps custom properties when the advanced editor is untouched", async () => {
    await openDialog();
    await prefilledAdvancedTextarea();

    await save();

    const pinned = await pinnedMetadata();
    expect(pinned.leagueID).toBe("l-1");
    expect(pinned.tags).toEqual(["defi"]);
    expect(pinned.name).toBe("Current name");

    // Nothing is written until the confirm dialog's action is pressed.
    expect(mocks.writeContractAsync).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByRole("button", { name: /^save changes$/i }));
    await waitFor(() => expect(mocks.writeContractAsync).toHaveBeenCalledTimes(1));
    expect(mocks.writeContractAsync.mock.calls[0][0]).toMatchObject({
      functionName: "setUriOf",
      chainId: 11155111,
    });
  });

  it("edits, adds, and deletes custom properties", async () => {
    await openDialog();
    await prefilledAdvancedTextarea();

    fireEvent.change(advancedTextarea(), {
      target: { value: JSON.stringify({ leagueID: "l-2", newKey: { deep: true } }) },
    });
    await save();

    const pinned = await pinnedMetadata();
    expect(pinned.leagueID).toBe("l-2");
    expect(pinned.newKey).toEqual({ deep: true });
    expect("tags" in pinned).toBe(false);
  });

  it("clears every custom property when the prefill is emptied", async () => {
    await openDialog();
    await prefilledAdvancedTextarea();

    fireEvent.change(advancedTextarea(), { target: { value: "" } });
    await save();

    const pinned = await pinnedMetadata();
    expect("leagueID" in pinned).toBe(false);
    expect("tags" in pinned).toBe(false);
    expect(pinned.name).toBe("Current name");
  });

  it("lets the form fields win on a managed-key collision and notes it", async () => {
    await openDialog();
    await prefilledAdvancedTextarea();

    fireEvent.change(advancedTextarea(), {
      target: { value: JSON.stringify({ name: "Custom name", leagueID: "l-1" }) },
    });

    await waitFor(() => expect(screen.getByText(/ignored on save/i)).toBeInTheDocument());
    expect(screen.getByText(/ignored on save/i).textContent).toContain("name");

    await save();

    const pinned = await pinnedMetadata();
    expect(pinned.name).toBe("Current name");
    expect(pinned.leagueID).toBe("l-1");
  });
});
