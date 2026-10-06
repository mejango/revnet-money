import { safeRelayrSession } from "@/lib/safe-relayr";
import type { TransactionActivity } from "@/lib/transaction-activity";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ACCOUNT, BUNDLE_UUID, HASH, TARGET, TX_UUIDS } from "./relayr-fixtures";

const legacy: TransactionActivity = {
  id: `relayr:${BUNDLE_UUID}`,
  kind: "relayr-bundle",
  title: "Saved Safe bundle",
  status: "pending",
  message: "Waiting",
  account: ACCOUNT,
  bundleUuid: BUNDLE_UUID,
  relayrPaymentStatus: "unfunded",
  relayrExpectedTransactions: [
    {
      chainId: 1,
      target: TARGET,
      data: "0x1234",
      value: "0",
      gas: "100000",
      transactionUuid: TX_UUIDS[0],
      expectedSafeExecution: { safe: TARGET, safeTxHash: HASH, nonce: 7 },
      preconditions: [{ address: TARGET, data: "0x1234", expected: HASH }],
    },
  ],
  createdAt: 1,
  updatedAt: 2,
};

describe("Safe Relayr legacy storage adapter", () => {
  it("retains original call bytes, guards and UUID bindings when a legacy record has no saved fee options", () => {
    const session = safeRelayrSession(legacy)!;
    expect(session.id).toBe(legacy.id);
    expect(session.quote?.payment_info).toEqual([]);
    expect(session.quote?.expectedTransactions[0]).toMatchObject({
      txUuid: TX_UUIDS[0],
      entry: { data: "0x1234", value: "0" },
    });
    expect(session.executions[0].context).toEqual({
      expected: legacy.relayrExpectedTransactions![0],
    });
    expect(session.reservationKeys).toEqual([`1:${TARGET.toLowerCase()}:7`]);
  });

  it("preserves an unresolved Safe reservation even when its exact calls are missing", () => {
    const session = safeRelayrSession({
      ...legacy,
      relayrExpectedTransactions: undefined,
      relayrCallKeys: [
        `${ACCOUNT.toLowerCase()}:relayr-scope:safe-execution:1:${TARGET.toLowerCase()}:7`,
      ],
    })!;
    expect(session.executions).toEqual([]);
    expect(session.state).toBe("active");
    expect(session.quote).toBeUndefined();
    expect(session.reservationKeys).toEqual([`1:${TARGET.toLowerCase()}:7`]);
  });

  it("fails closed for a known Safe journal with a missing account", () => {
    expect(() => safeRelayrSession({ ...legacy, account: undefined })).toThrow(
      /missing its account/,
    );
  });

  it("retains a hashless retry's sending state across reloads despite older payment history", () => {
    const session = safeRelayrSession({
      ...legacy,
      relayrSafeSessionId: "sdk-session",
      relayrSafeFundingUnknown: true,
      relayrPaymentStatus: "submitted",
      hash: HASH,
    });
    expect(session?.paymentStatus).toBe("sending");
    expect(safeRelayrSession({ ...legacy, relayrPaymentStatus: "submitted" })?.paymentStatus).toBe(
      "sending",
    );
    expect(
      safeRelayrSession({
        ...legacy,
        relayrSafeSessionId: "sdk-session",
        relayrSafeFundingUnknown: false,
        relayrPaymentStatus: "submitted",
      })?.paymentStatus,
    ).toBe("submitted");
  });
});

describe("Safe Relayr shared ownership gate", () => {
  it("routes preparation, payment and recovery through the SDK without duplicating its lifecycle", () => {
    const adapter = readFileSync("src/lib/safe-relayr.ts", "utf8");
    const hook = readFileSync("src/hooks/useReviewedRelayr.ts", "utf8");
    expect(adapter).toContain('from "@bananapus/nana-sdk-core/review/safe-relayr"');
    expect(adapter).toContain("createSafeRelayrController({");
    expect(hook).toMatch(/safeRelayrController\(config\)\.prepare\(/);
    expect(hook).toMatch(/\.fund\(\{/);
    expect(hook).toMatch(/safeRelayrController\(wagmiConfig\)\.check\(/);
    expect(hook).toMatch(/safeRelayrController\(wagmiConfig\)\.watch\(/);
    expect(adapter).not.toMatch(
      /\b(?:bindRelayrQuote|relayrBundleRequest|relayrDeadlinePassed|verifyRelayrDestinations|requireRelayrBundleUnpaid)\b/,
    );
    expect(hook).not.toMatch(/function (?:sameSafeIntents|safeIntentKey)|requireRawSafeExecution/);
  });
});
