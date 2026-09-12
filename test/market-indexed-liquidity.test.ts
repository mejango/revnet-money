import {
  fetchPoolComposition,
  readPoolLpPositions,
  readUserLpPositions,
  type PoolSnapshot,
} from "@/app/[slug]/components/v6/owners/market/lib";
import {
  IndexedLpPositionsOperation,
  IndexedPoolRangesOperation,
} from "@/lib/bendystraw/operations";
import {
  UNISWAP_V4_INITIALIZE_TOPIC,
  uniswapV4SqrtPriceX96AtTick,
} from "@bananapus/nana-sdk-core/v6";
import { zeroAddress } from "viem";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  getBlockNumber: vi.fn(),
  getLogs: vi.fn(),
  request: vi.fn(),
  client: vi.fn(),
}));
vi.mock("@/lib/bendystraw/client", () => ({ queryBendystrawFromBrowser: mocks.query }));
vi.mock("@/lib/wagmiTransports", () => ({ getViemPublicClient: mocks.client }));

const owner = "0x1111111111111111111111111111111111111111";
const projectToken = "0x2222222222222222222222222222222222222222";
let sequence = 0;
let pool: PoolSnapshot;

function range(overrides = {}) {
  return {
    chainId: pool.chainId,
    projectId: pool.projectId,
    version: 6,
    poolId: pool.poolId,
    tickLower: -60,
    tickUpper: 60,
    liquidity: "1000000000000000000",
    ...overrides,
  };
}

function position(tokenId = 1, overrides = {}) {
  return {
    chainId: pool.chainId,
    poolId: pool.poolId,
    tokenId: String(tokenId),
    owner,
    tickLower: -60,
    tickUpper: 60,
    liquidity: "1000000000000000000",
    feesClaimed0: "12",
    feesClaimed1: "34",
    ...overrides,
  };
}

beforeEach(() => {
  pool = {
    chainId: 1,
    projectId: 1,
    hook: zeroAddress,
    key: {
      currency0: zeroAddress,
      currency1: projectToken,
      fee: 3_000,
      tickSpacing: 60,
      hooks: zeroAddress,
    },
    poolId: `0x${(++sequence).toString(16).padStart(64, "0")}`,
    sqrtP: uniswapV4SqrtPriceX96AtTick(0),
    pair: { addr: zeroAddress, decimals: 18, symbol: "ETH", currency: 1 },
    pairIsC0: true,
    projectToken,
    price: 1,
    poolManager: "0x5555555555555555555555555555555555555555",
  };
  mocks.client.mockReturnValue(mocks);
  mocks.getBlockNumber.mockResolvedValue(100n);
  mocks.getLogs.mockImplementation(async ({ event }) =>
    event.name === "Initialize"
      ? [{ blockNumber: 1n }]
      : [{ blockNumber: 2n, args: { tickLower: -120, tickUpper: 120, liquidityDelta: 9n } }],
  );
  mocks.request.mockResolvedValue([{ topics: [UNISWAP_V4_INITIALIZE_TOPIC], blockNumber: 1n }]);
});

describe("indexed pool composition", () => {
  it("values all net ranges at the live price without downloading liquidity history", async () => {
    mocks.query
      .mockResolvedValueOnce({ buybackPoolRanges: { totalCount: 2, items: [range()] } })
      .mockResolvedValueOnce({
        buybackPoolRanges: { totalCount: 2, items: [range({ tickUpper: 120 })] },
      });

    const composition = await fetchPoolComposition(pool);
    expect(composition?.ranges).toHaveLength(2);
    expect(composition?.pairAmount).toBeGreaterThan(0n);
    expect(composition?.tokenAmount).toBeGreaterThan(0n);
    expect(mocks.query).toHaveBeenNthCalledWith(
      2,
      IndexedPoolRangesOperation,
      {
        chainId: 1,
        projectId: 1,
        version: 6,
        poolId: pool.poolId,
        limit: 1000,
        offset: 1,
      },
      1,
    );
    expect(mocks.client).not.toHaveBeenCalled();

    mocks.query.mockResolvedValue({ buybackPoolRanges: { totalCount: 1, items: [range()] } });
    const aboveRange = await fetchPoolComposition({
      ...pool,
      sqrtP: uniswapV4SqrtPriceX96AtTick(180),
    });
    expect(aboveRange?.pairAmount).toBe(0n);
    expect(aboveRange?.tokenAmount).toBeGreaterThan(0n);
    const reversedPair = await fetchPoolComposition({
      ...pool,
      pairIsC0: false,
      sqrtP: uniswapV4SqrtPriceX96AtTick(180),
    });
    expect(reversedPair?.tokenAmount).toBe(0n);
    expect(reversedPair?.pairAmount).toBe(aboveRange?.tokenAmount);
  });

  it("keeps explicit zero ranges as a known withdrawn pool", async () => {
    mocks.query.mockResolvedValue({
      buybackPoolRanges: { totalCount: 1, items: [range({ liquidity: "0" })] },
    });
    await expect(fetchPoolComposition(pool)).resolves.toEqual({
      pairAmount: 0n,
      tokenAmount: 0n,
      ranges: [],
    });
    expect(mocks.client).not.toHaveBeenCalled();
  });

  it.each([
    ["no rows", () => ({ totalCount: 0, items: [] })],
    ["wrong chain", () => ({ totalCount: 1, items: [range({ chainId: 10 })] })],
    ["wrong project", () => ({ totalCount: 1, items: [range({ projectId: 2 })] })],
    ["wrong version", () => ({ totalCount: 1, items: [range({ version: 5 })] })],
    ["wrong pool", () => ({ totalCount: 1, items: [range({ poolId: zeroAddress })] })],
    ["invalid range", () => ({ totalCount: 1, items: [range({ tickLower: 60 })] })],
    ["negative liquidity", () => ({ totalCount: 1, items: [range({ liquidity: "-1" })] })],
    ["missing count", () => ({ items: [range()] })],
    ["duplicate ranges", () => ({ totalCount: 2, items: [range(), range()] })],
  ])("uses complete RPC history for %s", async (_name, response) => {
    mocks.query.mockResolvedValue({ buybackPoolRanges: response() });
    const composition = await fetchPoolComposition(pool);
    expect(composition?.ranges).toEqual([{ tickLower: -120, tickUpper: 120, liquidity: 9n }]);
    expect(mocks.getLogs).toHaveBeenCalledTimes(2);
  });

  it.each(["truncated", "changed"])(
    "rejects %s pagination instead of showing partial reserves",
    async (kind) => {
      mocks.query
        .mockResolvedValueOnce({ buybackPoolRanges: { totalCount: 2, items: [range()] } })
        .mockResolvedValueOnce({
          buybackPoolRanges: { totalCount: kind === "changed" ? 1 : 2, items: [] },
        });
      expect((await fetchPoolComposition(pool))?.ranges[0].liquidity).toBe(9n);
    },
  );
});

describe("indexed LP ownership", () => {
  it("includes positions past the first 250 and retains ownership and claimed fees", async () => {
    mocks.query.mockImplementation(async (_operation, { offset }) => ({
      buybackPoolPositions: {
        totalCount: 251,
        items:
          offset === 0
            ? Array.from({ length: 250 }, (_, i) => position(i + 1, { owner: projectToken }))
            : [position(251)],
      },
    }));
    const positions = await readPoolLpPositions(pool);
    expect(positions).toHaveLength(251);
    expect(positions[250]).toMatchObject({
      tokenId: 251n,
      owner,
      claimedPairFees: 12n,
      claimedTokenFees: 34n,
    });
    expect(mocks.query).toHaveBeenNthCalledWith(
      2,
      IndexedLpPositionsOperation,
      {
        chainId: 1,
        poolId: pool.poolId,
        limit: 250,
        offset: 250,
      },
      1,
    );
    expect((await readUserLpPositions(pool, owner)).map((item) => item.tokenId)).toEqual([251n]);
    expect(mocks.client).not.toHaveBeenCalled();
  });

  it.each(["truncated", "duplicate", "wrong pool"])(
    "falls back rather than accepting %s position pages",
    async (kind) => {
      mocks.query
        .mockResolvedValueOnce({ buybackPoolPositions: { totalCount: 2, items: [position()] } })
        .mockResolvedValueOnce({
          buybackPoolPositions: {
            totalCount: 2,
            items:
              kind === "truncated"
                ? []
                : [
                    position(
                      kind === "duplicate" ? 1 : 2,
                      kind === "wrong pool" ? { poolId: zeroAddress } : {},
                    ),
                  ],
          },
        });
      await expect(readPoolLpPositions(pool)).resolves.toEqual([]);
      expect(mocks.request).toHaveBeenCalledOnce();
    },
  );
});
