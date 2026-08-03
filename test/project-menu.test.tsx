import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  segment: null as string | null,
}));

vi.mock("next/navigation", () => ({
  useParams: () => ({ slug: "base:42" }),
  useSelectedLayoutSegment: () => mocks.segment,
}));

import { ProjectMenu } from "@/app/[slug]/components/ProjectMenu";

describe("ProjectMenu", () => {
  it("keeps public sections on the tab bar and moves privileged sections into More", () => {
    mocks.segment = null;
    render(<ProjectMenu />);

    expect(screen.getByRole("link", { name: "Overview" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Owners" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Extras" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "More project sections" }));
    expect(screen.getByRole("menuitem", { name: "Extras" })).toHaveAttribute(
      "href",
      "/base:42/extras",
    );
    expect(screen.getByRole("menuitem", { name: "Operator" })).toHaveAttribute(
      "href",
      "/base:42/operator",
    );
  });

  it("names the active overflow section from the current route", () => {
    mocks.segment = "operator";
    render(<ProjectMenu />);

    expect(
      screen.getByRole("button", {
        name: "More project sections, current: Operator",
      }),
    ).toBeInTheDocument();
  });
});
