"use client";

import { ReviewRefusal } from "@/lib/review-refusal";
import { isSafeConnection, safeWalletPeerSettled } from "@/lib/safe-connector";
import { requireNoViewAs } from "@/lib/view-as";
import { writeHolds } from "@/lib/write-hold";
import type { ReviewedSendDeps, WalletAdapter } from "@bananapus/nana-sdk-core/review";
import { isAddressEqual, type Address, type PublicClient } from "viem";
import type { Config, Connector } from "wagmi";
import { getAccount, getPublicClient, getWalletClient, switchChain } from "wagmi/actions";

/**
 * The send engine loads with the first write, not with the page: every send through it takes it
 * from here, never from a static import.
 */
export const loadEngine = () => import("@bananapus/nana-sdk-core/review");

/**
 * revnet's wallet as core's adapter, reading the connected account through `account`. Its wallet
 * calls go through core's viem adapter, loaded with the engine on the first one.
 */
function walletAdapter(config: Config, account: () => Address | undefined): WalletAdapter {
  const options = {
    walletClient: () => getWalletClient(config),
    account,
    chainId: () => getAccount(config).chainId,
    isSafe: () => isSafeConnection(config),
    switchChain: (chainId: number) => switchChain(config, { chainId } as never),
  };
  const viem = async () => (await loadEngine()).viemWalletAdapter(options);
  return {
    kind: "wallet",
    // Safe{Wallet} over WalletConnect is known only once its peer check answers.
    ready: safeWalletPeerSettled,
    account,
    chainId: options.chainId,
    isSafe: options.isSafe,
    switchChain: async (chainId) => {
      await options.switchChain(chainId);
    },
    sendTransaction: async (tx) => {
      const { requirePriceBasedShopVoting } = await import("@/lib/shop-voting-policy");
      requirePriceBasedShopVoting(tx.data, tx.to);
      return (await viem()).sendTransaction(tx);
    },
    signTypedData: async (typedData) => {
      const { requirePriceBasedShopVoting } = await import("@/lib/shop-voting-policy");
      const data = typedData.message?.data;
      if (typeof data === "string" && data.startsWith("0x"))
        requirePriceBasedShopVoting(
          data as `0x${string}`,
          typedData.message?.to as Address | undefined,
          Number(typedData.message?.operation ?? 0),
        );
      return (await viem()).signTypedData(typedData);
    },
    signMessage: async (message) => (await viem()).signMessage(message),
    sendCalls: async (chainId, calls) => {
      const { requirePriceBasedShopVoting } = await import("@/lib/shop-voting-policy");
      for (const call of calls) requirePriceBasedShopVoting(call.data, call.to);
      return (await viem()).sendCalls!(chainId, calls);
    },
  };
}

/** The wallet a review was confirmed on: its account, connector and Safe mode. */
export type ReviewedWallet = { account: Address; connector: Connector | undefined; safe: boolean };

export const WALLET_CHANGED = "Wallet connection changed. Review the transaction again.";

/** The wallet now as `config` connects it, for a review about to open. */
export function reviewedWalletOf(config: Config, account: Address): ReviewedWallet {
  return { account, connector: getAccount(config).connector, safe: isSafeConnection(config) };
}

function requireWallet(config: Config, reviewed: ReviewedWallet) {
  requireNoViewAs();
  const live = getAccount(config);
  if (
    isSafeConnection(config) !== reviewed.safe ||
    !live.address ||
    !isAddressEqual(live.address, reviewed.account)
  )
    throw new ReviewRefusal(WALLET_CHANGED);
}

/**
 * The wallet as core's adapter, bound to every wallet `reviewed` returns: View-as or a change
 * of Safe mode refuses wherever core reads the account, which it does before and after
 * the wallet client loads and before each signature and send. Another account reads as itself, so
 * core refuses it with its own line. With no wallet bound, it reads the wallet as is.
 */
function guardedAdapter(config: Config, reviewed: () => Iterable<ReviewedWallet>): WalletAdapter {
  return walletAdapter(config, () => {
    const live = getAccount(config).address;
    if (live)
      for (const bound of reviewed())
        if (isAddressEqual(live, bound.account)) requireWallet(config, bound);
    return live;
  });
}

/** revnet's wallet, chains and write hold, as core's reviewed sends take them. */
export function reviewedSendDeps(
  config: Config,
  reviewed: () => Iterable<ReviewedWallet> = () => [],
): ReviewedSendDeps {
  return {
    adapter: guardedAdapter(config, reviewed),
    clientFor: (chainId) => getPublicClient(config, { chainId } as never) as PublicClient,
    hold: writeHolds,
  };
}

/**
 * The adapter for one reviewed `account` on `connector`. `requireUnchanged` checks the wallet
 * again, for a signature the app holds after the wallet returns it.
 */
export function reviewedWalletAdapter(
  config: Config,
  account: Address,
  connector: Connector | undefined,
): WalletAdapter & { requireUnchanged: () => void } {
  const reviewed = { account, connector, safe: isSafeConnection(config) };
  return {
    ...guardedAdapter(config, () => [reviewed]),
    requireUnchanged: () => requireWallet(config, reviewed),
  };
}
