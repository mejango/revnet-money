import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("@/lib/bendystraw/query.server", () => ({ queryBendystraw: mocks.query }));

import { GET } from "@/app/api/data/shields/route";
import { fetchPayEventRates } from "@/lib/baseCurrencyRate";

const ETH = "0x000000000000000000000000000000000000eeee";
const USDC = "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48";

const deployment = {
  chainId: 1,
  isRevnet: true,
  id: "1-8-6",
  name: "Breadfruit",
  volumeUsd: "0",
  token: ETH,
  tokenSymbol: "ETH",
  decimals: 18,
  participants: { totalCount: 1, items: [] },
  metadata: null,
};

async function badge(items: unknown[], balanceUsd: string | null, query = "projectId=8&chainId=1") {
  mocks.query.mockReset();
  mocks.query.mockImplementation(async (...args: unknown[]) => {
    return (args[1] as { id: string }).id === "shield-project.v1"
      ? { project: { id: "p", suckerGroupId: "group" } }
      : { suckerGroup: { balanceUsd, volumeUsd: "0", projects: { items } } };
  });
  const response = await GET(
    new Request(`https://revnet.app/api/data/shields?${query}`, {
      headers: { host: "revnet.app" },
    }),
  );
  return response.json();
}

describe("shields badge", () => {
  it("labels each token a treasury holds and totals it in USD", async () => {
    const body = await badge(
      [
        {
          ...deployment,
          // 0.01 ETH plus 20 USDC added as one raw number.
          balance: "10000000020000000",
          projectTokenBalances: {
            items: [
              { token: ETH, tokenSymbol: "ETH", decimals: 18, balance: "10000000000000000" },
              { token: USDC, tokenSymbol: "USDC", decimals: 6, balance: "20000000" },
            ],
          },
        },
      ],
      "37000000000000000000",
    );

    // No USD rates indexed: USDC cannot be converted into ETH, so it is left out and named.
    expect(body).toMatchObject({
      message: "37 USD • 0.01 ETH + 20.00 USDC",
      tvlUsd: 37,
      tvlBalance: 0.01,
      denomination: "ETH",
      tvlExcludedTokens: [{ token: USDC, tokenSymbol: "USDC" }],
    });
    expect(body.chains[0].balance).toBe(0.01);
    // Each token stays readable in its own units.
    expect(body.chains[0].balances).toEqual([
      { token: ETH, tokenSymbol: "ETH", balance: 0.01, balanceUsd: null },
      { token: USDC, tokenSymbol: "USDC", balance: 20, balanceUsd: null },
    ]);
    // Colored by USD, one scale for every token: $37 is red.
    expect(body.color).toBe("red");
  });

  it("converts other tokens into the project's token at their USD rates", async () => {
    const body = await badge(
      [
        {
          ...deployment,
          balance: "10000000020000000",
          projectTokenBalances: {
            items: [
              // $2,000 per ETH and $1 per USDC.
              {
                token: ETH,
                tokenSymbol: "ETH",
                decimals: 18,
                balance: "10000000000000000",
                usdRate: "2000000000000000000000",
              },
              {
                token: USDC,
                tokenSymbol: "USDC",
                decimals: 6,
                balance: "20000000",
                usdRate: "1000000000000000000",
              },
            ],
          },
        },
      ],
      "40000000000000000000",
    );

    // 0.01 ETH plus 20 USDC worth 0.01 ETH.
    expect(body).toMatchObject({ tvlBalance: 0.02, denomination: "ETH", tvlExcludedTokens: [] });
  });

  it("serves Shields' endpoint schema, with the color, for the badge", async () => {
    const body = await badge(
      [{ ...deployment, balance: "1500000000000000000", projectTokenBalances: null }],
      "3000000000000000000000",
      "projectId=8&chainId=1&format=endpoint",
    );

    expect(body).toEqual({
      schemaVersion: 1,
      label: "Breadfruit",
      message: "3,000 USD • 1.5 ETH",
      color: "green",
      cacheSeconds: 3600,
    });
  });

  it("reads one project's group, on Base unless a chain is named", async () => {
    const body = await badge(
      [{ ...deployment, balance: "0", projectTokenBalances: null }],
      null,
      "projectId=8",
    );

    // One project lookup and one group lookup: the same number on another chain is another project.
    expect(mocks.query.mock.calls.map((call) => call[0])).toEqual([8453, 8453]);
    expect(body.markdown).toContain("(https://revnet.app/base:8)");
    expect(decodeURIComponent(body.badgeUrl)).toBe(
      "https://img.shields.io/endpoint?url=https://revnet.app/api/data/shields?projectId=8&chainId=8453&format=endpoint",
    );
  });

  it.each([null, "CASH"])("keeps distinct %s tokens apart", async (tokenSymbol) => {
    const unnamed = (token: string, balance: string) => ({
      token,
      tokenSymbol,
      decimals: 18,
      balance,
    });
    const body = await badge(
      [
        {
          ...deployment,
          balance: "11000000000000000000",
          projectTokenBalances: {
            items: [
              unnamed("0x00000000000000000000000000000000000000aa", "1000000000000000000"),
              unnamed("0x00000000000000000000000000000000000000bb", "10000000000000000000"),
            ],
          },
        },
      ],
      null,
    );

    // Neither can be converted into the project's ETH: both are left out, and both named.
    expect(body).toMatchObject({ tvlBalance: 0, denomination: "ETH" });
    expect(body.tvlExcludedTokens).toEqual([
      { token: "0x00000000000000000000000000000000000000aa", tokenSymbol },
      { token: "0x00000000000000000000000000000000000000bb", tokenSymbol },
    ]);
  });

  it("keeps a one-token amount and leaves out USD the indexer has not priced", async () => {
    const body = await badge(
      [{ ...deployment, balance: "1500000000000000000", projectTokenBalances: null }],
      null,
    );

    expect(body).toMatchObject({
      message: "1.5 ETH",
      tvlUsd: null,
      tvlBalance: 1.5,
      denomination: "ETH",
      // Unpriced: no USD to judge it by.
      color: "lightgrey",
    });
  });
});

describe("pay-event rates", () => {
  it("reads only pays in the accounting token", async () => {
    mocks.query.mockResolvedValue({ payEvents: { items: [] } });

    await fetchPayEventRates(1, 8, "0x000000000000000000000000000000000000EEEe", 18);

    expect(mocks.query).toHaveBeenCalledWith(1, expect.anything(), {
      where: { projectId: 8, chainId: 1, version: 6, token: ETH },
      limit: 500,
      offset: 0,
    });
  });
});
