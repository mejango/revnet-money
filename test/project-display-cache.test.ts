import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const reads = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("@/lib/bendystraw/query.server", () => ({ queryBendystraw: reads.query }));
vi.mock("@/lib/projectMetadataFill.server", () => ({
  fillIndexedMetadata: async (rows: unknown[]) => rows,
}));

let projects: typeof import("@/app/[slug]/getProject");
let groups: typeof import("@/app/[slug]/getSuckerGroup");
let refresh: typeof import("@/app/[slug]/invalidateProjectDisplay");

const project = (projectId = 7, name = "Example") => ({
  projectId,
  name,
  suckerGroupId: "group",
  token: "0x000000000000000000000000000000000000EEEe",
  decimals: 18,
  currency: "1",
});
const group = (projectId = 7, name = "Example") => ({
  id: "group",
  name,
  projects: { items: [{ projectId, chainId: 1, version: 6 }] },
});

beforeEach(async () => {
  vi.useFakeTimers();
  vi.resetModules();
  projects = await import("@/app/[slug]/getProject");
  groups = await import("@/app/[slug]/getSuckerGroup");
  refresh = await import("@/app/[slug]/invalidateProjectDisplay");
});

afterEach(async () => {
  await vi.runOnlyPendingTimersAsync();
  vi.useRealTimers();
});

describe("server indexed display reuse", () => {
  it("shares in-flight project data between metadata, numeric and bigint callers", async () => {
    let finish!: (value: unknown) => void;
    reads.query.mockReturnValueOnce(new Promise((resolve) => (finish = resolve)));
    const metadata = projects.getProject(7n, 1);
    const layout = projects.getIndexedProject(7, 1);
    const tab = projects.getIndexedProject(7n, 1);
    expect(reads.query).toHaveBeenCalledOnce();
    finish({ project: project() });
    expect(await metadata).toEqual(project());
    expect(await layout).toEqual({ data: project(), status: "available" });
    expect(await tab).toEqual(await layout);
  });

  it("reuses successful reads for 30 seconds, then waits for a fresh result", async () => {
    reads.query.mockResolvedValueOnce({ project: project() });
    await projects.getProject(7, 1);
    await vi.advanceTimersByTimeAsync(29_999);
    expect(await projects.getProject(7n, 1)).toEqual(project());
    expect(reads.query).toHaveBeenCalledOnce();

    await vi.advanceTimersByTimeAsync(1);
    reads.query.mockResolvedValueOnce({ project: project(7, "Updated") });
    expect(await projects.getProject(7, 1)).toEqual(project(7, "Updated"));
    expect(reads.query).toHaveBeenCalledTimes(2);
  });

  it("does not serve expired success through an outage, and retries after recovery", async () => {
    reads.query.mockResolvedValueOnce({ project: project() });
    await projects.getProject(7, 1);
    await vi.advanceTimersByTimeAsync(30_000);
    reads.query.mockRejectedValueOnce(new Error("indexer unavailable"));
    expect(await projects.getIndexedProject(7, 1)).toEqual({ data: null, status: "unavailable" });
    reads.query.mockResolvedValueOnce({ project: project(7, "Recovered") });
    expect(await projects.getProject(7, 1)).toEqual(project(7, "Recovered"));
    expect(reads.query).toHaveBeenCalledTimes(3);
  });

  it("keeps missing and incomplete records retryable without losing partial evidence", async () => {
    reads.query.mockResolvedValueOnce({ project: null });
    expect(await projects.getIndexedProject(7, 1)).toEqual({ data: null, status: "missing" });
    const partial = { ...project(), token: null };
    reads.query.mockResolvedValueOnce({ project: partial });
    expect(await projects.getIndexedProject(7, 1)).toEqual({ data: partial, status: "incomplete" });
    reads.query.mockResolvedValueOnce({ project: project() });
    expect(await projects.getProject(7, 1)).toEqual(project());
    expect(reads.query).toHaveBeenCalledTimes(3);
  });

  it("isolates project and group keys across chains and project IDs", async () => {
    reads.query.mockResolvedValue({ project: project(), suckerGroup: group() });
    await Promise.all([
      projects.getProject(7, 1),
      projects.getProject(8, 1),
      projects.getProject(7, 10),
      groups.getSuckerGroup("group", 1),
      groups.getSuckerGroup("group", 10),
    ]);
    expect(reads.query).toHaveBeenCalledTimes(5);
    await Promise.all([projects.getProject(7n, 1), groups.getSuckerGroup("group", 1)]);
    expect(reads.query).toHaveBeenCalledTimes(5);
  });

  it("invalidates the project and its cross-chain group without evicting unrelated projects", async () => {
    reads.query.mockResolvedValue({ project: project(), suckerGroup: group() });
    await projects.getProject(7, 1);
    await projects.getProject(8, 1);
    await groups.getSuckerGroup("group", 1);
    await groups.getSuckerGroup("group", 10);
    await refresh.refreshProjectDisplay([{ chainId: 1, projectId: 7 }]);
    await projects.getProject(8, 1);
    expect(reads.query).toHaveBeenCalledTimes(4);
    await Promise.all([
      projects.getProject(7, 1),
      groups.getSuckerGroup("group", 1),
      groups.getSuckerGroup("group", 10),
    ]);
    expect(reads.query).toHaveBeenCalledTimes(7);
  });

  it("prevents a canceled older group read from replacing a post-invalidation result", async () => {
    let finishOld!: (value: unknown) => void;
    reads.query.mockReturnValueOnce(new Promise((resolve) => (finishOld = resolve)));
    const old = groups.getIndexedSuckerGroup("group", 1);
    await refresh.refreshProjectDisplay([{ chainId: 1, projectId: 7 }]);
    reads.query.mockResolvedValueOnce({ suckerGroup: group(7, "Current") });
    expect(await groups.getSuckerGroup("group", 1)).toEqual(group(7, "Current"));
    finishOld({ suckerGroup: group(7, "Obsolete") });
    expect(await old).toEqual({ data: null, status: "unavailable" });
    expect(await groups.getSuckerGroup("group", 1)).toEqual(group(7, "Current"));
    expect(reads.query).toHaveBeenCalledTimes(2);
  });

  it("bounds and validates public invalidation arguments", async () => {
    for (const invalid of [
      null,
      [],
      Array(9).fill({ chainId: 1, projectId: 7 }),
      [{ chainId: 9, projectId: 7 }],
      [{ chainId: 1, projectId: -1 }],
    ]) {
      await expect(refresh.refreshProjectDisplay(invalid as never)).rejects.toThrow(
        "Invalid project display refresh",
      );
    }
  });
});
