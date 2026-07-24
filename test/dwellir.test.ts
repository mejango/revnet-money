import { afterEach, describe, expect, it } from "vitest";
import { getDwellirRpcUrl } from "@/lib/dwellir";

const originalKey = process.env.NEXT_PUBLIC_DWELLIR_API_KEY;
const originalDeterministic = process.env.NEXT_PUBLIC_DETERMINISTIC_BROWSER;
const originalFixture = process.env.NEXT_PUBLIC_RPC_FIXTURE_URL;

afterEach(() => {
  if (originalKey === undefined) delete process.env.NEXT_PUBLIC_DWELLIR_API_KEY;
  else process.env.NEXT_PUBLIC_DWELLIR_API_KEY = originalKey;
  if (originalDeterministic === undefined) {
    delete process.env.NEXT_PUBLIC_DETERMINISTIC_BROWSER;
  } else {
    process.env.NEXT_PUBLIC_DETERMINISTIC_BROWSER = originalDeterministic;
  }
  if (originalFixture === undefined) delete process.env.NEXT_PUBLIC_RPC_FIXTURE_URL;
  else process.env.NEXT_PUBLIC_RPC_FIXTURE_URL = originalFixture;
});

describe("Dwellir RPC configuration", () => {
  it("derives all supported endpoints from one browser-visible key", () => {
    process.env.NEXT_PUBLIC_DWELLIR_API_KEY = "dedicated-browser-key";

    expect(getDwellirRpcUrl(1)).toBe(
      "https://api-ethereum-mainnet.n.dwellir.com/dedicated-browser-key",
    );
    expect(getDwellirRpcUrl(10)).toBe(
      "https://api-optimism-mainnet-archive.n.dwellir.com/dedicated-browser-key",
    );
    expect(getDwellirRpcUrl(8453)).toBe(
      "https://api-base-mainnet-archive.n.dwellir.com/dedicated-browser-key",
    );
    expect(getDwellirRpcUrl(42161)).toBe(
      "https://api-arbitrum-mainnet-archive.n.dwellir.com/dedicated-browser-key",
    );
    expect(getDwellirRpcUrl(11155111)).toBe(
      "https://api-ethereum-sepolia.n.dwellir.com/dedicated-browser-key",
    );
    expect(getDwellirRpcUrl(11155420)).toBe(
      "https://api-optimism-sepolia.n.dwellir.com/dedicated-browser-key",
    );
    expect(getDwellirRpcUrl(84532)).toBe(
      "https://api-base-sepolia-archive.n.dwellir.com/dedicated-browser-key",
    );
    expect(getDwellirRpcUrl(421614)).toBe(
      "https://api-arbitrum-sepolia.n.dwellir.com/dedicated-browser-key",
    );
  });

  it("uses the isolated fixture only in deterministic browser builds", () => {
    process.env.NEXT_PUBLIC_DWELLIR_API_KEY = "dedicated-browser-key";
    process.env.NEXT_PUBLIC_RPC_FIXTURE_URL = "http://127.0.0.1:43111/rpc";
    expect(getDwellirRpcUrl(1)).toContain("dwellir.com");

    process.env.NEXT_PUBLIC_DETERMINISTIC_BROWSER = "true";
    expect(getDwellirRpcUrl(1)).toBe("http://127.0.0.1:43111/rpc");
  });

  it("returns no configured endpoint without a key or for an unsupported chain", () => {
    delete process.env.NEXT_PUBLIC_DWELLIR_API_KEY;
    expect(getDwellirRpcUrl(1)).toBeUndefined();
    process.env.NEXT_PUBLIC_DWELLIR_API_KEY = "dedicated-browser-key";
    expect(getDwellirRpcUrl(999)).toBeUndefined();
  });
});
