import {
  addPermit2SignatureToDirectPaySwap,
  buildDirectPaySwapTx,
  permit2SignatureNeedsOnchainFallback,
  permit2TypedData,
  type DirectSwapQuote,
  type Permit2SignatureAuthorization,
} from "@/lib/directPaySwap";
import { zeroAddress, type Address, type Hex } from "viem";
import { describe, expect, it } from "vitest";

const TOKEN = "0x1111111111111111111111111111111111111111" as Address;
const OUTPUT = "0x2222222222222222222222222222222222222222" as Address;
const RECIPIENT = "0x3333333333333333333333333333333333333333" as Address;
const HOOK = "0x4444444444444444444444444444444444444444" as Address;
const SIGNATURE = `0x${"55".repeat(65)}` as Hex;

function fixture() {
  const quote: DirectSwapQuote = {
    kind: "direct-swap",
    poolKey: {
      currency0: TOKEN,
      currency1: OUTPUT,
      fee: 10_000,
      tickSpacing: 200,
      hooks: HOOK,
    },
    zeroForOne: true,
    quotedTokenCount: 101n,
    beneficiaryTokenCount: 100n,
    reservedTokenCount: 0n,
  };
  const request = buildDirectPaySwapTx({
    chainId: 8453,
    quote,
    amount: 25_000_000n,
    recipient: RECIPIENT,
    deadline: 1_800_000_000n,
  });
  const authorization: Permit2SignatureAuthorization = {
    chainId: 8453,
    token: TOKEN,
    spender: request.address,
    amount: 25_000_000n,
    expiration: 1_799_999_900,
    nonce: 7,
    sigDeadline: 1_799_999_900n,
  };
  return { request, authorization };
}

describe("Revnet Permit2 direct-pay signatures", () => {
  it("prepends the reviewed PermitSingle to the exact V4 swap", () => {
    const { request, authorization } = fixture();
    const signed = addPermit2SignatureToDirectPaySwap(request, authorization, SIGNATURE);

    expect(signed.args[0]).toBe("0x0a10");
    expect(signed.args[1]).toHaveLength(2);
    expect(signed.args[1][1]).toBe(request.args[1][0]);
    expect(signed.args[1][0].toLowerCase()).toContain(SIGNATURE.slice(2).toLowerCase());
    expect(signed.args[2]).toBe(request.args[2]);
    expect(permit2TypedData(authorization).message.details.nonce).toBe(7);
  });

  it("fails closed on a mismatched router and never falls back after rejection", () => {
    const { request, authorization } = fixture();
    expect(() =>
      addPermit2SignatureToDirectPaySwap(
        request,
        { ...authorization, spender: zeroAddress },
        SIGNATURE,
      ),
    ).toThrow(/does not match/i);
    expect(
      permit2SignatureNeedsOnchainFallback({ code: 4001, message: "User rejected the request" }),
    ).toBe(false);
    expect(
      permit2SignatureNeedsOnchainFallback({ code: -32602, message: "Invalid parameters" }),
    ).toBe(true);
  });
});
