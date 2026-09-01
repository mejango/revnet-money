import {
  lpBandPrices,
  lpDeadline,
  prepareAddLiquidity,
  prepareCollectLpFees,
  prepareMoveLiquidity,
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
  pair: { addr: zeroAddress, decimals: 18, symbol: "ETH", currency: 1 },
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
    const plan = prepareRemoveLiquidity(pool, position, recipient, false, 100);
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
      false,
      0,
    );
    expect(plan.pairMinimum).toBe(1n);
    expect(plan.tokenMinimum).toBe(1n);
  });

  // The deadline is stamped when the transaction is PROPOSED. A Safe collects
  // co-signatures for hours or days, so a 20-minute window guarantees the last
  // owner signs a call that can no longer execute.
  it("widens the deadline to 30 days for a Safe and keeps 20 minutes for an EOA", () => {
    expect(lpDeadline(false, 100)).toBe(BigInt(100 + 20 * 60));
    expect(lpDeadline(true, 100)).toBe(BigInt(100 + 30 * 24 * 60 * 60));
    expect(prepareRemoveLiquidity(pool, position, recipient, true, 100).deadline).toBe(
      BigInt(100 + 30 * 24 * 60 * 60),
    );
    expect(prepareCollectLpFees(pool, position, recipient, true, 100).deadline).toBe(
      BigInt(100 + 30 * 24 * 60 * 60),
    );
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

describe("Revnet LP move", () => {
  // wallet-action:move-liquidity
  it("composes burn + mint + closes in one plan, funded by the burn credit", () => {
    const livePool = { ...pool, sqrtP: 2n ** 96n };
    const richPosition = {
      ...position,
      pairAmount: 1_000_000_000_000_000_000n,
      tokenAmount: 1_000_000_000_000_000_000n,
    };
    const plan = prepareMoveLiquidity(
      livePool,
      richPosition,
      { minimumPrice: 0.25, maximumPrice: 4 },
      recipient,
    );

    const [actions, params] = decodeAbiParameters(
      [{ type: "bytes" }, { type: "bytes[]" }],
      plan.unlockData,
    );
    expect(actions).toBe("0x03021212");
    expect(params).toHaveLength(4);

    // Burn: the old tokenId with 95% output floors.
    const [tokenId, amount0Minimum, amount1Minimum] = decodeAbiParameters(
      [{ type: "uint256" }, { type: "uint128" }, { type: "uint128" }, { type: "bytes" }],
      params[0],
    );
    expect(tokenId).toBe(42n);
    expect(amount0Minimum).toBe(plan.pairMinimum);
    expect(amount1Minimum).toBe(plan.tokenMinimum);
    expect(plan.pairMinimum).toBe((richPosition.pairAmount * 9_500n) / 10_000n);

    // Mint: sized inside the burn's proceeds so the credit always covers it.
    expect(plan.mint.liquidity).toBeGreaterThan(0n);
    expect(plan.mint.pairMaximum).toBeLessThanOrEqual(richPosition.pairAmount);
    expect(plan.mint.tokenMaximum).toBeLessThanOrEqual(richPosition.tokenAmount);

    // The embedded mint parameters are byte-identical to the add plan's.
    const [, addParams] = decodeAbiParameters(
      [{ type: "bytes" }, { type: "bytes[]" }],
      plan.mint.unlockData,
    );
    expect(params[1]).toBe(addParams[0]);
  });

  it("maps a position's ticks back to display prices with min below max", () => {
    // pairIsC0 flips the axis: the lower tick is the HIGHER display price.
    const band = lpBandPrices(pool, -60, 60);
    expect(band.minimumPrice).toBeLessThan(band.maximumPrice);
    expect(band.minimumPrice).toBeCloseTo(1.0001 ** -60, 6);
    expect(band.maximumPrice).toBeCloseTo(1.0001 ** 60, 6);
  });
});

describe("Review-dialog V4 plan decoding", () => {
  it("renders a move plan as readable burn/mint/close steps", async () => {
    const { describeV4UnlockData } = await import("@/components/TransactionReviewProvider");
    const plan = prepareMoveLiquidity(
      { ...pool, sqrtP: 2n ** 96n },
      {
        ...position,
        pairAmount: 1_000_000_000_000_000_000n,
        tokenAmount: 1_000_000_000_000_000_000n,
      },
      { minimumPrice: 0.25, maximumPrice: 4 },
      recipient,
    );
    const steps = describeV4UnlockData(plan.unlockData)! as Array<Record<string, unknown>>;
    expect(steps).toHaveLength(4);
    expect(steps[0]).toMatchObject({
      action: "BURN_POSITION",
      position: "#42",
      minimumOut: { currency0: plan.pairMinimum, currency1: plan.tokenMinimum },
    });
    expect(steps[1]).toMatchObject({
      action: "MINT_POSITION",
      owner: recipient,
      ticks: { lower: plan.mint.tickLower, upper: plan.mint.tickUpper },
      liquidity: plan.mint.liquidity,
    });
    expect(steps[2]).toMatchObject({ action: "CLOSE_CURRENCY" });
    expect(String((steps[2] as { currency: string }).currency)).toContain("native ETH");
    expect(steps[3]).toMatchObject({ action: "CLOSE_CURRENCY" });
    // Unknown actions must fall back to the raw view, never a partial story.
    expect(describeV4UnlockData("0xdead")).toBeNull();
  });
});
