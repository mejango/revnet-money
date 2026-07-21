"use client";

import { ButtonWithWallet } from "@/components/ButtonWithWallet";
import { useToast } from "@/components/ui/use-toast";
import { useAllowance } from "@/hooks/useAllowance";
import { useTokenBalances } from "@/hooks/useTokenBalances";
import { resolveBestV6PayRoute } from "@/lib/paymentTerminal";
import { minReturnedTokens } from "@/lib/quote";
import { Token } from "@/lib/token";
import { formatTokenSymbol, formatWalletError } from "@/lib/utils";
import {
  formatPayAmount,
  formatStartCountdown,
  isNativePayToken,
  payTokenKey,
  V6PayMode,
} from "@/lib/v6/pay";
import {
  JB_CHAINS,
  JBChainId,
  jbContractAddress,
  JBCoreContracts,
  jbMultiTerminalAbi,
  jbRouterTerminalRegistryAbi,
} from "@bananapus/nana-sdk-core";
import {
  build721PayMetadata,
  buildPayTx,
  effectiveTierPrice,
  PayPreview,
  previewPay,
  resolvePaymentTerminal,
} from "@bananapus/nana-sdk-core/v6";
import { useJBTokenContext, useSuckers } from "@bananapus/nana-sdk-react";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Address,
  encodeFunctionData,
  erc20Abi,
  formatUnits,
  Hex,
  parseUnits,
  PublicClient,
  zeroAddress,
} from "viem";
import { useAccount, usePublicClient, useWriteContract } from "wagmi";
import { useSelectedSucker } from "../../PayCard/SelectedSuckerContext";
import { BuildPromptFooter } from "../BuildPromptFooter";
import { useShopCart } from "../ShopCartContext";
import { TextSelect } from "./TextSelect";
import { PreparedV6Pay, V6PayConfirmDialog, V6PayPhase } from "./V6PayConfirmDialog";
import { V6PayShopStrip } from "./V6PayShopStrip";
import { usePaySurface } from "./usePaySurface";
import {
  BASE_CURRENCY_ETH,
  BASE_CURRENCY_USD,
  usePayShop,
  usePayShopCredits,
  usePayShopRoutes,
} from "./usePayShop";

/**
 * The full-featured v6 pay card (website/ pay-card parity): mode + chain
 * header, on-chain accepted-token list (direct + live-probed via-router),
 * debounced live preview, 721 shop strip with credits, memo, and a
 * confirm-before-send flow with a fresh previewed minimum and simulate-first
 * sends.
 */
export function V6PayCard() {
  const { selectedSucker, setSelectedSucker } = useSelectedSucker();
  const chainId = selectedSucker.peerChainId;
  const projectId = selectedSucker.projectId;

  const { data: suckers } = useSuckers();
  const chainOptions = useMemo(
    () => (suckers && suckers.length > 0 ? suckers : [selectedSucker]),
    [suckers, selectedSucker],
  );

  const { address, isConnected } = useAccount();
  const publicClient = usePublicClient({ chainId });
  const { writeContractAsync } = useWriteContract();
  const { ensureAllowance } = useAllowance(chainId);
  const { toast } = useToast();

  const projectToken = useJBTokenContext().token.data;
  const projectTokenLabel = projectToken?.symbol ? formatTokenSymbol(projectToken.symbol) : "tokens";
  const nativeSymbol = JB_CHAINS[chainId]?.nativeTokenSymbol ?? "ETH";

  // ---- Form state ----
  const [mode, setMode] = useState<V6PayMode>("pay");
  const [amount, setAmount] = useState("");
  const [debouncedAmount, setDebouncedAmount] = useState("");
  const [memo, setMemo] = useState("");
  const [tokenIndex, setTokenIndex] = useState(0);
  // True once the user explicitly picks a pay token. Until then the selection
  // auto-defaults to the project's accounting token (list[0]) so an ETH/USDC
  // router option never shadows a USDC/ETH project's real token.
  const [tokenTouched, setTokenTouched] = useState(false);
  // The (address+route) identity of the user's pick, so a background refetch or
  // chain switch remaps the index to the same token rather than clobbering it.
  const selectedKeyRef = useRef<string | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedAmount(amount), 400);
    return () => clearTimeout(t);
  }, [amount]);

  // ---- Payment surface: accepted tokens + live ruleset gates ----
  const { data: surface, isError: surfaceError } = usePaySurface(chainId, projectId);
  const tokens = useMemo(() => surface?.tokens ?? [], [surface]);
  const selected = tokens.length > 0 ? tokens[Math.min(tokenIndex, tokens.length - 1)] : undefined;
  const decimals = selected?.decimals ?? 18;
  const isNative = !selected || isNativePayToken(selected.token);

  // Keep the index in lock-step with the token list as it (re)resolves: default
  // to list[0] (the accounting token) until touched; re-find an explicit pick.
  useEffect(() => {
    if (tokens.length === 0) return;
    if (!tokenTouched) {
      if (tokenIndex !== 0) setTokenIndex(0);
      return;
    }
    const key = selectedKeyRef.current;
    const idx = key ? tokens.findIndex((t) => payTokenKey(t) === key) : -1;
    if (idx >= 0) {
      if (idx !== tokenIndex) setTokenIndex(idx);
    } else {
      selectedKeyRef.current = null;
      setTokenTouched(false);
      setTokenIndex(0);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tokens, tokenTouched]);

  // ---- Ruleset start countdown ----
  const startsAt = surface?.rulesetStart ?? 0;
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    if (!startsAt || startsAt <= now) return;
    const t = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(t);
  }, [startsAt, now]);
  const notStarted = startsAt > now;

  const amountRaw = useMemo(() => {
    try {
      const trimmed = debouncedAmount.trim();
      if (!trimmed || Number(trimmed) <= 0) return 0n;
      return parseUnits(trimmed, decimals);
    } catch {
      return 0n;
    }
  }, [debouncedAmount, decimals]);

  // ---- 721 shop ----
  const { data: shop } = usePayShop(chainId, projectId);
  const { data: shopCredits = 0n, isLoading: shopCreditsLoading } = usePayShopCredits(
    chainId,
    shop?.hook,
  );
  const { data: shopRoutes, isLoading: shopRoutesLoading } = usePayShopRoutes(
    chainId,
    projectId,
    shop,
    tokens,
  );

  const cart = useShopCart();
  const chainCartItems = useMemo(
    () =>
      cart.items.filter(
        (i) => i.chainId === Number(chainId) && (!shop || i.hook.toLowerCase() === shop.hook.toLowerCase()),
      ),
    [cart.items, chainId, shop],
  );
  const cartCount = chainCartItems.reduce((sum, i) => sum + i.quantity, 0);

  // Clamp stale cart quantities against live per-chain supply; drop dead tiers.
  useEffect(() => {
    if (!shop) return;
    for (const item of chainCartItems) {
      const tier = shop.tiers.find((t) => t.id === Number(item.tierId));
      if (!tier) {
        cart.remove(item.tierId, item.chainId);
        continue;
      }
      const cap = tier.unlimited ? 99 : tier.remaining;
      if (item.quantity > cap) cart.setQuantity(item.tierId, item.chainId, cap);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shop, chainCartItems]);

  const selectedShopRoute = selected ? shopRoutes?.[payTokenKey(selected)] : undefined;
  const shopMatchesToken = !!selectedShopRoute?.supported;
  const supportedShopTokenIndexes = useMemo(
    () =>
      tokens.flatMap((t, index) => (shopRoutes?.[payTokenKey(t)]?.supported ? [index] : [])),
    [tokens, shopRoutes],
  );

  // Selecting items moves the token selector to the best verified checkout
  // token instead of silently discarding the cart.
  useEffect(() => {
    if (cartCount === 0 || shopRoutesLoading || shopMatchesToken || !shop) return;
    const preferred = supportedShopTokenIndexes
      .map((index) => ({ index, token: tokens[index] }))
      .sort((a, b) => {
        const score = (t: (typeof tokens)[number]) =>
          t.currency === shop.pricingCurrency
            ? 3
            : shop.pricingCurrency === BASE_CURRENCY_ETH && isNativePayToken(t.token)
              ? 2
              : shop.pricingCurrency === BASE_CURRENCY_USD && t.symbol.toUpperCase() === "USDC"
                ? 2
                : 1;
        return score(b.token) - score(a.token);
      })[0];
    if (!preferred) return;
    setTokenIndex(preferred.index);
    selectedKeyRef.current = payTokenKey(preferred.token);
    setTokenTouched(true);
  }, [cartCount, shopRoutesLoading, shopMatchesToken, supportedShopTokenIndexes, tokens, shop]);

  const shopPricingSymbol = !shop
    ? ""
    : shop.pricingCurrency === BASE_CURRENCY_ETH
      ? nativeSymbol
      : shop.pricingCurrency === BASE_CURRENCY_USD
        ? "USD"
        : (tokens.find((t) => t.currency === shop.pricingCurrency)?.symbol ?? "units");

  // Checkout totals, in the shop's pricing units.
  const cartTotal = useMemo(() => {
    if (!shop || cartCount === 0) return 0n;
    return shop.tiers.reduce((sum, tier) => {
      const qty =
        chainCartItems.find((i) => Number(i.tierId) === tier.id)?.quantity ?? 0;
      return sum + effectiveTierPrice(tier.price, tier.discountPercent) * BigInt(qty);
    }, 0n);
  }, [shop, chainCartItems, cartCount]);
  const restrictedCartTotal = useMemo(() => {
    if (!shop) return 0n;
    return shop.tiers.reduce((sum, tier) => {
      if (!tier.cantBuyWithCredits) return sum;
      const qty =
        chainCartItems.find((i) => Number(i.tierId) === tier.id)?.quantity ?? 0;
      return sum + effectiveTierPrice(tier.price, tier.discountPercent) * BigInt(qty);
    }, 0n);
  }, [shop, chainCartItems]);
  const shopCreditApplied = useMemo(() => {
    const eligible = cartTotal - restrictedCartTotal;
    if (eligible <= 0n || shopCredits <= 0n) return 0n;
    return shopCredits < eligible ? shopCredits : eligible;
  }, [cartTotal, restrictedCartTotal, shopCredits]);
  const cartAmountDue = cartTotal - shopCreditApplied;

  // Keep the entered amount at least the verified checkout total. The price
  // feed is expressed in payment-token units and this direction rounds up,
  // matching the hook's fail-safe normalization.
  const cartTotalInToken = useMemo(() => {
    const pricePerUnit = selectedShopRoute?.pricePerUnit;
    if (!shop || mode !== "pay" || cartAmountDue === 0n || !selected || !pricePerUnit) return 0n;
    const denominator = 10n ** BigInt(shop.pricingDecimals);
    return (cartAmountDue * pricePerUnit + denominator - 1n) / denominator;
  }, [shop, mode, cartAmountDue, selected, selectedShopRoute]);

  useEffect(() => {
    if (mode !== "pay" || cartCount === 0 || !shopMatchesToken) return;
    const current = (() => {
      try {
        return parseUnits(amount.trim() || "0", decimals);
      } catch {
        return 0n;
      }
    })();
    if (current === cartTotalInToken) return;
    const next = formatUnits(cartTotalInToken, decimals);
    setAmount(next);
    setDebouncedAmount(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cartTotalInToken, cartCount, shopMatchesToken, mode]);

  const tierIds = useMemo(
    () =>
      chainCartItems.flatMap((item) =>
        Array.from({ length: item.quantity }, () => item.tierId),
      ),
    [chainCartItems],
  );
  // Metadata ids key off the hook's METADATA_ID_TARGET (the shared
  // implementation), never the clone — else the payment mints ZERO NFTs.
  const metadata: Hex | undefined =
    shop && tierIds.length > 0 && shopMatchesToken
      ? build721PayMetadata({ metadataIdTarget: shop.idTarget, tierIdsToMint: tierIds })
      : undefined;

  // ---- Debounced live preview via the best route (multi vs router) ----
  const {
    data: preview,
    isFetching: previewLoading,
    isError: previewError,
    isPlaceholderData: previewIsPrevious,
  } = useQuery({
    queryKey: [
      "v6PayPreview",
      chainId,
      projectId.toString(),
      selected ? payTokenKey(selected) : "",
      amountRaw.toString(),
      metadata ?? "0x",
      address ?? zeroAddress,
    ],
    enabled:
      !!publicClient && !!selected && mode === "pay" && (amountRaw > 0n || cartCount > 0),
    placeholderData: (previous) => previous,
    retry: false,
    queryFn: async () => {
      const client = publicClient as PublicClient;
      const beneficiary = address ?? zeroAddress;
      if (metadata) {
        // Item checkout goes to the directly resolved terminal so the 721 hook
        // sees the tier metadata.
        const resolved = await resolvePaymentTerminal(client, {
          chainId,
          projectId,
          token: selected!.token,
        });
        const p = await previewPay(client, {
          chainId,
          terminal: resolved.address,
          projectId,
          token: selected!.token,
          amount: amountRaw,
          beneficiary,
          metadata,
        });
        return { ...p, terminal: resolved.address, routeType: resolved.isRouter ? "swap" : "multi" } as const;
      }
      const route = await resolveBestV6PayRoute({
        client,
        chainId,
        projectId,
        token: selected!.token,
        amount: amountRaw,
        beneficiary,
      });
      if (!route) throw new Error("No pay route with a live quote");
      return {
        beneficiaryTokenCount: route.preview.beneficiaryTokenCount,
        reservedTokenCount: route.preview.reservedTokenCount,
        terminal: route.address,
        routeType: route.type,
      } as const;
    },
  });

  // A VERIFIED zero preview may submit (zero-issuance pay is legitimate); an
  // unavailable preview blocks — never send blind.
  const previewReady =
    mode === "addbalance" ||
    (!!preview && !previewError && !previewLoading && !previewIsPrevious);
  const routeIsRouter = preview?.routeType === "swap";

  // ---- Wallet balance ----
  const balanceToken = useMemo<Token[]>(
    () =>
      selected
        ? [
            {
              address: selected.token,
              symbol: selected.symbol,
              decimals: selected.decimals,
              isNative: isNativePayToken(selected.token),
            },
          ]
        : [],
    [selected],
  );
  const { balances } = useTokenBalances(balanceToken, chainId);
  const walletBalance = selected ? (balances.get(selected.token) ?? 0n) : 0n;
  const insufficientBalance = isConnected && !!selected && amountRaw > 0n && amountRaw > walletBalance;

  // Add-to-balance has no on-chain minimum-output field, so a router swap
  // can't be bounded — refuse it; only direct tokens top up.
  const addBalanceViaRouter = mode === "addbalance" && !!selected?.viaRouter;

  // ---- Confirm + send flow ----
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [prepared, setPrepared] = useState<PreparedV6Pay | null>(null);
  const [phase, setPhase] = useState<V6PayPhase>("preparing");
  const [txHash, setTxHash] = useState<`0x${string}` | undefined>(undefined);
  const [txError, setTxError] = useState<string | null>(null);

  const busy =
    confirmOpen &&
    (phase === "approving" || phase === "simulating" || phase === "signing" || phase === "pending");

  const creditOnlyCheckout = mode === "pay" && cartCount > 0 && cartAmountDue === 0n;

  const openConfirm = async () => {
    if (!selected || !publicClient || !address) return;
    if (amountRaw <= 0n && !creditOnlyCheckout) return;
    if (notStarted || surfaceError || addBalanceViaRouter || insufficientBalance) return;
    if (mode === "pay" && (surface?.pausePay || !previewReady)) return;
    if (cartCount > 0 && (shopRoutesLoading || shopCreditsLoading || !shopMatchesToken)) return;

    setTxError(null);
    setTxHash(undefined);
    setPrepared(null);
    setPhase("preparing");
    setConfirmOpen(true);

    try {
      const client = publicClient as PublicClient;
      const cartRows = chainCartItems.map((item) => ({
        tierId: Number(item.tierId),
        quantity: item.quantity,
        name: item.name ?? `Item #${item.tierId}`,
      }));

      let next: PreparedV6Pay;
      if (mode === "pay") {
        // Re-resolve the route at pay time with a fresh preview so the encoded
        // minimum never comes from a stale or missing quote (fail closed).
        let terminal: Address;
        let routeType: "multi" | "swap";
        let freshPreview: PayPreview;
        if (metadata) {
          if (selected.viaRouter) {
            throw new Error("Item checkout requires a directly accepted token.");
          }
          const resolved = await resolvePaymentTerminal(client, {
            chainId,
            projectId,
            token: selected.token,
          });
          terminal = resolved.address;
          routeType = resolved.isRouter ? "swap" : "multi";
          freshPreview = await previewPay(client, {
            chainId,
            terminal,
            projectId,
            token: selected.token,
            amount: amountRaw,
            beneficiary: address,
            metadata,
          });
        } else {
          const route = await resolveBestV6PayRoute({
            client,
            chainId,
            projectId,
            token: selected.token,
            amount: amountRaw,
            beneficiary: address,
          });
          if (!route) {
            throw new Error(
              "Couldn't verify what this payment returns — not sending without a live quote.",
            );
          }
          terminal = route.address;
          routeType = route.type;
          freshPreview = route.preview;
        }

        // 99% of the fresh preview (website payMinTokens parity); a verified
        // zero stays zero.
        const minReturned = minReturnedTokens(freshPreview.beneficiaryTokenCount, 100n);
        const request = buildPayTx({
          chainId,
          terminal,
          projectId,
          token: selected.token,
          amount: amountRaw,
          beneficiary: address,
          minReturnedTokens: minReturned,
          memo: memo.trim() || undefined,
          metadata,
        });
        const abi = routeType === "swap" ? jbRouterTerminalRegistryAbi : jbMultiTerminalAbi;
        next = {
          mode,
          chainId,
          token: selected,
          amount: amountRaw,
          memo: memo.trim(),
          terminal,
          viaRouterRoute: routeType === "swap",
          expectedTokens: freshPreview.beneficiaryTokenCount,
          reservedTokens: freshPreview.reservedTokenCount,
          minReturned,
          needsApproval: await needsApproval(client, selected.token, address, terminal, amountRaw),
          cartRows,
          request: {
            address: request.address,
            abi,
            functionName: request.functionName,
            args: request.args,
            value: request.value,
          },
          calldata: encodeFunctionData({
            abi: jbMultiTerminalAbi,
            functionName: "pay",
            args: request.args,
          }),
        };
      } else {
        if (selected.viaRouter) {
          throw new Error("Add to balance only supports tokens the project accepts directly.");
        }
        const terminal = jbContractAddress[6][JBCoreContracts.JBMultiTerminal][chainId];
        const args = [projectId, selected.token, amountRaw, false, memo.trim(), "0x"] as const;
        const value = isNativePayToken(selected.token) ? amountRaw : 0n;
        next = {
          mode,
          chainId,
          token: selected,
          amount: amountRaw,
          memo: memo.trim(),
          terminal,
          viaRouterRoute: false,
          expectedTokens: null,
          reservedTokens: null,
          minReturned: 0n,
          needsApproval: await needsApproval(client, selected.token, address, terminal, amountRaw),
          cartRows: [],
          request: {
            address: terminal,
            abi: jbMultiTerminalAbi,
            functionName: "addToBalanceOf",
            args,
            value,
          },
          calldata: encodeFunctionData({
            abi: jbMultiTerminalAbi,
            functionName: "addToBalanceOf",
            args,
          }),
        };
      }
      setPrepared(next);
      setPhase("ready");
    } catch (err) {
      setPhase("ready");
      setTxError(formatWalletError(err, "Couldn't prepare the transaction. Please try again."));
    }
  };

  const confirm = async () => {
    if (!prepared || !publicClient || !address) return;
    setTxError(null);
    try {
      if (prepared.needsApproval) {
        // Approve the RESOLVED terminal (may be the router registry).
        setPhase("approving");
        await ensureAllowance(prepared.token.token, prepared.request.address, prepared.amount);
      }
      setPhase("simulating");
      await publicClient.simulateContract({
        address: prepared.request.address,
        abi: prepared.request.abi,
        functionName: prepared.request.functionName,
        args: prepared.request.args as unknown[],
        value: prepared.request.value,
        account: address,
      } as unknown as Parameters<typeof publicClient.simulateContract>[0]);
      setPhase("signing");
      const hash = await writeContractAsync({
        chainId: prepared.chainId,
        address: prepared.request.address,
        abi: prepared.request.abi,
        functionName: prepared.request.functionName,
        args: prepared.request.args as unknown[],
        value: prepared.request.value,
      } as unknown as Parameters<typeof writeContractAsync>[0]);
      setTxHash(hash);
      setPhase("pending");
      await publicClient.waitForTransactionReceipt({ hash });
      setPhase("success");
      toast({
        title: prepared.mode === "pay" ? "Payment confirmed" : "Added to the balance",
        description:
          prepared.mode === "pay"
            ? `You paid ${formatPayAmount(prepared.amount, prepared.token.decimals)} ${prepared.token.symbol}.`
            : "The project balance grew — no tokens were minted.",
      });
    } catch (err) {
      setPhase("ready");
      setTxError(formatWalletError(err));
    }
  };

  const resetAfterSuccess = () => {
    setConfirmOpen(false);
    setPrepared(null);
    setPhase("preparing");
    setTxHash(undefined);
    setTxError(null);
    setAmount("");
    setDebouncedAmount("");
    setMemo("");
    for (const item of chainCartItems) cart.remove(item.tierId, item.chainId);
  };

  const switchChain = (value: string) => {
    const next = chainOptions.find((s) => Number(s.peerChainId) === Number(value));
    if (!next) return;
    setSelectedSucker(next);
    setTokenIndex(0);
    setTokenTouched(false);
    selectedKeyRef.current = null;
    setAmount("");
    setDebouncedAmount("");
  };

  const payDisabled =
    busy ||
    notStarted ||
    surfaceError ||
    !selected ||
    addBalanceViaRouter ||
    insufficientBalance ||
    (surface?.pausePay === true && mode === "pay") ||
    (cartCount > 0 && (shopRoutesLoading || shopCreditsLoading || !shopMatchesToken)) ||
    (amountRaw <= 0n && !creditOnlyCheckout) ||
    (mode === "pay" && !previewReady);

  return (
    <div className="flex flex-col">
      {/* Mode on chain */}
      <div className="mb-3 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-base text-zinc-700">
        <TextSelect
          value={mode}
          onChange={(v) => setMode(v as V6PayMode)}
          disabled={busy}
          ariaLabel="Payment mode"
          options={[
            { value: "pay", label: "Pay" },
            { value: "addbalance", label: "Add to balance" },
          ]}
        />
        {chainOptions.length > 1 ? (
          <>
            <span>on</span>
            <TextSelect
              value={String(chainId)}
              onChange={switchChain}
              disabled={busy}
              ariaLabel="Chain"
              options={chainOptions.map((s) => ({
                value: String(s.peerChainId),
                label: JB_CHAINS[s.peerChainId as JBChainId]?.name ?? String(s.peerChainId),
              }))}
            />
          </>
        ) : null}
      </div>

      {/* 721 shop strip */}
      {shop && shop.tiers.length > 0 && mode === "pay" ? (
        <V6PayShopStrip
          shop={shop}
          chainId={Number(chainId)}
          pricingSymbol={shopPricingSymbol}
          busy={busy}
        />
      ) : null}
      {cartCount > 0 && shopRoutesLoading ? (
        <p className="mb-2 text-xs text-zinc-500">Checking checkout currencies…</p>
      ) : cartCount > 0 && supportedShopTokenIndexes.length === 0 ? (
        <p className="mb-2 text-xs text-red-600">
          No directly accepted payment token has a verified price feed for these items.
        </p>
      ) : cartCount > 0 && !shopMatchesToken ? (
        <p className="mb-2 text-xs text-zinc-500">Switching to a supported checkout currency…</p>
      ) : null}

      {/* Amount + token + pay */}
      <div className="flex items-stretch overflow-hidden border border-zinc-200 bg-white">
        <input
          type="text"
          inputMode="decimal"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          disabled={busy}
          placeholder="0.00"
          aria-label="Amount"
          className="min-w-0 flex-1 bg-transparent px-4 py-3 text-lg outline-none placeholder:text-zinc-400 disabled:opacity-60"
        />
        {tokens.length > 1 ? (
          // Valued by INDEX, not address — a token can appear direct and
          // via-router, so the option stays in lock-step with the selection.
          <TextSelect
            value={String(Math.min(tokenIndex, tokens.length - 1))}
            onChange={(value) => {
              const i = Number(value);
              setTokenIndex(i);
              const picked = tokens[i];
              if (picked) selectedKeyRef.current = payTokenKey(picked);
              setTokenTouched(true);
            }}
            disabled={busy}
            ariaLabel="Payment token"
            className="relative flex shrink-0 items-center gap-1 px-2 text-sm font-medium text-zinc-700"
            labelClassName=""
            selectClassName="absolute inset-0 h-full w-full cursor-pointer opacity-0 disabled:cursor-not-allowed"
            options={tokens.map((t, i) => ({
              value: String(i),
              label: t.viaRouter ? `${t.symbol}*` : t.symbol,
              disabled: cartCount > 0 && !shopRoutes?.[payTokenKey(t)]?.supported,
            }))}
          />
        ) : (
          <span className="flex shrink-0 items-center pr-3 text-sm font-medium text-zinc-700">
            {selected?.symbol ?? nativeSymbol}
          </span>
        )}
        <ButtonWithWallet
          targetChainId={chainId}
          disabled={isConnected ? payDisabled : false}
          loading={busy}
          onClick={openConfirm}
          connectWalletText="Connect"
          className="h-auto shrink-0 rounded-none bg-teal-500 px-5 text-sm hover:bg-teal-600"
        >
          {notStarted ? "Soon" : mode === "pay" ? "Pay" : "Add"}
        </ButtonWithWallet>
      </div>
      {notStarted ? (
        <p className="mt-1.5 text-xs text-zinc-500">
          Starts in {formatStartCountdown(startsAt - now)}.
        </p>
      ) : null}
      {insufficientBalance && selected ? (
        <p className="mt-1.5 text-xs text-red-600">
          You don&apos;t have enough {selected.symbol} on {JB_CHAINS[chainId]?.name}.
        </p>
      ) : null}

      {/* Note */}
      <input
        type="text"
        value={memo}
        onChange={(e) => setMemo(e.target.value.slice(0, 256))}
        disabled={busy}
        placeholder="Add a note (optional)"
        aria-label="Note"
        className="border border-t-0 border-zinc-200 bg-white px-4 py-2.5 text-sm outline-none placeholder:text-zinc-400 disabled:opacity-60"
      />

      {/* Preview */}
      <div className="border border-t-0 border-zinc-200 bg-zinc-100 p-4">
        {mode === "addbalance" ? (
          <p className="text-sm text-zinc-600">Adds to the project balance — nothing else.</p>
        ) : amountRaw > 0n || cartCount > 0 ? (
          previewError ? (
            <p className="text-sm text-red-600">
              Couldn&apos;t verify what this payment returns — paying is disabled until the
              preview works.
            </p>
          ) : (
            <div>
              <div className="text-sm text-zinc-500">
                You get{routeIsRouter ? " at least" : ""}
              </div>
              <div
                aria-live="polite"
                aria-busy={previewLoading}
                className={`text-2xl transition-colors ${
                  previewLoading || previewIsPrevious ? "text-zinc-400" : "text-zinc-900"
                }`}
              >
                {preview ? formatPayAmount(preview.beneficiaryTokenCount, 18) : "…"}{" "}
                {projectTokenLabel}
                {routeIsRouter ? (
                  <span className="ml-2 align-middle text-xs text-zinc-500">via router</span>
                ) : null}
              </div>
              {preview && preview.beneficiaryTokenCount === 0n && !previewLoading ? (
                <p className="mt-1 text-xs text-zinc-500">
                  This payment mints no {projectTokenLabel} under the current rules.
                </p>
              ) : null}
              {preview && preview.reservedTokenCount > 0n ? (
                <p className="mt-1 text-sm text-zinc-500">
                  Splits get {formatPayAmount(preview.reservedTokenCount, 18)} {projectTokenLabel}
                </p>
              ) : null}

              {cartCount > 0 && shop ? (
                <div className="mt-3 space-y-1 border-t border-zinc-200 pt-2 text-xs">
                  {chainCartItems.map((item) => (
                    <div key={item.tierId.toString()} className="flex justify-between gap-3">
                      <span className="truncate text-zinc-600">
                        {item.quantity}× {item.name ?? `Item #${item.tierId}`}
                      </span>
                    </div>
                  ))}
                  <div className="flex justify-between gap-3">
                    <span className="text-zinc-600">
                      {cartCount} item{cartCount === 1 ? "" : "s"}
                    </span>
                    <span className="tabular-nums text-zinc-900">
                      {formatPayAmount(cartTotal, shop.pricingDecimals)} {shopPricingSymbol}
                    </span>
                  </div>
                  {address && shopCreditsLoading ? (
                    <div className="flex justify-between gap-3 text-zinc-500">
                      <span>Shop credit</span>
                      <span>Checking…</span>
                    </div>
                  ) : shopCreditApplied > 0n ? (
                    <div className="flex justify-between gap-3 text-teal-700">
                      <span>Shop credit applied</span>
                      <span className="tabular-nums">
                        −{formatPayAmount(shopCreditApplied, shop.pricingDecimals)}{" "}
                        {shopPricingSymbol}
                      </span>
                    </div>
                  ) : null}
                  {restrictedCartTotal > 0n && shopCreditApplied > 0n ? (
                    <div className="flex justify-between gap-3 text-zinc-500">
                      <span>Fresh payment required</span>
                      <span className="tabular-nums">
                        {formatPayAmount(restrictedCartTotal, shop.pricingDecimals)}{" "}
                        {shopPricingSymbol}
                      </span>
                    </div>
                  ) : null}
                  <div className="flex justify-between gap-3 pt-0.5 font-medium text-zinc-900">
                    <span>Amount due</span>
                    <span className="tabular-nums">
                      {formatPayAmount(cartAmountDue, shop.pricingDecimals)} {shopPricingSymbol}
                    </span>
                  </div>
                </div>
              ) : null}
            </div>
          )
        ) : (
          <p className="text-sm text-zinc-400">Enter an amount to preview what you get.</p>
        )}
      </div>

      {/* Notices */}
      {surfaceError ? (
        <p className="mt-2 text-sm text-red-600">
          Couldn&apos;t verify this project&apos;s accepted tokens — payments are disabled.
        </p>
      ) : null}
      {surface?.pausePay && mode === "pay" ? (
        <p className="mt-2 text-sm text-zinc-600">Payments are paused under the current rules.</p>
      ) : null}
      {addBalanceViaRouter ? (
        <p className="mt-2 text-sm text-zinc-600">
          Add to balance only supports tokens the project accepts directly — switch to a direct
          token, or use Pay to route this one.
        </p>
      ) : null}
      {tokens.some((t) => t.viaRouter) ? (
        <p className="mt-2 text-xs text-zinc-400">
          * Swapped into the project&apos;s accounting token via the router.
        </p>
      ) : null}

      <BuildPromptFooter title="Pay" concept="pay" />

      <V6PayConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        prepared={prepared}
        phase={phase}
        error={txError}
        projectTokenSymbol={projectTokenLabel}
        txHash={txHash}
        onConfirm={confirm}
        onDone={resetAfterSuccess}
      />
    </div>
  );
}

async function needsApproval(
  client: PublicClient,
  token: Address,
  owner: Address,
  spender: Address,
  amount: bigint,
): Promise<boolean> {
  if (isNativePayToken(token) || amount === 0n) return false;
  const allowance = await client.readContract({
    address: token,
    abi: erc20Abi,
    functionName: "allowance",
    args: [owner, spender],
  });
  return allowance < amount;
}
