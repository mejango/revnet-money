import { projectRulesetsQueryOptions, useRulesets } from "@/hooks/useRulesets";
import type { RawRuleset } from "@/lib/nana/rulesets";
import { RulesetWeight, WeightCutPercent } from "@bananapus/nana-sdk-core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import { zeroAddress } from "viem";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ readContract: vi.fn(), client: vi.fn() }));
const RULESETS = "0x0000000000000000000000000000000000001234";
vi.mock("@/lib/wagmiConfig", () => ({ wagmiConfig: {} }));
vi.mock("wagmi/actions", () => ({ getPublicClient: mocks.client }));
vi.mock("@/lib/nana/project", () => ({
  useJBChainId: () => 10,
  useJBContractContext: () => ({
    projectId: 7n,
    contractAddress: () => "0x0000000000000000000000000000000000001234",
  }),
}));

function row(id: number, basedOnId = 0): RawRuleset {
  return {
    cycleNumber: id,
    id,
    basedOnId,
    start: id * 100,
    duration: 100,
    weight: BigInt(id) * 10n ** 18n,
    weightCutPercent: 100_000_000,
    approvalHook: zeroAddress,
    metadata: 0n,
  };
}

beforeEach(() => {
  mocks.client.mockReturnValue({ readContract: mocks.readContract });
  mocks.readContract.mockResolvedValue([row(2, 1), row(1)]);
});

describe("project ruleset query", () => {
  it("keeps complete chronological history and typed display values", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: PropsWithChildren) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(useRulesets, { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.rulesets?.map((value) => value.id)).toEqual([1, 2]);
    expect(result.current.rulesets?.[0]?.weight).toBeInstanceOf(RulesetWeight);
    expect(result.current.rulesets?.[0]?.weightCutPercent).toBeInstanceOf(WeightCutPercent);
    expect(result.current.rulesets?.[0]?.weight.value).toBe(10n ** 18n);
    expect(mocks.readContract).toHaveBeenCalledWith(
      expect.objectContaining({
        address: RULESETS,
        functionName: "allOf",
        args: [7n, 0n, 100n],
      }),
    );
  });

  it("reuses fresh history and never turns an incomplete read into an empty result", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const options = projectRulesetsQueryOptions(10, 7n, RULESETS);
    const first = await client.fetchQuery(options);
    expect(await client.fetchQuery(options)).toBe(first);
    expect(mocks.readContract).toHaveBeenCalledTimes(1);
    await client.invalidateQueries({ queryKey: options.queryKey });
    mocks.readContract.mockRejectedValueOnce(new Error("chain unavailable"));
    await expect(client.fetchQuery(options)).rejects.toThrow("chain unavailable");
    expect(client.getQueryData(options.queryKey)).toBe(first);
  });
});
