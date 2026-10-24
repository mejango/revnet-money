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
class WalletAcquisitionRefusal extends ReviewRefusal {
  readonly walletNotInvoked = true;
  get reviewFixedLine() {
    return true;
  }
  get line() {
    return this.message;
  }
  constructor(
    message: string,
    readonly acquisitionCause: unknown,
  ) {
    super(message);
  }
}
class UninvokedWalletWrite extends WalletAcquisitionRefusal {
  readonly code = 4001;
}

/** Branded locally: a provider cannot classify an invoked request as unsent by setting a field. */
export const isWalletNotInvoked = (error: unknown): boolean =>
  error instanceof WalletAcquisitionRefusal;

async function readableWrite<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    // SDK4 has now released the hold. Its React wrapper must show the real refusal, not a
    // synthetic user cancellation; keep acquisition diagnostics out of the SDK's cause traversal.
    if (error instanceof UninvokedWalletWrite)
      throw new WalletAcquisitionRefusal(error.message, error.acquisitionCause);
    throw error;
  }
}
export const loadEngine = async () => {
  const engine = await import("@bananapus/nana-sdk-core/review");
  return {
    ...engine,
    sendReviewed: (...args: Parameters<typeof engine.sendReviewed>) =>
      readableWrite(() => engine.sendReviewed(...args)),
    resumeReviewed: (...args: Parameters<typeof engine.resumeReviewed>) =>
      readableWrite(() => engine.resumeReviewed(...args)),
  };
};

/** Acquire and invoke in one continuation; returning a client across an await can retain an old provider. */
function walletAdapter(
  config: Config,
  account: () => Address | undefined,
  finalCheck: () => (() => void) | undefined,
): WalletAdapter {
  type Client = Awaited<ReturnType<typeof getWalletClient>>;
  const invoke = async <T>(
    chainId: number | undefined,
    send: (client: Client, account: Address) => T,
    prepare?: () => Promise<() => void>,
    releaseUnsent = false,
  ): Promise<Awaited<T>> => {
    let client: Client | undefined;
    let asked: Address | undefined;
    try {
      asked = account();
      const checkState = finalCheck();
      const chain = chainId ?? getAccount(config).chainId;
      const safe = isSafeConnection(config);
      const requireContext = () => {
        requireNoViewAs();
        if (
          !asked ||
          account()?.toLowerCase() !== asked.toLowerCase() ||
          getAccount(config).chainId !== chain ||
          isSafeConnection(config) !== safe
        )
          throw new ReviewRefusal(WALLET_CHANGED);
      };
      requireContext();
      const checkPayload = await prepare?.();
      checkPayload?.();
      for (let attempt = 0; attempt < 3; attempt++) {
        requireContext();
        const connector = getAccount(config).connector;
        let acquired: Client;
        try {
          acquired = await getWalletClient(config, {
            account: asked,
            connector,
            ...(chain === undefined ? {} : { chainId: chain }),
          });
        } catch (error) {
          requireContext();
          if (getAccount(config).connector?.uid !== connector?.uid) continue;
          throw new WalletAcquisitionRefusal(
            "Wallet connection could not be acquired. Nothing was sent; try again.",
            error,
          );
        }
        requireContext();
        if (getAccount(config).connector?.uid !== connector?.uid) continue;
        if (acquired.account?.address && !isAddressEqual(acquired.account.address, asked!))
          throw new ReviewRefusal(WALLET_CHANGED);
        if (acquired.chain && acquired.chain.id !== chain) throw new ReviewRefusal(WALLET_CHANGED);
        checkPayload?.();
        checkState?.();
        requireContext();
        if (getAccount(config).connector?.uid !== connector?.uid) continue;
        client = acquired;
        break;
      }
      if (!client) throw new ReviewRefusal(WALLET_CHANGED);
    } catch (cause) {
      // SDK4 releases a reserved write on 4001. Only this pre-invocation path can prove that
      // no wallet method ran; never tag the callback's synchronous or asynchronous errors.
      const Refusal = releaseUnsent ? UninvokedWalletWrite : WalletAcquisitionRefusal;
      throw new Refusal(cause instanceof Error ? cause.message : WALLET_CHANGED, cause);
    }
    // No await or callback separates the final identity checks from the actual method invocation.
    return await send(client, asked!);
  };
  const chainOf = (client: Client, chainId: number) =>
    client.chain?.id === chainId ? client.chain : { id: chainId };
  return {
    kind: "wallet",
    ready: safeWalletPeerSettled,
    account,
    chainId: () => getAccount(config).chainId,
    isSafe: () => isSafeConnection(config),
    switchChain: async (chainId) => {
      await switchChain(config, { chainId } as never);
    },
    sendTransaction: (tx) =>
      invoke(
        tx.chainId,
        (client, account) =>
          client.sendTransaction({
            account,
            chain: chainOf(client, tx.chainId),
            to: tx.to,
            data: tx.data,
            value: tx.value,
            ...(tx.gas === undefined ? {} : { gas: tx.gas }),
          } as never),
        async () => {
          const { requirePriceBasedShopVoting } = await import("@/lib/shop-voting-policy");
          return () => requirePriceBasedShopVoting(tx.data, tx.to);
        },
        true,
      ),
    signTypedData: (typedData) =>
      invoke(
        typedData.domain?.chainId === undefined ? undefined : Number(typedData.domain.chainId),
        (client, account) => client.signTypedData({ ...typedData, account } as never),
        async () => {
          const { requirePriceBasedShopVoting } = await import("@/lib/shop-voting-policy");
          return () => {
            const data = typedData.message?.data;
            if (typeof data === "string" && data.startsWith("0x"))
              requirePriceBasedShopVoting(
                data as `0x${string}`,
                typedData.message?.to as Address | undefined,
                Number(typedData.message?.operation ?? 0),
              );
          };
        },
      ),
    signMessage: (message) =>
      invoke(undefined, (client, account) => client.signMessage({ account, message })),
    sendCalls: (chainId, calls) =>
      invoke(
        chainId,
        async (client, account) => {
          const { id } = await client.sendCalls({
            account,
            chain: chainOf(client, chainId),
            calls: calls.map(({ to, data, value }) => ({ to, data, value })),
          } as never);
          return id;
        },
        async () => {
          const { requirePriceBasedShopVoting } = await import("@/lib/shop-voting-policy");
          return () => {
            for (const call of calls) requirePriceBasedShopVoting(call.data, call.to);
          };
        },
        true,
      ),
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
function guardedAdapter(
  config: Config,
  reviewed: () => Iterable<ReviewedWallet>,
  finalCheck: () => (() => void) | undefined = () => undefined,
): WalletAdapter {
  return walletAdapter(
    config,
    () => {
      const live = getAccount(config).address;
      if (live)
        for (const bound of reviewed())
          if (isAddressEqual(live, bound.account)) requireWallet(config, bound);
      return live;
    },
    finalCheck,
  );
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
