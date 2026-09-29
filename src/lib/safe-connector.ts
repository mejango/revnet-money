"use client";

import { isSafeWalletPeer } from "@bananapus/nana-sdk-core/safe-service";
import { useSyncExternalStore } from "react";
import type { Config, Connector } from "wagmi";
import { getAccount, watchAccount } from "wagmi/actions";

/** Whether the connected WalletConnect peer is Safe{Wallet}. */
let safeWalletPeer = false;
/** Counts session reads, so a slower read of an earlier connection never overwrites a newer answer. */
let reads = 0;
const listeners = new Set<() => void>();

/**
 * Whether a connector proposes to a Safe instead of sending: the Safe app, or
 * Safe{Wallet} over WalletConnect. Both make the gas a dapp sends the
 * proposal's safeTxGas and reply with a safeTxHash. A wallet whose name
 * contains "safe" (SafePal) is an ordinary wallet.
 */
export function isSafeConnector(connector: { id?: string } | undefined): boolean {
  return connector?.id === "safe" || (connector?.id === "walletConnect" && safeWalletPeer);
}

export function isSafeConnection(config: Config): boolean {
  try {
    return isSafeConnector(getAccount(config).connector);
  } catch {
    return false;
  }
}

/** `isSafeConnection` for rendering: it renders again once the WalletConnect peer is known. */
export function useSafeConnection(config: Config): boolean {
  return useSyncExternalStore(
    subscribe,
    () => isSafeConnection(config),
    () => false,
  );
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Follows `config`'s connection and records whether its WalletConnect peer is
 * Safe{Wallet}, which only the WalletConnect session tells. A re-read keeps the
 * previous answer until it lands, so a gas choice cannot flip mid-flow.
 * Returns the unwatch.
 */
export function watchSafeWalletPeer(config: Config): () => void {
  const check = async (connector: Connector | undefined) => {
    const read = ++reads;
    let peer = false;
    if (connector?.id === "walletConnect") {
      try {
        const provider = (await connector.getProvider()) as
          { session?: { peer?: { metadata?: { url?: string } } } } | undefined;
        peer = isSafeWalletPeer(provider?.session?.peer?.metadata?.url);
      } catch {
        // A session that cannot be read is not known to be Safe{Wallet}.
      }
    }
    if (read !== reads) return;
    safeWalletPeer = peer;
    for (const listener of listeners) listener();
  };
  void check(getAccount(config).connector);
  return watchAccount(config, { onChange: (account) => void check(account.connector) });
}
