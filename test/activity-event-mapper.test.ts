import {
  mapActivityEvents,
  type ActivityEventItem,
} from "@/app/[slug]/components/ActivityFeed/mapActivityEvents";
import { describe, expect, it } from "vitest";

const EMPTY_EVENTS = {
  payEvent: null,
  cashOutTokensEvent: null,
  addToBalanceEvent: null,
  mintTokensEvent: null,
  manualMintTokensEvent: null,
  autoIssueEvent: null,
  deployErc20Event: null,
  projectCreateEvent: null,
  projectTransferEvent: null,
  operatorPermissionsSetEvent: null,
  rulesetQueuedEvent: null,
  buybackPoolEvent: null,
};

function payItem(overrides: Partial<ActivityEventItem> = {}): ActivityEventItem {
  return {
    id: "pay-1",
    chainId: 1,
    timestamp: 1_700_000_000,
    txHash: "0xaaa",
    ...EMPTY_EVENTS,
    payEvent: {
      id: "pay-event-1",
      amount: "2000000",
      beneficiary: "0x1111111111111111111111111111111111111111",
      memo: "gm",
      timestamp: 1_700_000_000,
      feeFromProject: null,
      newlyIssuedTokenCount: "3000000000000000000",
      from: "0x2222222222222222222222222222222222222222",
      txHash: "0xaaa",
      amountUsd: "0",
      caller: "0x2222222222222222222222222222222222222222",
      distributionFromProjectId: null,
      projectId: 3,
      project: null,
    },
    ...overrides,
  };
}

describe("mapActivityEvents", () => {
  it("denominates amounts with the context's symbol and decimals", () => {
    const events = mapActivityEvents([payItem()], () => ({ tokenSymbol: "USDC", decimals: 6 }));

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: "in",
      chainId: 1,
      txHash: "0xaaa",
      baseAmount: "2",
      baseTokenSymbol: "USDC",
      tokenCount: "3",
      memo: "gm",
    });
  });

  it("skips rows when the context resolver returns null (project-feed behavior)", () => {
    expect(mapActivityEvents([payItem()], () => null)).toHaveLength(0);
  });

  it("keeps rows and omits the symbol when the context has none (account-feed behavior)", () => {
    const events = mapActivityEvents([payItem()], () => ({ tokenSymbol: null, decimals: null }));

    expect(events).toHaveLength(1);
    expect(events[0].baseTokenSymbol).toBeUndefined();
    // Unknown decimals fall back to 18.
    expect(events[0].baseAmount).toBe("0");
  });

  it("suppresses mintTokensEvent rows already covered by a pay in the same tx", () => {
    const mint: ActivityEventItem = {
      id: "mint-1",
      chainId: 1,
      timestamp: 1_700_000_001,
      txHash: "0xaaa",
      ...EMPTY_EVENTS,
      mintTokensEvent: {
        txHash: "0xaaa",
        timestamp: 1_700_000_001,
        from: "0x2222222222222222222222222222222222222222",
        caller: "0x2222222222222222222222222222222222222222",
        beneficiary: "0x1111111111111111111111111111111111111111",
        beneficiaryTokenCount: "1000000000000000000",
        memo: null,
      },
    };
    const standaloneMint: ActivityEventItem = {
      ...mint,
      id: "mint-2",
      txHash: "0xbbb",
      mintTokensEvent: { ...mint.mintTokensEvent!, txHash: "0xbbb" },
    };

    const events = mapActivityEvents([payItem(), mint, standaloneMint], () => ({
      tokenSymbol: "ETH",
      decimals: 18,
    }));

    expect(events.map((event) => event.id)).toEqual(["pay-1", "mint-2"]);
  });
});
