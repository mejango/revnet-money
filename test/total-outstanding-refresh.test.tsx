import { useTotalOutstandingTokens } from "@/hooks/useTotalOutstandingTokens";
import { renderHook } from "@testing-library/react";
import { expect, it, vi } from "vitest";

const query = vi.hoisted(() => vi.fn());
vi.mock("@/lib/bendystraw", () => ({
  ProjectOperation: { id: "project" },
  SuckerGroupOperation: { id: "group" },
  useBendystrawQuery: query,
}));
vi.mock("@/lib/nana/project", () => ({
  useJBChainId: () => 1,
  useJBContractContext: () => ({ projectId: 7n }),
}));

it("refreshes the sucker group's total supply every 30 s, and loads the project's group id once", () => {
  query.mockImplementation((operation: { id: string }) =>
    operation.id === "project"
      ? { data: { project: { suckerGroupId: "g" } } }
      : { data: { suckerGroup: { tokenSupply: "1200" } } },
  );

  const { result } = renderHook(() => useTotalOutstandingTokens());

  expect(result.current).toBe(1200n);
  const options = (id: string) =>
    query.mock.calls.find(([operation]) => operation.id === id)?.[2] as
      { pollInterval?: number } | undefined;
  expect(options("group")?.pollInterval).toBe(30_000);
  expect(options("project")?.pollInterval).toBeUndefined();
});
