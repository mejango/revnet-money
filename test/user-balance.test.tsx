import { UserBalance } from "@/components/layout/UserBalance";
import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const navigation = vi.hoisted(() => ({
  params: {} as { slug?: string },
}));

vi.mock("next/navigation", () => ({
  useParams: () => navigation.params,
}));

beforeEach(() => {
  navigation.params = {};
});

describe("global navigation balance", () => {
  it("does not enter project-only hooks on /create", () => {
    const { container } = render(<UserBalance />);

    expect(container).toBeEmptyDOMElement();
  });
});
