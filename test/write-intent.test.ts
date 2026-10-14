import {
  batchIntentOf,
  cashOutIntent,
  payIntent,
  reallocateIntent,
  withWriteIntent,
  writeIntentOf,
} from "@/lib/write-hold";
import { intent, writeIntentKey, type IntentValue } from "@bananapus/nana-sdk-core/review";
import { parseAbi } from "viem";
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
      amount: 10n,
      memo: "Hi",
      beneficiary: TOKEN,
      hook: HOOK,
      items: [],
      ...overrides,
    });

  it("keys an ordinary payment by its typed amount", () => {
    expect(key(pay())).not.toBe(key(pay({ amount: 11n })));
  });

  it("keys a checkout by its tiers and quantities, never by a price-derived amount or a name", () => {
    const cart = [
      { tierId: 2, quantity: 1, name: "B" },
      { tierId: 1, quantity: 3, name: "A" },
    ];
    const checkout = key(pay({ items: cart }));
    expect(
      key(
        pay({
          amount: 99n,
          items: [
            { tierId: 1, quantity: 3, name: "Renamed" },
            { tierId: 2, quantity: 1, name: "B" },
          ],
        }),
      ),
    ).toBe(checkout);
    expect(key(pay({ items: [{ tierId: 1, quantity: 2, name: "A" }, cart[0]!] }))).not.toBe(
      checkout,
    );
  });
});

describe("a collateral reallocation's intent", () => {
  it("leaves out the collateral moved, which follows the loan's current capacity", () => {
    const at = (moved: bigint) =>
      key(
        reallocateIntent({
          loanId: "5",
          token: TOKEN,
          collateralCountToTransfer: moved,
          collateralCountToAdd: 4n,
          prepaidFeePercent: 25n,
        }),
      );
    expect(at(10n)).toBe(at(12n));
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

describe("an amount the user filled with a share button", () => {
  const cashOut = (amount: bigint, share?: number) =>
    key(cashOutIntent({ projectId: 7, token: TOKEN, amount, beneficiary: TOKEN, share }));

  it("is keyed as that share, so a balance that moved meanwhile is the same intent", () => {
    expect(cashOut(10n, 100)).toBe(cashOut(12n, 100));
    expect(cashOut(10n, 100)).not.toBe(cashOut(10n, 50));
  });

  it("keeps a typed amount as typed", () => {
    expect(cashOut(10n)).not.toBe(cashOut(12n));
    expect(cashOut(10n)).not.toBe(cashOut(10n, 100));
  });
});
