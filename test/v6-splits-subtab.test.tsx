import { V6SplitsSubtab } from "@/app/[slug]/components/v6/owners/V6SplitsSubtab";
import type { ProjectItem } from "@/app/[slug]/components/v6/shared";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const dialogProps = vi.hoisted(() => ({ last: undefined as Record<string, unknown> | undefined }));
const reads = vi.hoisted(() => ({
  splits: [] as Array<{ percent: number; beneficiary: string; hook: string }>,
  // reservedPercent lives in ruleset metadata bits 4-19, out of 10_000.
  reservedPercentBps: [250n, 40n],
}));

vi.mock("@/lib/nana/project", () => ({
  useJBContractContext: () => ({
    projectId: 3n,
    contractAddress: () => "0x0000000000000000000000000000000000000001",
  }),
  useJBChainId: () => 8453,
  useJBTokenContext: () => ({ token: { data: { symbol: "REV", decimals: 18 } } }),
}));

vi.mock("@/lib/bendystraw", () => ({
  useBendystrawQuery: () => ({ data: undefined, isLoading: false }),
  ProjectOperatorOperation: "ProjectOperatorOperation",
}));

vi.mock("@/hooks/useAllRulesetsByChain", () => ({
  useAllRulesetsByChain: () => ({
    data: new Map([
      [
        8453,
        [
          {
            id: 1_700_000_001,
            start: 1_700_000_001,
            metadata: reads.reservedPercentBps[0] << 4n,
          },
          {
            id: 1_700_000_002,
            start: 1_700_000_002,
            metadata: reads.reservedPercentBps[1] << 4n,
          },
        ],
      ],
    ]),
    isLoading: false,
  }),
}));

vi.mock("@/hooks/useCompleteBendystrawLists", () => ({
  useCompleteProjectPermissions: () => ({ data: [], isLoading: false }),
}));

vi.mock("@/components/ChainLogo", () => ({ ChainLogo: () => null }));
vi.mock("@/components/EthereumAddress", () => ({
  EthereumAddress: ({ address }: { address: string }) => <span>{address}</span>,
}));
vi.mock("@/app/[slug]/owners/components/DistributeReservedTokensButton", () => ({
  DistributeReservedTokensButton: () => null,
}));
vi.mock("@/app/[slug]/owners/components/ChangeSplitRecipientsDialog", () => ({
  ChangeSplitRecipientsDialog: (props: Record<string, unknown>) => {
    dialogProps.last = props;
    return <div data-testid="change-splits-dialog" />;
  },
}));

vi.mock("wagmi", () => ({
  useReadContracts: ({ contracts }: { contracts: Array<{ functionName: string }> }) => {
    if (contracts.length === 0) return { data: undefined, isLoading: false };
    if (contracts[0].functionName === "allOf") {
      // JBRulesets.allOf returns newest-first; the component reverses it.
      return {
        data: [
          {
            status: "success",
            result: [
              {
                id: 1_700_000_002,
                start: 1_700_000_002,
                metadata: reads.reservedPercentBps[1] << 4n,
              },
              {
                id: 1_700_000_001,
                start: 1_700_000_001,
                metadata: reads.reservedPercentBps[0] << 4n,
              },
            ],
          },
        ],
        isLoading: false,
      };
    }
    return {
      data: [
        { status: "success", result: reads.splits },
        { status: "success", result: 0n },
      ],
      isLoading: false,
    };
  },
}));

const projects = [{ chainId: 8453, projectId: 3, token: null }] as unknown as ProjectItem[];

beforeEach(() => {
  dialogProps.last = undefined;
  reads.splits = [
    {
      percent: 1_000_000_000,
      beneficiary: "0x000000000000000000000000000000000000dEaD",
      hook: "0x0000000000000000000000000000000000000000",
    },
  ];
  reads.reservedPercentBps = [250n, 40n];
});

describe("V6SplitsSubtab stage selection", () => {
  it("hands the change dialog the stage INDEX, not the ruleset id", () => {
    render(<V6SplitsSubtab projects={projects} />);

    expect(dialogProps.last?.stageIdx).toBe(0);

    fireEvent.click(screen.getByRole("button", { name: /^Stage 2/ }));
    expect(dialogProps.last?.stageIdx).toBe(1);
    expect(dialogProps.last).not.toHaveProperty("stageId");
  });
});

describe("V6SplitsSubtab split percentages", () => {
  it("keeps a fractional split limit intact", () => {
    render(<V6SplitsSubtab projects={projects} />);

    expect(screen.getByText(/The split limit for this stage is/)).toHaveTextContent("2.5%");
    // 100% of a 2.5% limit is 2.5% of issuance — not the 3% a rounded limit gives.
    expect(screen.getAllByRole("cell")[1]).toHaveTextContent("2.5%");
  });

  it("does not round a sub-1% split limit down to zero", () => {
    render(<V6SplitsSubtab projects={projects} />);
    fireEvent.click(screen.getByRole("button", { name: /^Stage 2/ }));

    expect(screen.getByText(/The split limit for this stage is/)).toHaveTextContent("0.4%");
    expect(screen.getAllByRole("cell")[1]).toHaveTextContent("0.4%");
  });
});
