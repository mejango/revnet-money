import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { LiquidityRangePreview } from "@/app/[slug]/components/v6/owners/market/LiquidityRangePreview";

describe("LiquidityRangePreview", () => {
  it("shows the selected position against the economic and live-price markers", () => {
    const { container } = render(
      <LiquidityRangePreview
        floor={0.001}
        ceiling={0.004}
        current={0.002}
        minimum={0.0008}
        maximum={0.0045}
        pairSymbol="USDC"
        tokenSymbol="ART"
      />,
    );

    expect(
      screen.getByRole("img", { name: "Liquidity range in USDC per ART" }),
    ).toBeInTheDocument();
    expect(container.querySelector("rect")).not.toBeNull();
    expect(screen.getByText("Floor")).toBeInTheDocument();
    expect(screen.getByText("Current pool price")).toBeInTheDocument();
    expect(screen.getByText("Ceiling")).toBeInTheDocument();
  });
});
