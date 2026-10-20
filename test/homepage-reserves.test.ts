import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ query: vi.fn(), groups: vi.fn() }));

vi.mock("next/cache", () => ({
  unstable_cache: (callback: (...args: never[]) => unknown) => callback,
}));
vi.mock("@/lib/bendystraw/query.server", () => ({ queryBendystraw: mocks.query }));
vi.mock("@/app/getTopProjects", () => ({ getHomepageSuckerGroups: mocks.groups }));

import { getHomepageReserves } from "@/app/getHomepageReserves";

const ETH = "0x000000000000000000000000000000000000eeee";
const USDC = "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48";
const BASE_USDC = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
const e18 = (value: number) => `${value}000000000000000000`;
const page = (items: unknown[]) => ({ items, pageInfo: { hasNextPage: false, endCursor: null } });

const groups = [
  {
    // REV on Ethereum, holding ETH and USDC: its raw balance adds both tokens' units.
    id: "rev",
    balanceUsd: e18(2100),
    volumeUsd: e18(3000),
    projects: {
      items: [
        {
          chainId: 1,
          projectId: 3,
          version: 6,
          isRevnet: true,
          projectTokenBalances: {
            items: [
              {
                token: ETH,
                tokenSymbol: "ETH",
                decimals: 18,
                balance: e18(1),
                balanceUsd: e18(2000),
                usdRate: e18(2000),
              },
              {
                token: USDC,
                tokenSymbol: null,
                decimals: 6,
                balance: "100000000",
                balanceUsd: e18(100),
                usdRate: e18(1),
              },
            ],
          },
        },
      ],
    },
  },
  {
    id: "usdc",
    balanceUsd: e18(50),
    volumeUsd: e18(60),
    projects: {
      items: [
        {
          chainId: 8453,
          projectId: 7,
          version: 6,
          isRevnet: true,
          projectTokenBalances: {
            items: [
              {
                token: BASE_USDC,
                tokenSymbol: "USDC",
                decimals: 6,
                balance: "50000000",
                balanceUsd: e18(50),
                usdRate: e18(1),
              },
            ],
          },
        },
      ],
    },
  },
];

describe("homepage reserves", () => {
  beforeEach(() => {
    mocks.groups.mockResolvedValue(groups);
    mocks.query.mockImplementation(async (_chainId, operation, variables) => {
      switch (operation.id) {
        case "add-to-balance-inflows.v1":
          return {
            addToBalanceEvents: page([
              { suckerGroupId: "rev", timestamp: 150, amountUsd: e18(10) },
              { suckerGroupId: "not-a-revnet", timestamp: 150, amountUsd: e18(999) },
            ]),
          };
        case "sucker-group-moments.v1":
          return {
            suckerGroupMoments: page(
              variables.suckerGroupId === "rev"
                ? [
                    { timestamp: 100, balanceUsd: e18(2000), volumeUsd: e18(2000) },
                    { timestamp: 200, balanceUsd: e18(2100), volumeUsd: e18(3000) },
                  ]
                : [{ timestamp: 150, balanceUsd: e18(50), volumeUsd: e18(60) }],
            ),
          };
        case "project-token-balance-moments.v1":
          return {
            projectTokenBalanceMoments: page(
              variables.chainId === 1
                ? [
                    {
                      token: ETH,
                      decimals: 18,
                      timestamp: 100,
                      balance: e18(1),
                      tokenUsdRate: e18(2000),
                    },
                    {
                      token: USDC,
                      decimals: 6,
                      timestamp: 200,
                      balance: "100000000",
                      tokenUsdRate: e18(1),
                    },
                  ]
                : [
                    {
                      token: BASE_USDC,
                      decimals: 6,
                      timestamp: 150,
                      balance: "50000000",
                      tokenUsdRate: e18(1),
                    },
                  ],
            ),
          };
      }
      throw new Error(`unexpected ${operation.id}`);
    });
  });

  it("counts each token of a multi-token group in its own units and totals in USD", async () => {
    const reserves = await getHomepageReserves();

    expect(reserves.totalUsd).toBe(2150);
    expect(reserves.passedThroughUsd).toBe(3070);
    expect(reserves.chains).toEqual([
      { chainId: 1, eth: 1, usdc: 100, otherAssets: [] },
      { chainId: 42161, eth: 0, usdc: 0, otherAssets: [] },
      { chainId: 8453, eth: 0, usdc: 50, otherAssets: [] },
      { chainId: 10, eth: 0, usdc: 0, otherAssets: [] },
    ]);
    expect(reserves.points.at(-1)).toEqual({
      timestamp: 200,
      valueUsd: 2150,
      chains: [
        { chainId: 1, valueUsd: 2100 },
        { chainId: 42161, valueUsd: 0 },
        { chainId: 8453, valueUsd: 50 },
        { chainId: 10, valueUsd: 0 },
      ],
    });
    expect(reserves.volumePoints.at(-1)?.valueUsd).toBe(3070);
    // REV's inflows: 1 ETH and 100 USDC, each at its own latest rate.
    expect(reserves.feesUsd).toBe(2100);
  });

  it("keeps chain history usable through an unpriced moment and a missing current row", async () => {
    mocks.groups.mockResolvedValue([
      {
        ...groups[0],
        projects: {
          items: [{ ...groups[0].projects.items[0], projectTokenBalances: { items: [] } }],
        },
      },
    ]);
    const query = mocks.query.getMockImplementation()!;
    mocks.query.mockImplementation(async (chainId, operation, variables) =>
      operation.id === "project-token-balance-moments.v1"
        ? {
            projectTokenBalanceMoments: page([
              {
                token: ETH,
                decimals: 18,
                timestamp: 100,
                balance: e18(1),
                tokenUsdRate: e18(2000),
              },
              { token: ETH, decimals: 18, timestamp: 200, balance: e18(2), tokenUsdRate: null },
            ]),
          }
        : query(chainId, operation, variables),
    );

    const reserves = await getHomepageReserves();

    expect(reserves.points.map((point) => point.chains[0])).toEqual([
      { chainId: 1, valueUsd: 2000 },
      { chainId: 1, valueUsd: 4000 },
    ]);
  });
});
