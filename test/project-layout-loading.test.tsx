import { beforeEach, describe, expect, it, vi } from "vitest";

const reads = vi.hoisted(() => ({
  route: vi.fn(),
  project: vi.fn(),
  group: vi.fn(),
  rulesets: vi.fn(),
  operator: vi.fn(),
  notFound: vi.fn(() => {
    throw new Error("not found");
  }),
}));

vi.mock("next/navigation", () => ({ notFound: reads.notFound }));
vi.mock("@/components/layout/Nav", () => ({ Nav: "nav" }));
vi.mock("@/app/[slug]/canonicalHandle.server", () => ({ lookupCanonicalHandle: vi.fn() }));
vi.mock("@/app/[slug]/resolveProjectRoute.server", () => ({ resolveProjectRoute: reads.route }));
vi.mock("@/app/[slug]/getProjectFallback", () => ({ getProjectWithFallback: reads.project }));
vi.mock("@/app/[slug]/getProject", () => ({ getProject: vi.fn() }));
vi.mock("@/app/[slug]/getSuckerGroup", () => ({
  getIndexedSuckerGroup: reads.group,
  getSuckerGroup: vi.fn(),
}));
vi.mock("@/app/[slug]/terms/getRulesets", () => ({ getRulesets: reads.rulesets }));
vi.mock("@/app/[slug]/getProjectOperator", () => ({ getProjectOperator: reads.operator }));
vi.mock("@/app/[slug]/components/ActivityFeed/ActivityFeed", () => ({ ActivityFeed: "activity" }));
vi.mock("@/app/[slug]/components/Header/Header", () => ({ Header: "header" }));
vi.mock("@/app/[slug]/components/NewProjectNotice", () => ({ NewProjectNotice: "notice" }));
vi.mock("@/app/[slug]/components/PayCard/PayCard", () => ({ PayCard: "pay" }));
vi.mock("@/app/[slug]/components/ProjectDiagnostics", () => ({
  ProjectDataNotice: "data-notice",
  ProjectDiagnosticsProvider: "diagnostics",
}));
vi.mock("@/app/[slug]/components/ResponsiveProjectLayout", () => ({
  ResponsiveProjectLayout: "responsive-layout",
}));
vi.mock("@/app/[slug]/components/v6/ShopCartContext", () => ({ ShopCartProvider: "shop-cart" }));
vi.mock("@/app/[slug]/ProjectProviders", () => ({ ProjectProviders: "project-providers" }));

import SlugLayout from "@/app/[slug]/layout";

const props = { params: Promise.resolve({ slug: "eth:1" }), children: "tab content" };

beforeEach(() => {
  reads.route.mockResolvedValue({ chainId: 1, projectId: 1n });
  reads.project.mockResolvedValue({
    project: { projectId: 1, name: "Example", suckerGroupId: "group", isRevnet: true },
    degraded: false,
    indexStatus: "available",
  });
  reads.group.mockResolvedValue({
    data: { id: "group", projects: { items: [{ chainId: 1, projectId: 1, version: 6 }] } },
    status: "available",
  });
  reads.rulesets.mockResolvedValue([]);
  reads.operator.mockResolvedValue(null);
});

describe("project layout resolution", () => {
  it("finishes route and project existence checks before preparing secondary content", async () => {
    reads.route.mockResolvedValueOnce(null);
    await expect(SlugLayout(props)).rejects.toThrow("not found");
    expect(reads.project).not.toHaveBeenCalled();
    expect(reads.group).not.toHaveBeenCalled();

    reads.project.mockResolvedValueOnce(null);
    await expect(SlugLayout(props)).rejects.toThrow("not found");
    expect(reads.group).not.toHaveBeenCalled();
  });

  it("propagates unavailable existence evidence without declaring the project missing", async () => {
    reads.project.mockRejectedValueOnce(new Error("RPC unavailable"));
    await expect(SlugLayout(props)).rejects.toThrow("RPC unavailable");
    expect(reads.notFound).not.toHaveBeenCalled();
    expect(reads.group).not.toHaveBeenCalled();
  });

  it("starts group and ruleset reads together and awaits them before resolving the layout", async () => {
    let finishGroup!: (value: unknown) => void;
    reads.group.mockReturnValueOnce(new Promise((resolve) => (finishGroup = resolve)));
    let settled = false;
    const layout = SlugLayout(props).then((result) => {
      settled = true;
      return result;
    });
    await vi.waitFor(() => expect(reads.rulesets).toHaveBeenCalledOnce());
    expect(settled).toBe(false);
    finishGroup({ data: null, status: "unavailable" });
    await layout;
    expect(settled).toBe(true);
    expect(reads.notFound).not.toHaveBeenCalled();
  });
});
