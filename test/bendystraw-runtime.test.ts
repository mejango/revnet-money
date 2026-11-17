import { bendystrawNetworkFor } from "@/lib/bendystraw/client";
import { retryUnlessRateLimited } from "@/lib/bendystraw/retry";
import { BendystrawRequestError } from "@bananapus/nana-sdk-core";
import { describe, expect, it } from "vitest";

describe("shared Bendystraw runtime policy", () => {
  it("routes nested filters through the SDK network resolver", () => {
    expect(
      bendystrawNetworkFor({
        where: { OR: [{ chainId: 1 }, { nested: { chainId_in: [10, 8453] } }] },
      }),
    ).toBe("mainnet");
    expect(bendystrawNetworkFor({ where: { chainId_in: [11155111, 84532] } })).toBe("testnet");
  });

  it("fails closed for mixed or unsupported chain scopes", () => {
    expect(() => bendystrawNetworkFor({ where: { chainId_in: [1, 11155111] } })).toThrow(
      "cannot mix mainnet and testnet",
    );
    expect(() => bendystrawNetworkFor({ where: { chainId: 999_999 } })).toThrow(
      "Unsupported Bendystraw chain ID",
    );
  });

  it("retries a failure once, a proxied one too, but never a rate limit", () => {
    expect(retryUnlessRateLimited(0, new BendystrawRequestError("Bendystraw is busy", 429))).toBe(
      false,
    );
    // An indexer error the relay does not retry (a GraphQL error on HTTP 200) recovers here.
    expect(
      retryUnlessRateLimited(0, new BendystrawRequestError("Bendystraw unavailable", 502)),
    ).toBe(true);
    expect(
      retryUnlessRateLimited(1, new BendystrawRequestError("Bendystraw unavailable", 502)),
    ).toBe(false);
    expect(retryUnlessRateLimited(0, new Error("network"))).toBe(true);
    expect(retryUnlessRateLimited(1, new Error("network"))).toBe(false);
  });
});
