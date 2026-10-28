import { usePaySurface } from "@/app/[slug]/components/v6/pay/usePaySurface";
import { NATIVE_TOKEN, USDC_ADDRESSES } from "@bananapus/nana-sdk-core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import type { Address } from "viem";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ readContract: vi.fn(), contexts: vi.fn(), ruleset: vi.fn() }));
vi.mock("wagmi", () => ({ usePublicClient: () => ({ readContract: mocks.readContract }) }));
vi.mock("@bananapus/nana-sdk-core/v6", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@bananapus/nana-sdk-core/v6")>()),
  getAccountingContexts: mocks.contexts,
  getCurrentRuleset: mocks.ruleset,
}));
const ENTRY_A = "0x0000000000000000000000000000000000000001" as Address;
const ENTRY_B = "0x0000000000000000000000000000000000000002" as Address;
const DIRECT = "0x0000000000000000000000000000000000000003" as Address;
vi.mock("@/lib/protocol-rollout", () => ({
  routerEntriesFor: (_chain: number, terminals: Address[]) => terminals,
}));
const clients: QueryClient[] = [];
let probe: (entry: Address, token: Address) => Promise<unknown>;

beforeEach(() => {
  mocks.contexts.mockResolvedValue([{ token: DIRECT, decimals: 18, currency: 3 }]);
  mocks.ruleset.mockResolvedValue({ ruleset: { start: 10 }, metadata: { pausePay: false } });
  probe = async () => [{ id: 0n }];
  mocks.readContract.mockImplementation(
    async ({
      functionName,
      address,
      args,
    }: {
      functionName: string;
      address: Address;
      args: unknown[];
    }) => {
      if (functionName === "terminalsOf") return [ENTRY_A, ENTRY_B];
      if (functionName === "symbol") return "DIRECT";
      if (functionName === "previewPayFor") return probe(address, args[1] as Address);
      throw new Error(`Unexpected read: ${functionName}`);
    },
  );
});
afterEach(() => {
  clients.splice(0).forEach((client) => client.clear());
});
function mount() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
  clients.push(client);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return renderHook(() => usePaySurface(1, 27n), { wrapper });
}

describe("payment surface route read status", () => {
  it("preserves direct and independently verified routes when one token cannot be checked, then recovers on refetch", async () => {
    let healthy = false;
    probe = async (entry, token) => {
      if (token === NATIVE_TOKEN) {
        if (entry === ENTRY_A && !healthy) throw new Error("RPC unavailable");
        return [{ id: healthy ? 1n : 0n }];
      }
      if (entry === ENTRY_A) return [{ id: 1n }];
      throw new Error("Other entry unavailable");
    };
    const { result } = mount();
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.tokens.map((token) => token.token)).toEqual([
      DIRECT,
      USDC_ADDRESSES[1],
    ]);
    expect(result.current.data?.routingUnavailable).toBe(true);
    healthy = true;
    await act(async () => {
      await result.current.refetch();
    });
    await waitFor(() =>
      expect(result.current.data?.tokens.map((token) => token.token)).toEqual([
        DIRECT,
        NATIVE_TOKEN,
        USDC_ADDRESSES[1],
      ]),
    );
    expect(result.current.data?.routingUnavailable).toBe(false);
  });

  it("keeps direct choices when terminal discovery fails and recovers routes on retry", async () => {
    let healthy = false;
    mocks.readContract.mockImplementation(async ({ functionName }: { functionName: string }) => {
      if (functionName === "terminalsOf") {
        if (!healthy) throw new Error("Directory RPC unavailable");
        return [ENTRY_A];
      }
      if (functionName === "symbol") return "DIRECT";
      if (functionName === "previewPayFor") return [{ id: 1n }];
      throw new Error(`Unexpected read: ${functionName}`);
    });
    const { result } = mount();
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.tokens.map((token) => token.token)).toEqual([DIRECT]);
    expect(result.current.data?.routingUnavailable).toBe(true);
    healthy = true;
    await act(async () => {
      await result.current.refetch();
    });
    await waitFor(() =>
      expect(result.current.data?.tokens.map((token) => token.token)).toEqual([
        DIRECT,
        NATIVE_TOKEN,
        USDC_ADDRESSES[1],
      ]),
    );
    expect(result.current.data?.routingUnavailable).toBe(false);
  });

  it("does not report uncertainty when terminal discovery confirms an empty list", async () => {
    mocks.readContract.mockImplementation(async ({ functionName }: { functionName: string }) => {
      if (functionName === "terminalsOf") return [];
      if (functionName === "symbol") return "DIRECT";
      throw new Error(`Unexpected read: ${functionName}`);
    });
    const { result } = mount();
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.tokens.map((token) => token.token)).toEqual([DIRECT]);
    expect(result.current.data?.routingUnavailable).toBe(false);
  });

  it("refreshes both confirmed dead and confirmed live route verdicts", async () => {
    let live = false;
    probe = async (_entry, token) => [{ id: token === NATIVE_TOKEN && live ? 1n : 0n }];
    const { result } = mount();
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.tokens.map((token) => token.token)).toEqual([DIRECT]);
    expect(result.current.data?.routingUnavailable).toBe(false);
    live = true;
    await act(async () => {
      await result.current.refetch();
    });
    await waitFor(() =>
      expect(result.current.data?.tokens.map((token) => token.token)).toEqual([
        DIRECT,
        NATIVE_TOKEN,
      ]),
    );
    live = false;
    await act(async () => {
      await result.current.refetch();
    });
    await waitFor(() =>
      expect(result.current.data?.tokens.map((token) => token.token)).toEqual([DIRECT]),
    );
    expect(result.current.data?.routingUnavailable).toBe(false);
  });
});
