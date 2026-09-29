import {
  useSafeBatchSubmit,
  type SafeBatchRoute,
} from "@/app/[slug]/components/v6/operator/useSafeBatchSubmit";
import { buildStep } from "@/lib/safe-batch";
import type { TransactionReviewRequest } from "@/lib/transaction-review";
import { act, renderHook } from "@testing-library/react";
import type { Address } from "viem";
import { beforeEach, describe, expect, it, vi } from "vitest";

// A signer of the operator Safe on a chain with no Safe transaction service
// approves (or executes) the batch's SafeTx hash onchain.

const SIGNER = "0x1111111111111111111111111111111111111111" as Address;
const OTHER = "0x2222222222222222222222222222222222222222" as Address;
const SAFE = "0x3333333333333333333333333333333333333333" as Address;
const HOOK = "0xB222Da5A71e8FB89a5A38b7c920EaB5DfbC74B91" as Address;

const mocks = vi.hoisted(() => ({
  safe: false,
  account: "0x1111111111111111111111111111111111111111" as string,
  approved: [] as string[],
  review: vi.fn(),
  write: vi.fn(),
  onchain: vi.fn(),
}));

vi.mock("wagmi", () => ({ useConfig: () => ({}) }));
vi.mock("wagmi/actions", () => ({
  getAccount: () => ({ address: mocks.account, chainId: 8453 }),
}));
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));
vi.mock("@/hooks/useReviewedWriteContract", () => ({
  SAFE_NONCE_GUIDANCE: "Safe nonce guidance.",
  followSubmission: vi.fn(),
  isSafeConnection: () => mocks.safe,
  proposeSafeBatch: vi.fn(),
  requireOnchainExecution: mocks.onchain,
  useWriteContract: () => ({ writeContractAsync: mocks.write }),
}));
vi.mock("@/hooks/useReviewedSafeSignature", () => ({
  useReviewedSafeSignature: () => ({ signSafeTransactionAsync: vi.fn() }),
}));
vi.mock("@/lib/cross-chain-authority", () => ({
  readAuthorityIdentity: async () => ({ kind: "safe", owners: [SIGNER, OTHER], threshold: 2 }),
  readBoundedSafeNonce: async () => 3n,
}));
vi.mock("@/lib/safe-queue", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/safe-queue")>()),
  hasSafeService: () => false,
}));
vi.mock("@/lib/transaction-review", () => ({ requireTransactionReview: mocks.review }));
vi.mock("@/lib/waitForReceipt", () => ({
  waitForReceiptWithRetry: async () => ({ status: "success", logs: [] }),
}));
vi.mock("@/app/[slug]/components/v6/operator/operatorLib", () => ({
  chainName: () => "Base",
  operatorWriteRoute: vi.fn(),
  runSequentialWrites: vi.fn(),
  publicClientFor: () => ({
    getCode: async () => "0x6080",
    simulateCalls: async ({ calls }: { calls: unknown[] }) => ({
      results: calls.map(() => ({ status: "success" })),
    }),
    readContract: async ({ args: [owner] }: { args: [string] }) =>
      mocks.approved.includes(owner) ? 1n : 0n,
  }),
}));

const steps = [
  buildStep({ kind: "setHookFor", chainId: 8453, projectId: 2, values: { hook: HOOK } }),
];
const route: SafeBatchRoute = {
  kind: "safe-signer",
  safe: SAFE,
  owners: [SIGNER, OTHER],
  threshold: 2,
};

async function submit() {
  const { result } = renderHook(() => useSafeBatchSubmit());
  return act(() =>
    result.current.submit({
      chainId: 8453,
      steps,
      route,
      onProgress: vi.fn(),
      onStep: vi.fn(),
    }),
  );
}

beforeEach(() => {
  mocks.safe = false;
  mocks.account = SIGNER;
  mocks.approved = [];
  mocks.review.mockResolvedValue(undefined);
  mocks.write.mockResolvedValue(`0x${"ab".repeat(32)}`);
  // As in the app, a Safe connection's write is a proposal that has not executed yet.
  mocks.onchain.mockImplementation(() => {
    if (mocks.safe) throw new Error("Proposed to Safe; not executed yet.");
  });
});

const run = (safe: boolean) =>
  safe ? expect(submit()).rejects.toThrow("Proposed to Safe") : submit();

describe("onchain Safe batch approval", () => {
  it.each([
    ["an EOA signer", false, "Agree & approve onchain"],
    ["a Safe signer", true, "Agree & propose to Safe"],
  ])(
    "reviews %s's approveHash with the batch it approves and its envelope",
    async (_, safe, label) => {
      mocks.safe = safe;
      await run(safe);

      expect(mocks.review).toHaveBeenCalledOnce();
      const request = mocks.review.mock.calls[0][0] as TransactionReviewRequest;
      expect(request.confirmLabel).toBe(label);
      expect(request.description?.endsWith("\n\nSafe nonce guidance.")).toBe(safe);
      expect(request.calls).toHaveLength(1);
      expect(request.calls[0]).toMatchObject({ to: SAFE, functionName: "approveHash" });
      // A Safe connection proposes the write with gas 0; an EOA's gas is measured after review.
      expect(request.calls[0].safeTxGas).toBe(safe ? 0n : undefined);
      expect(request.calls[0].gas).toBeUndefined();
      expect(request.calls[0].calls).toEqual([
        expect.objectContaining({ to: steps[0].to, data: steps[0].data, label: steps[0].label }),
      ]);
      expect(mocks.write).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({ address: SAFE, functionName: "approveHash" }),
      );
    },
  );

  it("reviews a Safe signer's execTransaction as a Safe proposal", async () => {
    mocks.safe = true;
    mocks.approved = [OTHER];
    await run(true);

    const request = mocks.review.mock.calls[0][0] as TransactionReviewRequest;
    expect(request.confirmLabel).toBe("Agree & propose to Safe");
    expect(request.calls[0]).toMatchObject({ functionName: "execTransaction", safeTxGas: 0n });
    expect(mocks.write).toHaveBeenCalledOnce();
  });

  it("sends nothing when the connection changes after review", async () => {
    mocks.review.mockImplementation(async () => {
      mocks.safe = true;
    });
    await expect(submit()).rejects.toThrow("Wallet connection changed");
    expect(mocks.write).not.toHaveBeenCalled();
  });
});
