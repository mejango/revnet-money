import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  emptyProfile: { address: "0xempty", name: "Empty" },
  fetchProfile: vi.fn(),
  request: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({
  unstable_cache: (callback: (...args: never[]) => unknown) => callback,
}));
vi.mock("@/lib/emptyProfile", () => ({
  getEmptyProfile: () => mocks.emptyProfile,
}));
vi.mock("@/lib/profile", () => ({
  fetchProfile: mocks.fetchProfile,
}));
vi.mock("@/graphql/bendystrawClient", () => ({
  getBendystrawClient: () => ({ request: mocks.request }),
}));

import { getProjectOperator } from "@/app/[slug]/getProjectOperator";
import { Profile } from "@/components/Profile";

describe("server-only profile modules", () => {
  beforeEach(() => {
    mocks.fetchProfile.mockReset();
    mocks.request.mockReset();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  it("renders the deterministic empty profile while the fetched profile resolves", async () => {
    const profile = { address: "0xoperator", name: "Operator" };
    const children = vi.fn((value) => value.name);
    mocks.fetchProfile.mockResolvedValue(profile);

    const element = await Profile({ address: "0xoperator", children });

    expect(element.props.fallback).toBe("Empty");
    expect(element.props.children).toBe("Operator");
    expect(mocks.fetchProfile).toHaveBeenCalledWith("0xoperator");
  });

  it("resolves the indexed operator address to its profile", async () => {
    const profile = { address: "0xoperator", name: "Operator" };
    mocks.request.mockResolvedValue({
      permissionHolders: { items: [{ operator: "0xoperator" }] },
    });
    mocks.fetchProfile.mockResolvedValue(profile);

    await expect(getProjectOperator(7, 8453)).resolves.toEqual(profile);
    expect(mocks.request).toHaveBeenCalledWith(expect.anything(), {
      chainId: 8453,
      projectId: 7,
      version: 6,
    });
  });

  it("fails closed when the indexed operator lookup is unavailable", async () => {
    mocks.request.mockRejectedValue(new Error("index unavailable"));

    await expect(getProjectOperator(7, 8453)).resolves.toBeNull();
    expect(mocks.fetchProfile).not.toHaveBeenCalled();
  });
});
