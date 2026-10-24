import { reviewedSendDeps } from "@/lib/reviewed-send-deps";
import { clearViewAs } from "@/lib/view-as";
import type { WalletAdapter } from "@bananapus/nana-sdk-core/review";
import { signReviewed, submitReviewedContractWrite } from "@bananapus/nana-sdk-core/review";
import { mainnet } from "viem/chains";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Config } from "wagmi";

import { answerReviews, loadCoreReview, stopAnswering } from "./support/core-review";

const safe = vi.hoisted(() => ({ value: false }));
vi.mock("@/lib/safe-connector", () => ({
  isSafeConnection: () => safe.value,
  safeWalletPeerSettled: async () => undefined,
}));
const ACCOUNT = "0x1111111111111111111111111111111111111111";
const OTHER = "0x2222222222222222222222222222222222222222";
const HASH = `0x${"12".repeat(32)}` as const;
const tx = { chainId: 1, to: OTHER, data: "0x" as const, value: 0n, gas: 21000n } as const;
const typed = {
  domain: { chainId: 1 },
  types: { Test: [{ name: "value", type: "uint256" }] },
  primaryType: "Test",
  message: { value: 1n },
} as const;

function harness(stage: "chain" | "provider") {
  let release!: () => void;
  let entered!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const waiting = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const calls: string[] = [];
  let held = false;
  let failure = false;
  let walletError: Error | undefined;
  const connector = (uid: string, blocked = false) => ({
    id: uid,
    uid,
    getAccounts: async () => [ACCOUNT],
    getChainId: async () => {
      if (blocked && stage === "chain" && !held) {
        held = true;
        entered();
        await gate;
      }
      if (failure) throw new Error("Wallet provider acquisition failed.");
      return 1;
    },
    getProvider: async () => {
      if (blocked && stage === "provider" && !held) {
        held = true;
        entered();
        await gate;
      }
      return {
        request: async ({ method }: { method: string }) => {
          if (method === "eth_chainId") return "0x1";
          calls.push(`${uid}:${method}`);
          if (walletError) throw walletError;
          if (method === "wallet_sendCalls") return { id: HASH };
          if (method === "eth_sendTransaction") return HASH;
          if (method === "personal_sign" || method === "eth_signTypedData_v4")
            return `0x${"12".repeat(65)}`;
          throw new Error(method);
        },
      };
    },
  });
  const old = connector("old", true);
  const current = connector("current");
  const config = {
    chains: [mainnet],
    state: {
      current: "old",
      status: "connected",
      connections: new Map([
        ["old", { accounts: [ACCOUNT], chainId: 1, connector: old }],
        ["current", { accounts: [ACCOUNT], chainId: 1, connector: current }],
      ]),
    },
  };
  return {
    config,
    calls,
    waiting,
    release,
    fail: () => {
      failure = true;
    },
    walletFails: (error: Error) => {
      walletError = error;
    },
    adapter: reviewedSendDeps(config as unknown as Config).adapter,
  };
}
const operations = {
  sendTransaction: (adapter: WalletAdapter) => adapter.sendTransaction(tx),
  signTypedData: (adapter: WalletAdapter) => adapter.signTypedData(typed),
  signMessage: (adapter: WalletAdapter) => adapter.signMessage("Review this message"),
  sendCalls: (adapter: WalletAdapter) =>
    adapter.sendCalls!(1, [{ to: OTHER, data: "0x", value: 0n }]),
};
beforeEach(async () => {
  await loadCoreReview();
  stopAnswering();
  clearViewAs();
  safe.value = false;
});

afterEach(stopAnswering);

for (const stage of ["chain", "provider"] as const) {
  it.each(Object.entries(operations))(
    `invokes the replacement wallet for %s after held ${stage} acquisition`,
    async (_name, invoke) => {
      const h = harness(stage);
      const pending = invoke(h.adapter);
      await h.waiting;
      h.config.state.current = "current";
      h.release();
      await pending;
      expect(h.calls).toHaveLength(1);
      expect(h.calls[0]).toMatch(/^current:/);
    },
  );
  it.each(["account", "chain", "route"] as const)(
    `invokes nothing after %s changes during ${stage} acquisition`,
    async (changed) => {
      const h = harness(stage);
      const pending = h.adapter.sendTransaction(tx);
      const rejected = expect(pending).rejects.toMatchObject({
        code: 4001,
        walletNotInvoked: true,
      });
      await h.waiting;
      if (changed === "account") h.config.state.connections.get("old")!.accounts = [OTHER];
      else if (changed === "chain") h.config.state.connections.get("old")!.chainId = 10;
      else safe.value = true;
      h.release();
      await rejected;
      expect(h.calls).toEqual([]);
    },
  );
}

it("releases the actual SDK reservation when acquisition fails before invocation, retaining the real error line", async () => {
  const h = harness("chain");
  h.fail();
  const release = vi.fn();
  const uncertain = vi.fn();
  const pending = submitReviewedContractWrite({
    request: tx,
    expectedAccount: ACCOUNT,
    currentAccount: () => ACCOUNT,
    review: async () => {},
    switchChain: async () => {},
    simulate: async (request) => request,
    beforeWrite: async () => {},
    onWriteRejected: release,
    onWriteUncertain: uncertain,
    write: () => h.adapter.sendTransaction(tx),
  });
  const rejected = expect(pending).rejects.toThrow(
    "Wallet connection could not be acquired. Nothing was sent; try again.",
  );
  await h.waiting;
  h.release();
  await rejected;
  expect(release).toHaveBeenCalledOnce();
  expect(uncertain).not.toHaveBeenCalled();
  expect(h.calls).toEqual([]);
});

it("preserves actual SDK signature refusal text instead of classifying it as user cancellation", async () => {
  const h = harness("provider");
  answerReviews(async () => true);
  const pending = signReviewed(
    [{ kind: "message", chainId: 1, message: "Review this message" }],
    { account: ACCOUNT },
    { adapter: h.adapter },
  );
  const rejected = expect(pending).rejects.toMatchObject({
    name: "ReviewRefusal",
    message: "Wallet connection changed. Review the transaction again.",
    walletNotInvoked: true,
  });
  await h.waiting;
  h.config.state.connections.get("old")!.accounts = [OTHER];
  h.release();
  await rejected;
  expect(h.calls).toEqual([]);
});

it("keeps an actual wallet RPC failure ambiguous after invocation", async () => {
  const h = harness("provider");
  h.walletFails(new Error("Wallet RPC timed out."));
  const release = vi.fn();
  const uncertain = vi.fn();
  const pending = submitReviewedContractWrite({
    request: tx,
    expectedAccount: ACCOUNT,
    currentAccount: () => ACCOUNT,
    review: async () => {},
    switchChain: async () => {},
    simulate: async (request) => request,
    beforeWrite: async () => {},
    onWriteRejected: release,
    onWriteUncertain: uncertain,
    write: () => h.adapter.sendTransaction(tx),
  });
  const rejected = expect(pending).rejects.toThrow(/Wallet RPC timed out/);
  await h.waiting;
  h.release();
  await rejected;
  expect(release).not.toHaveBeenCalled();
  expect(uncertain).toHaveBeenCalledOnce();
  expect(h.calls).toHaveLength(1);
});

it("captures the current operation's final assertion across acquisition without coupling another action", async () => {
  const h = harness("provider");
  let invalid = false;
  const own = vi.fn(() => {
    if (invalid) throw new Error("Reviewed schedule expired.");
  });
  const unrelated = vi.fn(() => {
    throw new Error("Another action changed.");
  });
  let selected = own;
  const adapter = reviewedSendDeps(
    h.config as unknown as Config,
    () => [],
    () => selected,
  ).adapter;
  const pending = adapter.sendTransaction(tx);
  const rejected = expect(pending).rejects.toThrow("Reviewed schedule expired.");
  await h.waiting;
  selected = unrelated;
  invalid = true;
  h.release();
  await rejected;
  expect(own).toHaveBeenCalledOnce();
  expect(unrelated).not.toHaveBeenCalled();
  expect(h.calls).toEqual([]);
});
