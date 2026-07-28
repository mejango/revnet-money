import { ChangeSplitRecipientsDialog } from "@/app/[slug]/owners/components/ChangeSplitRecipientsDialog";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

type ChainSplit = {
  chainId: number;
  projectId: bigint;
  rulesetId: bigint;
  splits: Array<{ percent: number; beneficiary: string }>;
  fallbackSplitCount: number | null;
};

const state = vi.hoisted(() => ({
  chainSplits: [] as unknown[],
  submitSplits: vi.fn(),
}));

vi.mock("@/hooks/useUserPermissions", () => ({
  useUserPermissions: () => ({ hasPermission: () => true, isLoading: false }),
}));

vi.mock("@/app/[slug]/owners/components/hooks/useChainSplits", () => ({
  useChainSplits: () => ({
    chainSplits: state.chainSplits,
    allRulesets: [],
    isLoading: false,
    refetch: vi.fn(),
  }),
}));

vi.mock("@/app/[slug]/owners/components/hooks/useSetSplitGroups", () => ({
  useSetSplitGroups: () => ({
    submitSplits: state.submitSplits,
    isSubmitting: false,
    isPending: false,
    isTxLoading: false,
    isSuccess: false,
  }),
}));

const BENEFICIARY = "0x000000000000000000000000000000000000dEaD";

function chain(overrides: Partial<ChainSplit> = {}): ChainSplit {
  return {
    chainId: 8453,
    projectId: 3n,
    rulesetId: 1_700_000_002n,
    splits: [{ percent: 1_000_000_000, beneficiary: BENEFICIARY }],
    fallbackSplitCount: 0,
    ...overrides,
  };
}

async function openDialog(stageIdx: number) {
  render(<ChangeSplitRecipientsDialog stageIdx={stageIdx} initialChainId={8453} />);
  fireEvent.click(screen.getByRole("button", { name: "Change split recipients" }));
  return screen.findByRole("dialog");
}

beforeEach(() => {
  state.chainSplits = [chain()];
  state.submitSplits = vi.fn();
});

describe("ChangeSplitRecipientsDialog stage labelling", () => {
  it("names the stage from its index, never a ruleset timestamp", async () => {
    const dialog = await openDialog(1);

    expect(dialog).toHaveTextContent("Stage 2");
    expect(dialog.textContent).not.toMatch(/Stage 1[0-9]{9}/);
  });

  it("loads the stage's recipients into the form", async () => {
    const dialog = await openDialog(1);

    expect(dialog.querySelectorAll('input[type="text"]')).toHaveLength(1);
    expect((dialog.querySelector('input[type="text"]') as HTMLInputElement).value).toBe(
      BENEFICIARY,
    );
  });
});

describe("ChangeSplitRecipientsDialog fallback-splits guard", () => {
  it("allows clearing every recipient when the fallback group is empty", async () => {
    const dialog = await openDialog(0);
    fireEvent.click(screen.getByRole("button", { name: /remove split/i }));

    await waitFor(() => expect(dialog).toHaveTextContent(/minted to the revnet's owner contract/i));
    expect(screen.getByRole("button", { name: "Save changes" })).not.toBeDisabled();
  });

  it("blocks clearing when the project's default splits would take over", async () => {
    state.chainSplits = [chain({ fallbackSplitCount: 3 })];
    const dialog = await openDialog(0);
    fireEvent.click(screen.getByRole("button", { name: /remove split/i }));

    await waitFor(() => expect(dialog).toHaveTextContent(/default splits \(3 recipients\)/i));
    expect(screen.getByRole("button", { name: "Save changes" })).toBeDisabled();
    expect(dialog).not.toHaveTextContent(/minted to the revnet's owner contract/i);
  });

  it("fails closed when the fallback group could not be read", async () => {
    state.chainSplits = [chain({ fallbackSplitCount: null })];
    const dialog = await openDialog(0);
    fireEvent.click(screen.getByRole("button", { name: /remove split/i }));

    await waitFor(() => expect(dialog).toHaveTextContent(/couldn't read/i));
    expect(screen.getByRole("button", { name: "Save changes" })).toBeDisabled();
  });

  it("keeps saving available when a populated recipient list is submitted", async () => {
    state.chainSplits = [chain({ fallbackSplitCount: 3 })];
    await openDialog(0);

    expect(screen.getByRole("button", { name: "Save changes" })).not.toBeDisabled();
  });
});
