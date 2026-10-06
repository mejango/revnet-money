import {
  routeSafeBatch,
  useSafeBatchSubmit,
} from "@/app/[slug]/components/v6/operator/useSafeBatchSubmit";
import { buildStep, composeBatch } from "@/lib/safe-batch";
import {
  encodeMultiSend,
  MULTI_SEND_CALL_ONLY,
  type AuthorityIdentity,
} from "@bananapus/nana-sdk-core/safe";
import {
  safeBatchProposalFor,
  safeTransactionHash,
  type SafeQueuedTransaction,
} from "@bananapus/nana-sdk-core/safe-service";
import { act, renderHook } from "@testing-library/react";
import type { Address, Hex } from "viem";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { provenSafe, queuedRow, safeChain, safeTransactionService } from "./fixtures/safe-chain";

const SIGNER = "0x1111111111111111111111111111111111111111" as Address;
const OTHER = "0x2222222222222222222222222222222222222222" as Address;
const SAFE = "0x3333333333333333333333333333333333333333" as Address;
const HOOK = "0xB222Da5A71e8FB89a5A38b7c920EaB5DfbC74B91" as Address;
const SIGNATURE = `0x${"12".repeat(64)}1b` as Hex;

const mocks = vi.hoisted(() => ({
  account: "0x2222222222222222222222222222222222222222",
  sign: vi.fn(),
  client: undefined as unknown,
}));

vi.mock("wagmi", () => ({ useConfig: () => ({}) }));
vi.mock("wagmi/actions", () => ({ getAccount: () => ({ address: mocks.account, chainId: 8453 }) }));
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));
vi.mock("@/lib/wagmiConfig", () => ({ wagmiConfig: {} }));
vi.mock("@/hooks/useReviewedWriteContract", () => ({
  followSubmission: vi.fn(),
  isSafeConnection: () => false,
  proposeSafeBatch: vi.fn(),
  requireOnchainExecution: vi.fn(),
  useWriteContract: () => ({ writeContractAsync: vi.fn() }),
}));
vi.mock("@/hooks/useReviewedSafeSignature", () => ({
  useReviewedSafeSignature: () => ({ signSafeTransactionAsync: mocks.sign }),
}));
vi.mock("@/app/[slug]/components/v6/operator/operatorLib", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/app/[slug]/components/v6/operator/operatorLib")>()),
  publicClientFor: () => mocks.client,
}));

const safeIdentity = (owners: Address[]): AuthorityIdentity => ({
  kind: "safe",
  proxyCodeHash: "0x00",
  singleton: OTHER,
  singletonCodeHash: "0x00",
  version: "1.4.1",
  owners,
  threshold: 2,
  fallbackHandler: OTHER,
  fallbackHandlerCodeHash: null,
  guard: OTHER,
  hasModules: false,
  modules: [],
  ownersAreEoas: true,
});

describe("a batch signed for the operator Safe on a chain with a Safe service", () => {
  const OPERATOR_SAFE = provenSafe();
  const [SIGNING_OWNER, CO_SIGNER] = OPERATOR_SAFE.owners;
  const steps = [
    buildStep({ kind: "setHookFor", chainId: 8453, projectId: 2, values: { hook: HOOK } }),
  ];
  const batch = (nonce: number) => safeBatchProposalFor(composeBatch(steps).calls, nonce);

  function queue(pending: SafeQueuedTransaction[] = []) {
    const service = safeTransactionService("base", OPERATOR_SAFE.address, pending);
    vi.stubGlobal("fetch", service.fetch);
    return service;
  }

  async function submit() {
    const { result } = renderHook(() => useSafeBatchSubmit());
    let outcome: Awaited<ReturnType<ReturnType<typeof useSafeBatchSubmit>["submit"]>>;
    await act(async () => {
      outcome = await result.current.submit({
        chainId: 8453,
        steps,
        route: {
          kind: "safe-signer",
          safe: OPERATOR_SAFE.address,
          owners: OPERATOR_SAFE.owners,
          threshold: 2,
        },
        onProgress: vi.fn(),
        onStep: vi.fn(),
      });
    });
    return outcome!;
  }

  beforeEach(() => {
    mocks.account = SIGNING_OWNER;
    mocks.sign.mockResolvedValue(SIGNATURE);
    const chain = safeChain(OPERATOR_SAFE.address, { nonce: 5n });
    mocks.client = {
      ...chain.client,
      getCode: async ({ address }: { address: Address }) =>
        address.toLowerCase() === MULTI_SEND_CALL_ONLY.toLowerCase()
          ? "0x6080"
          : chain.getCode({ address }),
      simulateCalls: async ({ calls }: { calls: unknown[] }) => ({
        results: calls.map(() => ({ status: "success" })),
      }),
    };
  });

  it("wallet-action:safe-batch proposes one MultiSend delegatecall with this app's origin", async () => {
    const service = queue();

    const outcome = await submit();
    const hash = safeTransactionHash(8453, OPERATOR_SAFE.address, batch(5));
    expect(outcome).toEqual({ kind: "proposed", hash, calls: 1 });
    expect(service.posts).toEqual([
      {
        url: `https://api.safe.global/tx-service/base/api/v1/safes/${OPERATOR_SAFE.address}/multisig-transactions/`,
        body: expect.objectContaining({
          to: MULTI_SEND_CALL_ONLY,
          data: encodeMultiSend(composeBatch(steps).calls),
          operation: 1,
          nonce: "5",
          contractTransactionHash: hash,
          sender: SIGNING_OWNER,
          signature: SIGNATURE,
          origin: "revnet.money",
        }),
      },
    ]);
  });

  it("confirms the identical queued batch instead of proposing it twice", async () => {
    const queued = queuedRow(8453, OPERATOR_SAFE.address, batch(5), [
      { owner: CO_SIGNER, signature: SIGNATURE },
    ]);
    const service = queue([queued]);

    await expect(submit()).resolves.toEqual({
      kind: "confirmed",
      hash: queued.safeTxHash,
      calls: 1,
    });
    expect(service.posts).toEqual([
      {
        url: `https://api.safe.global/tx-service/base/api/v1/multisig-transactions/${queued.safeTxHash}/confirmations/`,
        body: { signature: SIGNATURE },
      },
    ]);
  });

  it("signs nothing more when its own confirmation already counts", async () => {
    const service = queue([
      queuedRow(8453, OPERATOR_SAFE.address, batch(5), [
        { owner: SIGNING_OWNER, signature: SIGNATURE },
      ]),
    ]);

    await expect(submit()).resolves.toMatchObject({ kind: "confirmed" });
    expect(mocks.sign).not.toHaveBeenCalled();
    expect(service.posts).toEqual([]);
  });
});

describe("batch routing", () => {
  it("proposes to the operator Safe when the connected wallet co-signs it", () => {
    expect(
      routeSafeBatch({
        account: SIGNER,
        authority: SAFE,
        identity: safeIdentity([OTHER, SIGNER]),
        safeConnection: false,
      }),
    ).toEqual({ kind: "safe-signer", safe: SAFE, owners: [OTHER, SIGNER], threshold: 2 });
  });

  it("uses the Safe app when connected as the authority through it, else direct writes", () => {
    expect(
      routeSafeBatch({ account: SAFE, authority: SAFE, identity: null, safeConnection: true }),
    ).toEqual({ kind: "safe-app", authority: SAFE });
    expect(
      routeSafeBatch({ account: SIGNER, authority: SIGNER, identity: null, safeConnection: false }),
    ).toEqual({ kind: "eoa", authority: SIGNER });
    // An unknown authority keeps the historical direct path.
    expect(
      routeSafeBatch({
        account: SIGNER,
        authority: undefined,
        identity: null,
        safeConnection: false,
      }),
    ).toEqual({ kind: "eoa", authority: SIGNER });
  });

  it("refuses a Safe app opened on another chain instead of trying to switch", () => {
    const route = routeSafeBatch({
      account: SAFE,
      authority: SAFE,
      identity: null,
      safeConnection: true,
      chainId: 10,
      connectedChainId: 1,
    });
    expect(route).toMatchObject({
      kind: "refused",
      message: expect.stringMatching(/Open this Safe on/),
    });
    expect(
      routeSafeBatch({
        account: SAFE,
        authority: SAFE,
        identity: null,
        safeConnection: true,
        chainId: 10,
        connectedChainId: 10,
      }),
    ).toEqual({ kind: "safe-app", authority: SAFE });
  });

  it("refuses with the existing copy when the wallet cannot act for the authority", () => {
    expect(
      routeSafeBatch({
        account: SIGNER,
        authority: SAFE,
        identity: safeIdentity([OTHER]),
        safeConnection: false,
      }),
    ).toMatchObject({ kind: "refused", message: expect.stringMatching(/not a signer/) });
    expect(
      routeSafeBatch({
        account: SIGNER,
        authority: OTHER,
        identity: { kind: "eoa" },
        safeConnection: false,
      }),
    ).toMatchObject({
      kind: "refused",
      message: expect.stringMatching(/not this revnet's operator/),
    });
    expect(
      routeSafeBatch({
        account: undefined,
        authority: OTHER,
        identity: null,
        safeConnection: false,
      }),
    ).toMatchObject({ kind: "refused", message: "Connect a wallet first." });
  });
});
