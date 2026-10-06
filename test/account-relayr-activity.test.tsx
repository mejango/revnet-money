import { AccountActivity } from "@/app/account/[id]/components/AccountActivity";
import type { TransactionActivity } from "@/lib/transaction-activity";
import { erc2771ForwarderAbi, jbContractAddress } from "@bananapus/nana-sdk-core";
import { fireEvent, render, screen } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import { encodeFunctionData } from "viem";
import { beforeEach, describe, expect, it, vi } from "vitest";

const ACCOUNT = "0x1111111111111111111111111111111111111111";
const HASH = `0x${"aa".repeat(32)}` as const;
const mocks = vi.hoisted(() => ({
  activities: [] as TransactionActivity[],
  indexed: [] as { id: string; txHash: string; chainId: number }[],
  waitForRelayrBundle: vi.fn(async () => undefined),
  checkRelayrSession: vi.fn(async () => undefined),
  discardRelayrSession: vi.fn(),
  dismiss: vi.fn(),
}));

vi.mock("@/hooks/useReviewedRelayr", () => ({
  waitForRelayrBundle: mocks.waitForRelayrBundle,
  checkRelayrSession: mocks.checkRelayrSession,
  discardRelayrSession: mocks.discardRelayrSession,
}));
vi.mock("@/hooks/useViewedAccount", () => ({ useViewedAccount: () => ({ address: ACCOUNT }) }));
vi.mock("@/hooks/useCompleteBendystrawLists", () => ({
  useCompleteAccountActivity: () => ({ data: {}, isLoading: false, isError: false }),
}));
vi.mock("@/lib/bendystraw/accountActivity", () => ({ mergeAccountActivity: () => mocks.indexed }));
vi.mock("@/lib/transaction-activity", () => ({
  useTransactionActivities: () => mocks.activities,
  dismissTransactionActivity: mocks.dismiss,
}));
vi.mock("@/app/[slug]/components/ActivityFeed/mapActivityEvents", () => ({
  mapActivityEvents: () => [],
}));
vi.mock("@/app/[slug]/components/ActivityFeed/ActivityItem", () => ({
  ActivityItemRow: () => null,
}));
vi.mock("@/components/ProfilesContext", () => ({
  ProfilesProvider: ({ children }: PropsWithChildren) => children,
}));
vi.mock("@/components/ProjectLink", () => ({
  ProjectLink: ({ children }: PropsWithChildren) => children,
}));

function activity(overrides: Partial<TransactionActivity> = {}): TransactionActivity {
  return {
    id: "relayr:bundle",
    kind: "relayr-bundle",
    account: ACCOUNT,
    title: "Update recipients",
    message: "Waiting for destination confirmation",
    status: "pending",
    bundleUuid: "bundle-1",
    hash: HASH,
    relayrPaymentStatus: "confirmed",
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

beforeEach(() => {
  mocks.activities = [];
  mocks.indexed = [];
  mocks.checkRelayrSession.mockClear();
  mocks.discardRelayrSession.mockClear();
});

/** One forward request on Base, signed at the forwarder nonce 4. */
function signedRequest(): Pick<TransactionActivity, "relayrExpectedTransactions" | "relayrNonces"> {
  const forwarder = jbContractAddress["6"].ERC2771Forwarder[8453]!;
  return {
    relayrExpectedTransactions: [
      {
        chainId: 8453,
        target: forwarder,
        data: encodeFunctionData({
          abi: erc2771ForwarderAbi,
          functionName: "execute",
          args: [
            {
              from: ACCOUNT,
              to: ACCOUNT,
              value: 0n,
              gas: 100_000n,
              deadline: 1_900_000_000,
              data: "0x1234",
              signature: `0x${"12".repeat(65)}`,
            },
          ],
        }),
        value: "0",
        transactionUuid: "11111111-1111-4111-8111-111111111111",
      },
    ],
    relayrNonces: ["4"],
  };
}

describe("account Relayr session rules (ruling R114 (e))", () => {
  it("checks an unpaid session's signatures", () => {
    mocks.activities = [
      activity({ relayrPaymentStatus: "unfunded", hash: undefined, ...signedRequest() }),
    ];
    render(<AccountActivity address={ACCOUNT} />);
    fireEvent.click(screen.getByRole("button", { name: "Check signatures" }));
    expect(mocks.checkRelayrSession).toHaveBeenCalledExactlyOnceWith("relayr:bundle");
    expect(screen.queryByRole("button", { name: "Discard" })).not.toBeInTheDocument();
  });

  it("offers Discard with its line for a session marked for it, and no other check", () => {
    const line = "This action's earlier signatures expired without running.";
    mocks.activities = [
      activity({
        relayrPaymentStatus: "unfunded",
        hash: undefined,
        status: "failed",
        manualVerificationRequired: true,
        relayrDiscardable: "expired",
        message: line,
        ...signedRequest(),
      }),
    ];
    render(<AccountActivity address={ACCOUNT} />);
    expect(screen.getByText(line)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Check signatures" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Discard" }));
    expect(mocks.discardRelayrSession).toHaveBeenCalledExactlyOnceWith("relayr:bundle");
  });

  it("never offers Discard on a completed bundle", () => {
    mocks.activities = [
      activity({
        status: "success",
        manualVerificationRequired: false,
        relayrDiscardable: "ran",
        ...signedRequest(),
      }),
    ];
    render(<AccountActivity address={ACCOUNT} />);
    expect(screen.getByText("Update recipients")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Discard" })).not.toBeInTheDocument();
  });

  it("never offers Discard on a session a new quote replaced", () => {
    mocks.activities = [
      activity({
        status: "failed",
        manualVerificationRequired: false,
        relayrPaymentStatus: "expired",
        relayrDiscardable: "expired",
        hash: undefined,
        message: "This unpaid Relayr quote was replaced by a new one. Nothing was paid.",
        ...signedRequest(),
      }),
    ];
    render(<AccountActivity address={ACCOUNT} />);
    expect(screen.getByText("Update recipients")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Discard" })).not.toBeInTheDocument();
  });

  it("checks no signatures it can't classify, such as a raw call's", () => {
    mocks.activities = [
      activity({
        relayrPaymentStatus: "unfunded",
        hash: undefined,
        relayrExpectedTransactions: [
          { chainId: 8453, target: ACCOUNT, data: "0x1234", value: "0", transactionUuid: "" },
        ],
      }),
    ];
    render(<AccountActivity address={ACCOUNT} />);
    expect(screen.queryByRole("button", { name: "Check signatures" })).not.toBeInTheDocument();
  });
});

describe("account Relayr recovery controls", () => {
  it.each(["unfunded", "reverted"] as const)(
    "does not offer a bundle check for %s payment",
    (relayrPaymentStatus) => {
      mocks.activities = [activity({ relayrPaymentStatus })];
      render(<AccountActivity address={ACCOUNT} />);
      expect(screen.getByText("Update recipients")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Check bundle" })).not.toBeInTheDocument();
    },
  );

  it.each([
    { status: "failed" as const, manualVerificationRequired: false },
    { status: "success" as const, manualVerificationRequired: true },
  ])("offers verification for funded $status bundles", (overrides) => {
    mocks.activities = [activity(overrides)];
    render(<AccountActivity address={ACCOUNT} />);
    fireEvent.click(screen.getByRole("button", { name: "Check bundle" }));
    expect(mocks.waitForRelayrBundle).toHaveBeenCalledExactlyOnceWith("bundle-1");
  });

  it("keeps an unresolved bundle visible when its payment is already indexed", () => {
    mocks.activities = [activity({ status: "failed", manualVerificationRequired: true })];
    mocks.indexed = [{ id: "indexed-payment", txHash: HASH, chainId: 8453 }];
    render(<AccountActivity address={ACCOUNT} />);
    expect(screen.getByRole("button", { name: "Check bundle" })).toBeInTheDocument();
  });
});

describe("a Safe proposal whose result can't be confirmed here", () => {
  it("offers its account a Dismiss, and no other proposal one", () => {
    const proposal = {
      kind: "safe" as const,
      status: "safe-proposed" as const,
      bundleUuid: undefined,
      relayrPaymentStatus: undefined,
    };
    mocks.activities = [
      activity({
        ...proposal,
        id: "safe:unconfirmed",
        title: "Make the market",
        message:
          "This Safe transaction's result can't be confirmed here. Check it in Safe before retrying.",
        safeResultUnconfirmed: true,
      }),
      activity({ ...proposal, id: "safe:pending", title: "Set the split" }),
    ];
    render(<AccountActivity address={ACCOUNT} />);

    const dismiss = screen.getAllByRole("button", { name: "Dismiss" });
    expect(dismiss).toHaveLength(1);
    fireEvent.click(dismiss[0]!);
    expect(mocks.dismiss).toHaveBeenCalledExactlyOnceWith("safe:unconfirmed");
  });

  it.each(["hash", "executionHash"] as const)(
    "stays, with its Dismiss, once its %s is indexed",
    (field) => {
      mocks.activities = [
        activity({
          id: "safe:unconfirmed",
          kind: "safe",
          status: "safe-proposed",
          bundleUuid: undefined,
          relayrPaymentStatus: undefined,
          title: "Make the market",
          hash: `0x${"bb".repeat(32)}`,
          [field]: HASH,
          safeResultUnconfirmed: true,
        }),
      ];
      mocks.indexed = [{ id: "indexed-execution", txHash: HASH, chainId: 8453 }];
      render(<AccountActivity address={ACCOUNT} />);

      expect(screen.getByText("Make the market")).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
      expect(mocks.dismiss).toHaveBeenCalledExactlyOnceWith("safe:unconfirmed");
    },
  );
});
