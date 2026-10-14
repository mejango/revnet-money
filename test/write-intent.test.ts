import {
  batchIntentOf,
  cashOutIntent,
  payIntent,
  reallocateIntent,
  syncIntent,
  withWriteIntent,
  writeIntentOf,
} from "@/lib/write-hold";
import { intent, writeIntentKey, type IntentValue } from "@bananapus/nana-sdk-core/review";
import { encodeAbiParameters, parseAbi, type Hex } from "viem";
import { describe, expect, it } from "vitest";

/** The intent `params` give a write. */
const intentOf = (params: { [name: string]: IntentValue }) => {
  let seen: unknown;
  withWriteIntent((variables: object) => (seen = variables), "pay", params)({});
  return writeIntentOf(seen as never);
};

describe("write intent keys", () => {
  it("keep free text as typed, and compare tagged addresses case-blind", () => {
    expect(intentOf({ memo: "0xAbC" })).not.toBe(intentOf({ memo: "0xabc" }));
    expect(intentOf({ memo: "Hello" })).not.toBe(intentOf({ memo: "hello" }));
    expect(intentOf({ token: intent.address("0x000000000000000000000000000000000000dEaD") })).toBe(
      intentOf({ token: intent.address("0x000000000000000000000000000000000000dead") }),
    );
  });
});

const TOKEN = "0x000000000000000000000000000000000000dEaD";
const HOOK = "0x0000000000000000000000000000000000001000";
const key = ([action, params]: ReturnType<typeof payIntent>) => writeIntentKey(action, params);

describe("a payment's intent", () => {
  const pay = (overrides: Partial<Parameters<typeof payIntent>[0]> = {}) =>
    payIntent({
      mode: "pay",
      projectId: 7,
      token: TOKEN,
      amount: "10",
      memo: "Hi",
      beneficiary: TOKEN,
      hook: HOOK,
      items: [],
      ...overrides,
    });

  it("keys a pay token the app defaulted to as auto, whatever token it resolved to", () => {
    expect(key(pay({ token: "auto" }))).toBe(key(pay({ token: "auto" })));
    expect(key(pay({ token: "auto" }))).not.toBe(key(pay()));
  });

  it("keys an ordinary payment by its typed decimal, written any way", () => {
    expect(key(pay({ amount: "10" }))).toBe(key(pay({ amount: "010.00" })));
    expect(key(pay())).not.toBe(key(pay({ amount: "11" })));
  });

  it("holds a checkout by its project and collection alone, whatever tiers inventory leaves", () => {
    const checkout = key(
      pay({
        items: [
          { tierId: 1, quantity: 3, name: "A" },
          { tierId: 2, quantity: 1, name: "B" },
        ],
      }),
    );
    // Tier 1 sold out and left the cart.
    expect(key(pay({ items: [{ tierId: 2, quantity: 1, name: "B" }], amount: "4" }))).toBe(
      checkout,
    );
    expect(key(pay({ items: [{ tierId: 2, quantity: 1, name: "B" }], hook: TOKEN }))).not.toBe(
      checkout,
    );
  });
});

describe("a collateral reallocation's intent", () => {
  it("is its loan alone, whatever collateral or fee a reseed gives it", () => {
    // A reseed's collateral and fee can't reach it: its only input is the loan.
    expect(key(reallocateIntent({ loanId: "5" }))).toBe(key(reallocateIntent({ loanId: 5n })));
    expect(key(reallocateIntent({ loanId: "5" }))).not.toBe(key(reallocateIntent({ loanId: "6" })));
  });
});

describe("a sucker sync's intent", () => {
  it("is its sucker alone, not the bridge fee recalculated on reopen", () => {
    expect(writeIntentOf({ address: HOOK, functionName: "syncAccountingData", args: [] })).toBe(
      writeIntentOf({ address: HOOK, functionName: "syncAccountingData", args: [] }),
    );
    expect(key(syncIntent(HOOK))).toBe(key(syncIntent(HOOK)));
    expect(key(syncIntent(HOOK))).not.toBe(key(syncIntent(TOKEN)));
  });
});

describe("approval intents", () => {
  const PERMIT2 = parseAbi([
    "function approve(address token, address spender, uint160 amount, uint48 expiration)",
  ]);
  const ERC20 = parseAbi(["function approve(address spender, uint256 amount)"]);

  it("hold one Permit2 approval per token and spender, whatever amount a quote gives it", () => {
    const approve = (amount: bigint) =>
      writeIntentOf({ address: HOOK, functionName: "approve", args: [TOKEN, HOOK, amount, 9] });
    expect(approve(5n)).toBe(approve(6n));
  });

  it("key a batch's ERC-20 approval by its spender, not the re-quoted amount", () => {
    const batch = (amount: bigint) =>
      batchIntentOf([
        { address: TOKEN, abi: ERC20, functionName: "approve", args: [HOOK, amount] },
        { address: HOOK, abi: PERMIT2, functionName: "approve", args: [TOKEN, HOOK, amount, 9] },
      ]);
    expect(batch(5n)).toBe(batch(6n));
  });
});

describe("an amount keyed by where it came from", () => {
  const cashOut = (amount: IntentValue) =>
    key(cashOutIntent({ projectId: 7, token: TOKEN, amount, beneficiary: TOKEN }));

  it("keys an option the user picked by its name, so a balance that moved is the same intent", () => {
    expect(cashOut("policy:max")).toBe(cashOut("policy:max"));
    expect(cashOut("policy:max")).not.toBe(cashOut("policy:25%"));
    expect(cashOut("policy:max")).not.toBe(cashOut(10n));
  });

  it("keeps a typed amount as its parsed value", () => {
    expect(cashOut(10n)).not.toBe(cashOut(12n));
    expect(cashOut(10n)).toBe(cashOut(10n));
  });
});

describe("a liquidity write's intent", () => {
  const POOL = {
    currency0: TOKEN,
    currency1: HOOK,
    fee: 3000,
    tickSpacing: 60,
    hooks: "0x0000000000000000000000000000000000000000",
  } as const;
  const encode = (actions: Hex, params: Hex[]) =>
    encodeAbiParameters([{ type: "bytes" }, { type: "bytes[]" }], [actions, params]);
  const onToken = (tokenId: bigint, amount: bigint) =>
    encodeAbiParameters(
      [{ type: "uint256" }, { type: "uint256" }, { type: "uint128" }],
      [tokenId, amount, amount],
    );
  const mint = (lower: number) =>
    encodeAbiParameters(
      [
        {
          type: "tuple",
          components: [
            { type: "address" },
            { type: "address" },
            { type: "uint24" },
            { type: "int24" },
            { type: "address" },
          ],
        },
        { type: "int24" },
        { type: "int24" },
      ],
      [[POOL.currency0, POOL.currency1, POOL.fee, POOL.tickSpacing, POOL.hooks], lower, lower + 60],
    );
  const settle = encodeAbiParameters([{ type: "address" }], [TOKEN]);
  const lp = (unlockData: Hex) =>
    writeIntentOf({ address: HOOK, functionName: "modifyLiquidities", args: [unlockData, 1n] });

  it("is one intent per position, whether the app builds an increase or a decrease", () => {
    expect(lp(encode("0x0012", [onToken(5n, 1n), settle]))).toBe(
      lp(encode("0x0111", [onToken(5n, 2n), settle])),
    );
    expect(lp(encode("0x0012", [onToken(5n, 1n), settle]))).not.toBe(
      lp(encode("0x0012", [onToken(6n, 1n), settle])),
    );
  });

  it("is one intent per pool for a mint, however many positions the app mints", () => {
    expect(lp(encode("0x0212", [mint(0), settle]))).toBe(
      lp(encode("0x020212", [mint(0), mint(120), settle])),
    );
  });
});
