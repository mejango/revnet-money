"use client";

import { ReviewRefusal } from "@/lib/review-refusal";
import { isSafeConnection, safeWalletPeerSettled } from "@/lib/safe-connector";
import { requireNoViewAs } from "@/lib/view-as";
import { writeHolds } from "@/lib/write-hold";
import {
  viemWalletAdapter,
  type ReviewedSendDeps,
  type WalletAdapter,
} from "@bananapus/nana-sdk-core/review";
import { isAddressEqual, type Address, type PublicClient } from "viem";
import type { Config, Connector } from "wagmi";
import { getAccount, getPublicClient, getWalletClient, switchChain } from "wagmi/actions";

/** revnet's wallet as core's adapter, reading the connected account through `account`. */
function walletAdapter(
  config: Config,
  account: () => Address | undefined = () => getAccount(config).address,
): WalletAdapter {
  return viemWalletAdapter({
    walletClient: () => getWalletClient(config),
    account,
    chainId: () => getAccount(config).chainId,
    isSafe: () => isSafeConnection(config),
    switchChain: (chainId) => switchChain(config, { chainId } as never),
    // Safe{Wallet} over WalletConnect is known only once its peer check answers.
    ready: safeWalletPeerSettled,
  });
}

/** revnet's wallet, chains and write hold, as core's reviewed sends take them. */
export function reviewedSendDeps(config: Config): ReviewedSendDeps {
  return {
    adapter: walletAdapter(config),
    clientFor: (chainId) => getPublicClient(config, { chainId } as never) as PublicClient,
    hold: writeHolds,
  };
}

export const WALLET_CHANGED = "Wallet connection changed. Review the transaction again.";

/**
 * The wallet as core's adapter for one reviewed `account` on `connector`: View-as, another
 * connector or a change of Safe mode refuses wherever core reads the account, which it does
 * before and after the wallet client loads and before each signature and send. Another account
 * reads as itself, so core refuses it with its own line. `requireUnchanged` checks the same
 * again, for a signature the app holds after the wallet returns it.
 */
export function reviewedWalletAdapter(
  config: Config,
  account: Address,
  connector: Connector | undefined,
): WalletAdapter & { requireUnchanged: () => void } {
  const safe = isSafeConnection(config);
  const requireUnchanged = () => {
    requireNoViewAs();
    const live = getAccount(config);
    if (
      live.connector !== connector ||
      isSafeConnection(config) !== safe ||
      !live.address ||
      !isAddressEqual(live.address, account)
    )
      throw new ReviewRefusal(WALLET_CHANGED);
  };
  const adapter = walletAdapter(config, () => {
    const live = getAccount(config).address;
    if (live && isAddressEqual(live, account)) requireUnchanged();
    return live;
  });
  return { ...adapter, requireUnchanged };
}
