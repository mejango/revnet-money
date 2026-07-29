import {
  prepareAddLiquidity,
  prepareRemoveLiquidity,
  type PoolSnapshot,
  type UserLpPosition,
} from "@/app/[slug]/components/v6/owners/market/lib";
import { decodeAbiParameters, zeroAddress } from "viem";
import { describe, expect, it } from "vitest";

const recipient = "0x1111111111111111111111111111111111111111";
const projectToken = "0x2222222222222222222222222222222222222222";

const pool = {
  chainId: 1,
  hook: "0x3333333333333333333333333333333333333333",
  key: {
    currency0: zeroAddress,
    currency1: projectToken,
    fee: 3_000,
    tickSpacing: 60,
    hooks: "0x3333333333333333333333333333333333333333",
  },
  poolId: `0x${"44".repeat(32)}`,
  sqrtP: 1n,
  pair: { addr: zeroAddress, decimals: 18, symbol: "ETH" },
  pairIsC0: true,
  projectToken,
  price: 1,
  poolManager: "0x5555555555555555555555555555555555555555",
} as PoolSnapshot;

const position = {
  tokenId: 42n,
  owner: recipient,
  info: 1n,
  liquidity: 100n,
  tickLower: -60,
  tickUpper: 60,
  pairAmount: 1_000n,
  tokenAmount: 2_000n,
} as UserLpPosition;

describe("Revnet LP removal", () => {
  // wallet-action:remove-liquidity
  it("encodes a full burn and take-pair with exact 95% output floors", () => {
    const plan = prepareRemoveLiquidity(pool, position, recipient, 100);
    expect(plan.pairMinimum).toBe(950n);
    expect(plan.tokenMinimum).toBe(1_900n);
    expect(plan.deadline).toBe(1_300n);

    const [actions, params] = decodeAbiParameters(
      [{ type: "bytes" }, { type: "bytes[]" }],
      plan.unlockData,
    );
    expect(actions).toBe("0x0311");
    const [tokenId, amount0Minimum, amount1Minimum] = decodeAbiParameters(
      [{ type: "uint256" }, { type: "uint128" }, { type: "uint128" }, { type: "bytes" }],
      params[0],
    );
    expect(tokenId).toBe(42n);
    expect(amount0Minimum).toBe(950n);
    expect(amount1Minimum).toBe(1_900n);
  });

  it("keeps positive dust returns protected by a nonzero minimum", () => {
    const plan = prepareRemoveLiquidity(
      pool,
      { ...position, pairAmount: 1n, tokenAmount: 1n },
      recipient,
      0,
    );
    expect(plan.pairMinimum).toBe(1n);
    expect(plan.tokenMinimum).toBe(1n);
  });
});

describe("Revnet LP entry", () => {
  // wallet-action:add-liquidity
  // wallet-action:liquidity-management
  it("encodes a bounded mint with Permit2 token settlement and native refund", () => {
    const plan = prepareAddLiquidity(
      { ...pool, sqrtP: 2n ** 96n },
      {
        pairAmount: 1_000_000_000_000_000_000n,
        tokenAmount: 1_000_000_000_000_000_000n,
      },
      { minimumPrice: 0.5, maximumPrice: 2 },
      recipient,
    );

    expect(plan.liquidity).toBeGreaterThan(0n);
    expect(plan.value).toBe(plan.pairMaximum);
    expect(plan.erc20Sides).toEqual([{ currency: projectToken, max: plan.tokenMaximum }]);
    const [actions] = decodeAbiParameters(
      [{ type: "bytes" }, { type: "bytes[]" }],
      plan.unlockData,
    );
    expect(actions).toBe("0x02121214");
  });
});
