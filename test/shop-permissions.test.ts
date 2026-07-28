import { canAdjust721Tiers } from "@/app/[slug]/components/v6/shop/shopPermissions";
import type { Address, PublicClient } from "viem";
import { describe, expect, it, vi } from "vitest";

const hook = "0x0000000000000000000000000000000000000001" as Address;
const owner = "0x0000000000000000000000000000000000000002" as Address;
const operator = "0x0000000000000000000000000000000000000003" as Address;

describe("canAdjust721Tiers", () => {
  it("accepts the hook owner without consulting JBPermissions", async () => {
    const readContract = vi.fn().mockResolvedValue(owner);

    await expect(
      canAdjust721Tiers({ readContract } as unknown as PublicClient, {
        chainId: 84532,
        projectId: 12n,
        hook,
        operator: owner,
      }),
    ).resolves.toBe(true);

    expect(readContract).toHaveBeenCalledTimes(1);
    expect(readContract).toHaveBeenCalledWith(
      expect.objectContaining({
        address: hook,
        functionName: "owner",
        args: [],
      }),
    );
  });

  it("checks the live hook owner grant for delegated tier managers", async () => {
    const readContract = vi.fn().mockResolvedValueOnce(owner).mockResolvedValueOnce(true);

    await expect(
      canAdjust721Tiers({ readContract } as unknown as PublicClient, {
        chainId: 84532,
        projectId: 12n,
        hook,
        operator,
      }),
    ).resolves.toBe(true);

    expect(readContract).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        functionName: "hasPermissions",
        args: [operator, owner, 12n, [24n], true, true],
      }),
    );
  });

  it("rejects wallets without the live hook permission", async () => {
    const readContract = vi.fn().mockResolvedValueOnce(owner).mockResolvedValueOnce(false);

    await expect(
      canAdjust721Tiers({ readContract } as unknown as PublicClient, {
        chainId: 84532,
        projectId: 12n,
        hook,
        operator,
      }),
    ).resolves.toBe(false);
  });
});
