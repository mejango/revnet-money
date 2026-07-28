import { getTokenConfigForChain, isNativeToken } from "@/lib/tokenUtils";
import { NATIVE_TOKEN } from "@bananapus/nana-sdk-core";
import { describe, expect, it } from "vitest";

const USDC_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

function groupWith(items: unknown[]) {
  return { suckerGroup: { projects: { items } } };
}

describe("getTokenConfigForChain", () => {
  it("returns null while sucker-group data is missing or loading", () => {
    // A missing group must NEVER default to ETH/18 — a USDC loan rendered as
    // ETH skips the allowance gate and attaches native value.
    expect(getTokenConfigForChain(undefined, 1)).toBeNull();
    expect(getTokenConfigForChain({}, 1)).toBeNull();
    expect(getTokenConfigForChain({ suckerGroup: null }, 1)).toBeNull();
  });

  it("returns null when the chain has no project row or no token", () => {
    const data = groupWith([{ chainId: 1, token: NATIVE_TOKEN, currency: 1, decimals: 18 }]);
    expect(getTokenConfigForChain(data, 8453)).toBeNull();
    expect(getTokenConfigForChain(groupWith([{ chainId: 8453 }]), 8453)).toBeNull();
  });

  it("resolves the chain's accounting token config", () => {
    const data = groupWith([
      { chainId: 8453, token: USDC_BASE, currency: 3, decimals: 6, tokenSymbol: "USDC" },
    ]);
    expect(getTokenConfigForChain(data, 8453)).toEqual({
      token: USDC_BASE,
      currency: 3,
      decimals: 6,
      symbol: "USDC",
    });
  });
});

describe("isNativeToken", () => {
  it("matches the native sentinel case-insensitively", () => {
    expect(isNativeToken(NATIVE_TOKEN)).toBe(true);
    expect(isNativeToken(NATIVE_TOKEN.toLowerCase())).toBe(true);
    expect(isNativeToken(NATIVE_TOKEN.toUpperCase().replace("0X", "0x"))).toBe(true);
  });

  it("rejects ERC-20 addresses and unknowns", () => {
    expect(isNativeToken(USDC_BASE)).toBe(false);
    expect(isNativeToken(undefined)).toBe(false);
    expect(isNativeToken(null)).toBe(false);
  });
});
