import { routeSafeBatch } from "@/app/[slug]/components/v6/operator/useSafeBatchSubmit";
import type { AuthorityIdentity } from "@/lib/cross-chain-authority";
import { encodeMultiSend, MULTI_SEND_CALL_ONLY } from "@/lib/safe-batch";
import {
  proposeSafeTransaction,
  queuedTransactionMatchesCall,
  safeBatchProposalFor,
  safeProposalFor,
  safeTransactionHash,
} from "@/lib/safe-queue";
import { getAddress, type Address, type Hex } from "viem";
import { describe, expect, it, vi } from "vitest";

// wallet-action:safe-batch

const SIGNER = "0x1111111111111111111111111111111111111111" as Address;
const OTHER = "0x2222222222222222222222222222222222222222" as Address;
const SAFE = "0x3333333333333333333333333333333333333333" as Address;
const REGISTRY = "0x72F55a54CD53410a5Ff175508a5A384227081788" as Address;
const ROUTER_REGISTRY = "0xe0427F250fdb0379c8E98e884Ee4570521208CbC" as Address;

const calls = [
  { to: REGISTRY, data: "0x779b0290aa" as Hex, value: 0n },
  { to: ROUTER_REGISTRY, data: "0xf3e37d01bb" as Hex, value: 0n },
];

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
  ownersAreEoas: true,
});

describe("Safe batch proposal (operation 1)", () => {
  it("shapes one MultiSendCallOnly delegatecall at the given nonce", () => {
    const tx = safeBatchProposalFor(calls, 9);
    expect(tx).toEqual({
      to: MULTI_SEND_CALL_ONLY,
      value: "0",
      data: encodeMultiSend(calls),
      operation: 1,
      safeTxGas: "0",
      baseGas: "0",
      gasPrice: "0",
      gasToken: "0x0000000000000000000000000000000000000000",
      refundReceiver: "0x0000000000000000000000000000000000000000",
      nonce: 9,
      confirmations: [],
    });
    expect(tx.data!.slice(0, 10)).toBe("0x8d80ff0a");
  });

  it("matches a queued batch only on the same target, bytes, and operation", () => {
    const tx = safeBatchProposalFor(calls, 9);
    const batchCall = { to: MULTI_SEND_CALL_ONLY, data: encodeMultiSend(calls), operation: 1 };
    expect(queuedTransactionMatchesCall(tx, batchCall)).toBe(true);
    expect(queuedTransactionMatchesCall(tx, { ...batchCall, operation: 0 })).toBe(false);
    expect(queuedTransactionMatchesCall(tx, { ...batchCall, operation: undefined })).toBe(false);
    expect(
      queuedTransactionMatchesCall(tx, {
        ...batchCall,
        data: encodeMultiSend([calls[1]!, calls[0]!]),
      }),
    ).toBe(false);
    // A plain CALL proposal never passes for the batch, nor the batch for it.
    const plain = safeProposalFor({ to: MULTI_SEND_CALL_ONLY, data: encodeMultiSend(calls) }, 9);
    expect(queuedTransactionMatchesCall(plain, batchCall)).toBe(false);
    expect(queuedTransactionMatchesCall(plain, { ...batchCall, operation: 0 })).toBe(true);
  });

  it("signs the operation into the EIP-712 hash", () => {
    const batch = safeBatchProposalFor(calls, 9);
    const plain = safeProposalFor({ to: MULTI_SEND_CALL_ONLY, data: encodeMultiSend(calls) }, 9);
    expect(safeTransactionHash(8453, SAFE, batch)).not.toBe(safeTransactionHash(8453, SAFE, plain));
  });

  it("posts the exact operation-1 payload to the Safe service and returns its hash", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);
    const tx = safeBatchProposalFor(calls, 9);
    const hash = await proposeSafeTransaction(8453, SAFE, tx, SIGNER, "0x99");

    expect(hash).toBe(safeTransactionHash(8453, SAFE, tx));
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(
      `https://api.safe.global/tx-service/base/api/v1/safes/${getAddress(SAFE)}/multisig-transactions/`,
    );
    expect(JSON.parse(String(init.body))).toMatchObject({
      to: MULTI_SEND_CALL_ONLY,
      value: "0",
      data: encodeMultiSend(calls),
      operation: 1,
      nonce: "9",
      contractTransactionHash: hash,
      sender: getAddress(SIGNER),
      signature: "0x99",
      origin: "revnet.money",
    });
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
