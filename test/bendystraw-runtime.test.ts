import { bendystrawNetworkFor } from "@/lib/bendystraw/client";
import { retryUnlessProxied } from "@/lib/bendystraw/retry";
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

  it("never retries an answer from the proxy, and retries anything else once", () => {
    expect(retryUnlessProxied(0, new BendystrawRequestError("Bendystraw is busy", 429))).toBe(
      false,
    );
    expect(retryUnlessProxied(0, new Error("network"))).toBe(true);
    expect(retryUnlessProxied(1, new Error("network"))).toBe(false);
  });
});
