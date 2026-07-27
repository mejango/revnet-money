"use client";

import { wagmiConfig } from "@/lib/wagmiConfig";
import { JB_CHAINS, JBChainId } from "@bananapus/nana-sdk-core";
import { useEffect, useState } from "react";
import { getPublicClient } from "wagmi/actions";
import { customReserveCoversChains, verifyCustomReserveAsset } from "../helpers/customReserveAsset";
import { useCreateForm } from "./useCreateForm";

type LookupState =
  | { kind: "idle"; message: string }
  | { kind: "loading"; message: string }
  | { kind: "success"; message: string }
  | { kind: "error"; message: string };

export function AssetsSection({ disabled = false }: { disabled?: boolean }) {
  const { values, setFieldValue, revnetTokenSymbol } = useCreateForm();
  const { reserveAsset, customReserveAsset, chainIds } = values;
  const customSelected = reserveAsset === "CUSTOM";
  const [lookup, setLookup] = useState<LookupState>({
    kind: "idle",
    message: "",
  });
  const chainKey = chainIds.map(Number).join(",");

  useEffect(() => {
    if (!customSelected) {
      setLookup({ kind: "idle", message: "" });
      return;
    }
    const address = customReserveAsset.address.trim();
    if (!address) {
      setLookup({ kind: "idle", message: "Enter an ERC-20 address, then choose the chains." });
      return;
    }
    if (chainIds.length === 0) {
      setLookup({
        kind: "idle",
        message: "Choose at least one chain below to verify this token.",
      });
      return;
    }

    let stale = false;
    setLookup({ kind: "loading", message: "Verifying the token on every selected chain…" });
    const timeout = window.setTimeout(async () => {
      try {
        const verified = await verifyCustomReserveAsset(address, chainIds, (chainId) =>
          getPublicClient(wagmiConfig, { chainId }),
        );
        if (stale) return;
        setFieldValue("customReserveAsset", verified);
        setLookup({
          kind: "success",
          message: `${verified.symbol} · ${verified.decimals} decimals · verified on ${chainIds
            .map((chainId) => JB_CHAINS[chainId]?.name ?? chainId)
            .join(", ")}`,
        });
      } catch (error) {
        if (stale) return;
        setFieldValue("customReserveAsset", {
          address,
          symbol: "",
          decimals: null,
          verifiedChainIds: [],
        });
        setLookup({
          kind: "error",
          message: error instanceof Error ? error.message : "Could not verify this token.",
        });
      }
    }, 400);

    return () => {
      stale = true;
      window.clearTimeout(timeout);
    };
    // Reverify when the address or deployment-chain set changes. Metadata writes
    // must not restart the lookup that produced them.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customSelected, customReserveAsset.address, chainKey]);

  const selectReserve = (next: "ETH" | "USDC" | "CUSTOM") => {
    setFieldValue("reserveAsset", next);
    if (next === "CUSTOM" && customReserveAsset.address) {
      setFieldValue("customReserveAsset", {
        ...customReserveAsset,
        symbol: "",
        decimals: null,
        verifiedChainIds: [],
      });
    }
  };

  const verified =
    customSelected && customReserveCoversChains(customReserveAsset, chainIds as JBChainId[]);

  return (
    <>
      <div className="md:col-span-1">
        <h2 className="mb-4 text-lg font-bold md:mb-2">2. Assets</h2>
        <p className="text-lg text-zinc-600">
          Pick which reserve asset will back the value of {revnetTokenSymbol}.
        </p>
      </div>
      <div className="col-span-2 mt-6 mb-4 md:mt-0">
        <span className="mr-4 text-md font-semibold">Choose your reserve asset</span>
        <div className="mt-2 flex flex-wrap gap-x-8 gap-y-3">
          {(["ETH", "USDC", "CUSTOM"] as const).map((asset) => (
            <label className="flex items-center gap-2" key={asset}>
              <input
                type="radio"
                name="reserveAsset"
                value={asset}
                checked={reserveAsset === asset}
                onChange={() => selectReserve(asset)}
                disabled={disabled}
              />
              {asset === "CUSTOM" ? "Custom token" : asset}
            </label>
          ))}
        </div>

        {customSelected ? (
          <div className="mt-5 max-w-xl border-l border-zinc-300 pl-4">
            <label className="block text-sm font-semibold" htmlFor="customReserveAsset.address">
              ERC-20 token address
            </label>
            <input
              id="customReserveAsset.address"
              type="text"
              className="mt-2 h-10 w-full border border-zinc-300 bg-white px-3 font-mono text-sm"
              placeholder="0x…"
              value={customReserveAsset.address}
              onChange={(event) =>
                setFieldValue("customReserveAsset", {
                  address: event.target.value.trim(),
                  symbol: "",
                  decimals: null,
                  verifiedChainIds: [],
                })
              }
              disabled={disabled}
              autoComplete="off"
              spellCheck={false}
            />
            {lookup.message ? (
              <p
                className={`mt-2 text-sm ${
                  lookup.kind === "error"
                    ? "text-red-700"
                    : lookup.kind === "success"
                      ? "text-teal-700"
                      : "text-zinc-500"
                }`}
                role={lookup.kind === "error" ? "alert" : "status"}
              >
                {lookup.message}
              </p>
            ) : null}
            <p className="mt-3 text-sm text-zinc-600">
              A custom reserve is exclusive. {verified ? customReserveAsset.symbol : "The token"}{" "}
              becomes the denomination for issuance and shop prices, so no ETH or USD price feed is
              needed. It must exist at the same address with the same symbol and decimals on every
              selected chain.
            </p>
            {chainIds.length > 1 ? (
              <p className="mt-2 text-sm text-zinc-600">
                Linked chains bridge the revnet token. Custom reserve balances remain local because
                the protocol has no canonical cross-chain mapping for arbitrary ERC-20s.
              </p>
            ) : null}
          </div>
        ) : null}
      </div>
    </>
  );
}
