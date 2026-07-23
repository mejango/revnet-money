import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  fetchEthPrice: vi.fn(),
  request: vi.fn(),
}));

vi.mock("next/cache", () => ({
  unstable_cache: (callback: (...args: never[]) => unknown) => callback,
}));
vi.mock("@/lib/bendystraw/query.server", () => ({
  queryBendystraw: mocks.request,
}));
vi.mock("@/lib/ethPrice", () => ({
  fetchEthPrice: mocks.fetchEthPrice,
}));

import { getTopProjects } from "@/app/getTopProjects";

describe("top-project derivative availability", () => {
  beforeEach(() => {
    mocks.fetchEthPrice.mockReset().mockResolvedValue(3_000);
    mocks.request.mockReset();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  it("keeps the landing page available when Bendystraw is unavailable", async () => {
    mocks.request.mockRejectedValue(new Error("index unavailable"));

    await expect(getTopProjects()).resolves.toEqual([]);
    expect(mocks.fetchEthPrice).not.toHaveBeenCalled();
  });

  it("does not fetch an unrelated ETH price for an empty derivative result", async () => {
    mocks.request.mockResolvedValue({ suckerGroups: { items: [] } });

    await expect(getTopProjects()).resolves.toEqual([]);
    expect(mocks.fetchEthPrice).not.toHaveBeenCalled();
  });

  it("maps only supported revnet balances from the derivative view", async () => {
    mocks.request.mockResolvedValue({
      suckerGroups: {
        items: [
          {
            balance: "2000000000000000000",
            projects: {
              items: [
                {
                  chainId: 1,
                  decimals: 18,
                  isRevnet: true,
                  logoUri: "ipfs://bafybeigdyrzt5sfp7udm7hu76uh7y26nf3nuy5v7pnpubszuztzlyh7uqa",
                  name: "Canonical",
                  projectId: 7,
                  projectTagline: "Contract-derived economics",
                  tokenSymbol: "eth",
                },
              ],
            },
          },
          {
            balance: "999999999999999999999999",
            projects: {
              items: [
                {
                  chainId: 1,
                  decimals: 18,
                  isRevnet: false,
                  projectId: 8,
                  tokenSymbol: "ETH",
                },
              ],
            },
          },
        ],
      },
    });

    await expect(getTopProjects()).resolves.toEqual([
      expect.objectContaining({
        balanceUsd: 6_000,
        chainId: 1,
        chainSlug: "eth",
        name: "Canonical",
        projectId: 7,
        rank: 1,
      }),
    ]);
  });
});
