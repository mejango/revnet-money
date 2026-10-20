import { beforeEach, describe, expect, it, vi } from "vitest";

// The SDK's Safe service module is imported inside the WalletConnect peer check. The answer a
// gas choice reads changes only once that module has loaded; until then the previous one holds.
const runtime = vi.hoisted(() => {
  let release!: () => void;
  return {
    chunk: new Promise<void>((resolve) => {
      release = resolve;
    }),
    release: () => release(),
    loaded: vi.fn(),
    connector: undefined as { id: string; getProvider: () => Promise<unknown> } | undefined,
  };
});

vi.mock("@bananapus/nana-sdk-core/safe-service", async () => {
  await runtime.chunk;
  runtime.loaded();
  return { isSafeWalletPeer: (url?: string) => url === "https://app.safe.global" };
});
vi.mock("wagmi/actions", () => ({
  getAccount: () => ({ connector: runtime.connector }),
  watchAccount: () => () => undefined,
}));

import { isSafeConnection, watchSafeWalletPeer } from "@/lib/safe-connector";

const CONFIG = {} as never;
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  runtime.connector = undefined;
});

describe("Safe{Wallet} peer check with a lazily loaded Safe service", () => {
  it("never loads the Safe service for a connection that is not WalletConnect", async () => {
    runtime.connector = { id: "injected", getProvider: async () => ({}) };
    watchSafeWalletPeer(CONFIG);
    await flush();
    expect(runtime.loaded).not.toHaveBeenCalled();
  });

  it("keeps the previous answer until the module loads, then reports Safe{Wallet}", async () => {
    runtime.connector = {
      id: "walletConnect",
      getProvider: async () => ({
        session: { peer: { metadata: { url: "https://app.safe.global" } } },
      }),
    };
    watchSafeWalletPeer(CONFIG);
    await flush();
    // The session is read, but the Safe service has not loaded: no gas choice sees a Safe yet.
    expect(isSafeConnection(CONFIG)).toBe(false);
    runtime.release();
    await vi.dynamicImportSettled();
    await flush();
    expect(runtime.loaded).toHaveBeenCalledTimes(1);
    expect(isSafeConnection(CONFIG)).toBe(true);
  });
});
