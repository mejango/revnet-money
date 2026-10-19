import {
  mapActivityEvents,
  type ActivityEventItem,
} from "@/app/[slug]/components/ActivityFeed/mapActivityEvents";
import { describe, expect, it } from "vitest";

const ETH = "0x000000000000000000000000000000000000eeee";
// The chain's last-set accounting context: what every row used to be labeled with.
const usdcContext = () => ({ tokenSymbol: "USDC", decimals: 6, denominateInUsd: false });

function pay(
  id: string,
  token: string | null,
  decimals: number | null,
  amount = "100000000000000",
) {
  return {
    id,
    chainId: 1,
    timestamp: 1,
    txHash: "0xaaa",
    project: { projectId: 12, version: 6 },
    payEvent: {
      id,
      amount,
      beneficiary: "0x1111111111111111111111111111111111111111",
      memo: null,
      timestamp: 1,
      feeFromProject: null,
      newlyIssuedTokenCount: "0",
      from: "0x2222222222222222222222222222222222222222",
      txHash: "0xaaa",
      amountUsd: "0",
      caller: "0x2222222222222222222222222222222222222222",
      distributionFromProjectId: null,
      projectId: 12,
      project: null,
      token,
      decimals,
    },
  } as unknown as ActivityEventItem;
}

const amountOf = (items: ActivityEventItem[]) => {
  const [row] = mapActivityEvents(items, usdcContext);
  return [row?.baseAmount, row?.baseTokenSymbol];
};

describe("activity amounts use each event's own token", () => {
  // eth:12 accepts ETH then USDC; its 0.0001 ETH pay once read "100,000,000 USDC".
  it("labels an ETH pay as ETH on a chain whose accounting context is USDC", () => {
    expect(amountOf([pay("a", ETH, 18)])).toEqual(["0.0001", "ETH"]);
  });

  it("omits the amount for an unresolved or unknown token, never the context's", () => {
    expect(amountOf([pay("a", null, null)])).toEqual([undefined, undefined]);
    expect(amountOf([pay("a", "0x00000000000000000000000000000000000000aa", 18)])).toEqual([
      undefined,
      undefined,
    ]);
  });

  it("labels a fan-out total only when every pay shares a token", () => {
    expect(amountOf([pay("a", ETH, 18), pay("b", ETH, 18)])).toEqual(["0.0002", "ETH"]);
    expect(
      amountOf([
        pay("a", ETH, 18, "1"),
        pay("b", "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", 6, "2"),
      ]),
    ).toEqual([undefined, undefined]);
  });
});
