import { formatProjectPreviewBalance, projectPreviewSlogan } from "@/lib/project-link-preview";
import { describe, expect, it } from "vitest";

describe("project link preview balance", () => {
  it("adds matching balances across chains", () => {
    expect(
      formatProjectPreviewBalance([
        { balance: "1250000", decimals: 6, tokenSymbol: "USDC" },
        { balance: "2750000", decimals: 6, tokenSymbol: "USDC" },
      ]),
    ).toBe("4.00 USDC");
  });

  it("keeps unlike accounting tokens separate", () => {
    expect(
      formatProjectPreviewBalance([
        { balance: "1500000000000000000", decimals: 18, tokenSymbol: "ETH" },
        { balance: "2500000", decimals: 6, tokenSymbol: "USDC" },
      ]),
    ).toBe("1.5 ETH + 2.50 USDC");
  });

  it("reads each token a deployment holds instead of its mixed raw balance", () => {
    expect(
      formatProjectPreviewBalance([
        {
          // ETH and USDC wei added together: neither token's units.
          balance: "10000000020000000",
          decimals: 18,
          tokenSymbol: "ETH",
          projectTokenBalances: {
            items: [
              {
                token: "0x000000000000000000000000000000000000eeee",
                tokenSymbol: "ETH",
                decimals: 18,
                balance: "10000000000000000",
              },
              {
                token: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
                tokenSymbol: null,
                decimals: 6,
                balance: "20000000",
              },
            ],
          },
        },
        // No rows: an empty treasury, read from its raw balance.
        { balance: "0", decimals: 18, tokenSymbol: "ETH", projectTokenBalances: { items: [] } },
      ]),
    ).toBe("0.01 ETH + 20.00 USDC");
  });

  it("leaves out a token the project no longer holds", () => {
    expect(
      formatProjectPreviewBalance([
        { balance: "1500000000000000000", decimals: 18, tokenSymbol: "ETH" },
        { balance: "0", decimals: 6, tokenSymbol: "USDC" },
      ]),
    ).toBe("1.5 ETH");
  });

  it("renders unknown rather than treating malformed rows as zero", () => {
    expect(
      formatProjectPreviewBalance([
        { balance: "bad", decimals: 18, tokenSymbol: "ETH" },
        { balance: "12", decimals: null, tokenSymbol: "USDC" },
      ]),
    ).toBe("Unavailable");
  });

  it("uses a plain-text description when there is no dedicated tagline", () => {
    expect(projectPreviewSlogan(null, "<p>Join our <b>creative</b> mission.</p>")).toBe(
      "Join our creative mission.",
    );
  });
});
