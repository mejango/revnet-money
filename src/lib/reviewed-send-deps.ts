"use client";

import { ReviewRefusal } from "@/lib/review-refusal";
import { isSafeConnection, safeWalletPeerSettled } from "@/lib/safe-connector";
import { requireNoViewAs } from "@/lib/view-as";
import { writeHolds } from "@/lib/write-hold";
import {
  viemWalletAdapter,
  WalletNotInvokedError,
  type ReviewedSendDeps,
  type WalletAdapter,
} from "@bananapus/nana-sdk-core/review";
import { isAddressEqual, type Address, type PublicClient, type WalletClient } from "viem";
import type { Config, Connector } from "wagmi";
import { getAccount, getPublicClient, getWalletClient, switchChain } from "wagmi/actions";

/**
 * The send engine loads with the first write, not with the page: every send through it takes it
 * from here, never from a static import.
 */
export const loadEngine = () => import("@bananapus/nana-sdk-core/review");

/**
 * Core's wallet adapter over the connected wagmi connector. `check` runs, with core's own checks,
 * as each request reaches the wallet; a send or signature also checks the shop-voting policy.
 */
function walletAdapter(
  config: Config,
  account: () => Address | undefined,
  finalCheck: () => (() => void) | undefined,
): WalletAdapter {
  // Each send captures the operation's final check as it starts; a later action cannot replace it.
  const over = (state = finalCheck(), payload?: () => void) =>
    viemWalletAdapter({
      walletClient: () => {
        const { address, chainId, connector } = getAccount(config);
        return getWalletClient(config, {
          account: address,
          chainId,
          connector,
        } as never) as Promise<WalletClient>;
      },
      account: () => getAccount(config).address,
      chainId: () => getAccount(config).chainId,
      isSafe: () => isSafeConnection(config),
      switchChain: (chainId) => switchChain(config, { chainId } as never),
      ready: safeWalletPeerSettled,
      connector: () => getAccount(config).connector?.uid,
      check: () => {
        requireNoViewAs();
        account();
        state?.();
        payload?.();
      },
    });
  const policy = () =>
    import("@/lib/shop-voting-policy").then(
      (module) => module.requirePriceBasedShopVoting,
      (error) => {
        throw Object.assign(new WalletNotInvokedError(WALLET_UNREACHABLE), { cause: error });
      },
    );
  return {
    ...over(),
    account,
    signMessage: (message) => over().signMessage(message),
    sendTransaction: async (tx) => {
      const state = finalCheck();
      const require = await policy();
      return over(state, () => require(tx.data, tx.to)).sendTransaction(tx);
    },
    signTypedData: async (typedData) => {
      const state = finalCheck();
      const require = await policy();
      return over(state, () => {
        const data = typedData.message?.data;
        if (typeof data === "string" && data.startsWith("0x"))
          require(data as `0x${string}`, typedData.message?.to as Address | undefined, Number(
            typedData.message?.operation ?? 0,
          ));
      }).signTypedData(typedData);
    },
    sendCalls: async (chainId, calls) => {
      const state = finalCheck();
      const require = await policy();
      return over(state, () => {
        for (const call of calls) require(call.data, call.to);
      }).sendCalls!(chainId, calls);
    },
  };
}

const WALLET_UNREACHABLE = "Your wallet could not be reached. Nothing was sent; try again.";

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
function guardedAdapter(
  config: Config,
  reviewed: () => Iterable<ReviewedWallet>,
  finalCheck: () => (() => void) | undefined = () => undefined,
): WalletAdapter {
  const bound = () => {
    const live = getAccount(config).address;
    if (live)
      for (const wallet of reviewed())
        if (isAddressEqual(live, wallet.account)) requireWallet(config, wallet);
    return live;
  };
  return walletAdapter(config, bound, finalCheck);
}

/** revnet's wallet, chains and write hold, as core's reviewed sends take them. */
export function reviewedSendDeps(
  config: Config,
  reviewed: () => Iterable<ReviewedWallet> = () => [],
  finalCheck: () => (() => void) | undefined = () => undefined,
): ReviewedSendDeps {
  return {
    adapter: guardedAdapter(config, reviewed, finalCheck),
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
  finalCheck?: () => void,
): WalletAdapter & { requireUnchanged: () => void } {
  const reviewed = { account, connector, safe: isSafeConnection(config) };
  return {
    ...guardedAdapter(
      config,
      () => [reviewed],
      () => finalCheck,
    ),
    requireUnchanged: () => requireWallet(config, reviewed),
  };
}
