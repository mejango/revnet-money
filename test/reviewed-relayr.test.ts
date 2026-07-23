import type { RelayrGetBundleResponse } from "@/lib/nana/types";
import type { Hex } from "viem";
import { sepolia } from "viem/chains";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const HASH = `0x${"ab".repeat(32)}` as Hex;

function bundle(
  uuid: string,
  state: "Pending" | "Completed" | "Failed" | "Included" | "Success",
): RelayrGetBundleResponse {
  return {
    bundle_uuid: uuid,
    created_at: "2026-01-01T00:00:00Z",
    expires_at: "2026-01-01T01:00:00Z",
    payment: [],
    payment_received: true,
    transactions: [
      {
        tx_uuid: `${uuid}:transaction`,
        request: {
          chain: sepolia.id,
          target: "0x0000000000000000000000000000000000000001",
          data: "0x",
          value: "0x0",
          gas_limit: "0x5208",
          virtual_nonce: null,
        },
        status:
          state === "Success"
            ? { state, data: { hash: HASH } }
            : state === "Completed"
              ? {
                  state,
                  data: { block_hash: HASH, transaction: { hash: HASH } },
                }
              : { state },
      },
    ],
  };
}

async function freshModules() {
  vi.resetModules();
  const [relayr, activity] = await Promise.all([
    import("@/hooks/useReviewedRelayr"),
    import("@/lib/transaction-activity"),
  ]);
  return { relayr, activity };
}

function recordBundleActivity(
  activity: Awaited<ReturnType<typeof freshModules>>["activity"],
  uuid: string,
) {
  activity.recordTransactionActivity({
    id: `relayr:${uuid}`,
    kind: "relayr-bundle",
    title: "Relayr bundle",
    status: "pending",
    message: "Waiting for destination transactions.",
    bundleUuid: uuid,
  });
}

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("Relayr destination transaction tracking", () => {
  it("records destination hashes and confirms only when every chain succeeds", async () => {
    const { relayr, activity } = await freshModules();
    const response = bundle("successful", "Completed");
    const onUpdate = vi.fn();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify(response), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      ),
    );
    recordBundleActivity(activity, "successful");

    await expect(relayr.waitForRelayrBundle("successful", onUpdate)).resolves.toEqual(response);
    expect(onUpdate).toHaveBeenCalledWith(response);
    expect(activity.transactionActivitySnapshot()[0]).toMatchObject({
      status: "success",
      chainStates: [{ chainId: sepolia.id, status: "Completed", hash: HASH }],
    });
  });

  it("surfaces a failed destination and warns against submitting again", async () => {
    const { relayr, activity } = await freshModules();
    const response = bundle("failed", "Failed");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(JSON.stringify(response), { status: 200 })),
    );
    recordBundleActivity(activity, "failed");

    await expect(relayr.waitForRelayrBundle("failed")).rejects.toThrow(
      /bundle failed failed.*Chain 11155111: Failed/,
    );
    expect(activity.transactionActivitySnapshot()[0]).toMatchObject({
      status: "failed",
      chainStates: [{ chainId: sepolia.id, status: "Failed" }],
    });
  });

  it("deduplicates concurrent polling and recovers after a temporary status outage", async () => {
    vi.useFakeTimers();
    const { relayr, activity } = await freshModules();
    const response = bundle("recovering", "Success");
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("status endpoint unavailable"))
      .mockResolvedValueOnce(new Response(JSON.stringify(response), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    recordBundleActivity(activity, "recovering");

    const first = relayr.waitForRelayrBundle("recovering");
    const second = relayr.waitForRelayrBundle("recovering");
    await vi.runAllTimersAsync();

    await expect(Promise.all([first, second])).resolves.toEqual([response, response]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(activity.transactionActivitySnapshot()[0]).toMatchObject({ status: "success" });
  });
});
