import { explainCashOutChange } from "@/app/[slug]/components/TokenPrice/explainCashOutChange";
import { describe, expect, it } from "vitest";

const observation = {
  balance: 100n,
  tokenSupply: 100n,
  cashOutTax: 2_000,
  price: 0.8,
};

describe("cash-out price change explanations", () => {
  it("identifies payments and cash outs", () => {
    expect(
      explainCashOutChange(observation, {
        ...observation,
        balance: 120n,
        tokenSupply: 110n,
        price: 0.87,
      }),
    ).toContain("payment added backing and issued tokens");
    expect(
      explainCashOutChange(observation, {
        ...observation,
        balance: 90n,
        tokenSupply: 95n,
        price: 0.76,
      }),
    ).toContain("cash out removed backing and burned tokens");
  });

  it("identifies payouts and tax changes", () => {
    const explanation = explainCashOutChange(observation, {
      ...observation,
      balance: 90n,
      cashOutTax: 3_000,
      price: 0.63,
    });
    expect(explanation).toContain("payout reduced project backing");
    expect(explanation).toContain("cash-out tax changed from 20% to 30%");
  });
});
