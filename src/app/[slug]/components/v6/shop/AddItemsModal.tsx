"use client";

import { pinJsonMetadata, pinMediaFile } from "@/app/create/helpers/pinProjectMetaData";
import { ButtonWithWallet } from "@/components/ButtonWithWallet";
import { ChainLogo } from "@/components/ChainLogo";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  requireOnchainExecution,
  submittedViaSafe,
  useWriteContract,
} from "@/hooks/useReviewedWriteContract";
import { cidFromIpfsUri } from "@/lib/ipfs";
import { jb721TiersHookAbi, JB_CHAINS, JBChainId } from "@bananapus/nana-sdk-core";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Address, Hex, isAddress, parseUnits, PublicClient, zeroAddress } from "viem";
import { useAccount, useConfig, usePublicClient } from "wagmi";
import { waitForTransactionReceipt } from "wagmi/actions";
import { encodeIpfsCid, ShopInventory, TIER_UNLIMITED_SUPPLY } from "./shopLib";
import { canAdjust721Tiers } from "./shopPermissions";

interface DraftSplit {
  percent: string;
  beneficiary: string;
}

export interface DraftItem {
  name: string;
  description: string;
  mediaUri: string;
  mediaFile: File | null;
  mediaPreview: string | null;
  /** ipfs:// URI (or bare DAG-PB CID) of the item's metadata JSON. Optional. */
  uri: string;
  price: string;
  /** Empty = unlimited. */
  supply: string;
  category: string;
  reserveFrequency: string;
  reserveBeneficiary: string;
  discountPct: string;
  votingUnits: string;
  splits: DraftSplit[];
  allowOwnerMint: boolean;
  cantBeRemoved: boolean;
  allowCredits: boolean;
  operatorCanEditDiscount: boolean;
  moreOpen: boolean;
}

export function newDraftItem(): DraftItem {
  return {
    name: "",
    description: "",
    mediaUri: "",
    mediaFile: null,
    mediaPreview: null,
    uri: "",
    price: "",
    supply: "",
    category: "0",
    reserveFrequency: "",
    reserveBeneficiary: "",
    discountPct: "",
    votingUnits: "",
    splits: [],
    allowOwnerMint: false,
    cantBeRemoved: false,
    allowCredits: true,
    operatorCanEditDiscount: true,
    moreOpen: false,
  };
}

const MAX_UINT104 = (1n << 104n) - 1n;
const MAX_MEDIA_BYTES = 25 * 1024 * 1024;
const ZERO_BYTES32 = `0x${"0".repeat(64)}` as Hex;

type TierConfig = {
  price: bigint;
  initialSupply: number;
  votingUnits: number;
  reserveFrequency: number;
  reserveBeneficiary: Address;
  encodedIpfsUri: Hex;
  category: number;
  discountPercent: number;
  flags: {
    allowOwnerMint: boolean;
    useReserveBeneficiaryAsDefault: boolean;
    transfersPausable: boolean;
    useVotingUnits: boolean;
    cantBeRemoved: boolean;
    cantIncreaseDiscountPercent: boolean;
    cantBuyWithCredits: boolean;
  };
  splitPercent: number;
  splits: {
    percent: number;
    projectId: bigint;
    beneficiary: Address;
    preferAddToBalance: boolean;
    lockedUntil: number;
    hook: Address;
  }[];
};

/**
 * Validate the drafts and build the `adjustTiers` tier configs.
 *
 * Two order-sensitive store rules are handled here:
 * - tiers must be sorted by ascending category (`InvalidCategorySortOrder`);
 * - `recordAddTiers` validates each tier strictly IN ARRAY ORDER, so a tier
 *   with `reserveFrequency > 0` and no beneficiary reverts with
 *   `MissingReserveBeneficiary` unless a default was set BEFORE it. We avoid
 *   the trap at the root by requiring an explicit per-tier beneficiary for
 *   every reserved tier (`useReserveBeneficiaryAsDefault` stays false).
 */
export function buildTierConfigs(items: DraftItem[], decimals: number): TierConfig[] | string {
  const configs: TierConfig[] = [];
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const label = items.length > 1 ? `Item ${i + 1}: ` : "";

    let price: bigint;
    try {
      price = parseUnits(item.price.trim(), decimals);
    } catch {
      return `${label}enter a valid price.`;
    }
    if (price < 0n || price > MAX_UINT104) return `${label}the price must fit uint104.`;

    const supplyStr = item.supply.trim();
    if (supplyStr !== "" && !/^\d+$/.test(supplyStr)) {
      return `${label}the supply must be a whole number (or empty for unlimited).`;
    }
    const initialSupply = supplyStr === "" ? TIER_UNLIMITED_SUPPLY : Number(supplyStr);
    if (initialSupply <= 0 || initialSupply > TIER_UNLIMITED_SUPPLY) {
      return `${label}the supply must be between 1 and ${TIER_UNLIMITED_SUPPLY.toLocaleString("en-US")}, or empty for unlimited.`;
    }

    const categoryStr = item.category.trim() || "0";
    if (!/^\d+$/.test(categoryStr) || Number(categoryStr) > 0xffffff) {
      return `${label}the category must be a number that fits uint24.`;
    }
    const category = Number(categoryStr);

    const reserveStr = item.reserveFrequency.trim() || "0";
    if (!/^\d+$/.test(reserveStr) || Number(reserveStr) > 0xffff) {
      return `${label}the reserve frequency must fit uint16.`;
    }
    const reserveFrequency = Number(reserveStr);
    let reserveBeneficiary: Address = zeroAddress;
    if (reserveFrequency > 0) {
      if (initialSupply === 1) {
        return `${label}a reserved item needs a supply of at least 2 (or unlimited).`;
      }
      if (!isAddress(item.reserveBeneficiary.trim())) {
        return `${label}enter a reserve beneficiary address (required when a reserve frequency is set).`;
      }
      reserveBeneficiary = item.reserveBeneficiary.trim() as Address;
    }

    const votingStr = item.votingUnits.trim() || "0";
    if (!/^\d+$/.test(votingStr) || BigInt(votingStr) > 0xffffffffn) {
      return `${label}voting units must be a whole number that fits uint32.`;
    }
    const votingUnits = Number(votingStr);

    const discountText = item.discountPct.trim() || "0";
    const discountPct = Number(discountText);
    if (!Number.isFinite(discountPct) || discountPct < 0 || discountPct > 100) {
      return `${label}the discount must be between 0 and 100%.`;
    }
    const discountPercent = Math.round(discountPct * 2);

    const validSplits = item.splits.filter(
      (split) => split.percent.trim() || split.beneficiary.trim(),
    );
    const splitValues: number[] = [];
    for (let splitIndex = 0; splitIndex < validSplits.length; splitIndex++) {
      const split = validSplits[splitIndex];
      const percent = Number(split.percent);
      if (!Number.isFinite(percent) || percent <= 0) {
        return `${label}split ${splitIndex + 1} needs a percentage above 0.`;
      }
      if (!isAddress(split.beneficiary.trim())) {
        return `${label}split ${splitIndex + 1} needs a valid beneficiary address.`;
      }
      splitValues.push(percent);
    }
    const totalSplitPct = splitValues.reduce((total, value) => total + value, 0);
    if (totalSplitPct > 100) return `${label}sales splits cannot add up to more than 100%.`;
    const splitPercents = splitValues.map((value) => Math.round((value / totalSplitPct) * 1e9));
    if (splitPercents.length > 0) {
      splitPercents[splitPercents.length - 1] =
        1e9 - splitPercents.slice(0, -1).reduce((total, value) => total + value, 0);
    }
    const splits = validSplits.map((split, splitIndex) => ({
      percent: splitPercents[splitIndex],
      projectId: 0n,
      beneficiary: split.beneficiary.trim() as Address,
      preferAddToBalance: false,
      lockedUntil: 0,
      hook: zeroAddress,
    }));

    let encodedIpfsUri: Hex = ZERO_BYTES32;
    const uri = item.uri.trim();
    if (uri) {
      const cid = uri.startsWith("ipfs://") ? cidFromIpfsUri(uri) : uri;
      if (!cid) return `${label}the metadata URI must contain an IPFS CID.`;
      try {
        encodedIpfsUri = encodeIpfsCid(cid);
      } catch {
        return `${label}the metadata must use a DAG-PB CIDv0 or CIDv1 without a path.`;
      }
    }

    configs.push({
      price,
      initialSupply,
      votingUnits,
      reserveFrequency,
      reserveBeneficiary,
      encodedIpfsUri,
      category,
      discountPercent,
      flags: {
        allowOwnerMint: item.allowOwnerMint,
        useReserveBeneficiaryAsDefault: false,
        transfersPausable: false,
        useVotingUnits: votingUnits > 0,
        cantBeRemoved: item.cantBeRemoved,
        cantIncreaseDiscountPercent: !item.operatorCanEditDiscount,
        cantBuyWithCredits: !item.allowCredits,
      },
      splitPercent: Math.round((totalSplitPct / 100) * 1e9),
      splits,
    });
  }
  // The store reverts InvalidCategorySortOrder unless categories ascend.
  return configs.sort((a, b) => a.category - b.category);
}

/**
 * Operator "+ Add items" (website/ openAddTierModal + submitAddTiers parity):
 * stage items → simulate `adjustTiers` on the 721 hook → send. Simulation runs
 * first on every submit so a would-revert call never reaches the wallet.
 */
export function AddItemsModal({
  shop,
  chainId,
  projectId,
  categories,
  onClose,
}: {
  shop: ShopInventory;
  chainId: JBChainId;
  projectId: bigint;
  categories: { id: number; name: string }[];
  onClose: () => void;
}) {
  const config = useConfig();
  const queryClient = useQueryClient();
  const publicClient = usePublicClient({ chainId });
  const { address } = useAccount();
  const { writeContractAsync } = useWriteContract({
    transactionReview: {
      title: "Review shop items",
      description:
        "Review the live shop hook, decoded tier settings, and exact calldata before sending.",
      label: "Add shop items",
      contractName: "JB721TiersHook",
      confirmLabel: "Confirm & send",
    },
  });

  const [items, setItems] = useState<DraftItem[]>([newDraftItem()]);
  const [phase, setPhase] = useState<
    "form" | "pinning" | "simulating" | "sending" | "confirming" | "safe-proposed" | "done"
  >("form");
  const [error, setError] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<`0x${string}` | null>(null);
  const mediaPreviews = useRef(new Set<string>());
  useEffect(
    () => () => {
      for (const preview of mediaPreviews.current) URL.revokeObjectURL(preview);
      mediaPreviews.current.clear();
    },
    [],
  );

  const busy =
    phase === "pinning" || phase === "simulating" || phase === "sending" || phase === "confirming";

  const updateItem = (index: number, patch: Partial<DraftItem>) => {
    setItems((current) => current.map((item, i) => (i === index ? { ...item, ...patch } : item)));
    setError(null);
  };

  const selectMedia = (index: number, file: File | null) => {
    if (file && file.size > MAX_MEDIA_BYTES) {
      setError("Media must be 25 MB or smaller.");
      return;
    }
    const previous = items[index]?.mediaPreview;
    if (previous) {
      URL.revokeObjectURL(previous);
      mediaPreviews.current.delete(previous);
    }
    const mediaPreview = file?.type.startsWith("image/") ? URL.createObjectURL(file) : null;
    if (mediaPreview) mediaPreviews.current.add(mediaPreview);
    updateItem(index, {
      mediaFile: file,
      mediaPreview,
    });
  };

  const removeItem = (index: number) => {
    const preview = items[index]?.mediaPreview;
    if (preview) {
      URL.revokeObjectURL(preview);
      mediaPreviews.current.delete(preview);
    }
    setItems((current) => current.filter((_, i) => i !== index));
    setError(null);
  };

  const submit = async () => {
    if (!address || !publicClient || busy) return;
    setError(null);

    try {
      setPhase("simulating");
      const authorized = await canAdjust721Tiers(publicClient as PublicClient, {
        chainId,
        projectId,
        hook: shop.hook,
        operator: address,
      });
      if (!authorized) throw new Error("This wallet cannot manage this shop.");

      for (let index = 0; index < items.length; index++) {
        const item = items[index];
        if (
          (item.name.trim() || item.description.trim() || item.mediaUri.trim() || item.mediaFile) &&
          !item.name.trim()
        ) {
          throw new Error(
            `${items.length > 1 ? `Item ${index + 1}: ` : ""}enter a name when composing item metadata.`,
          );
        }
      }
      const draftConfigs = buildTierConfigs(items, shop.pricing.decimals);
      if (typeof draftConfigs === "string") throw new Error(draftConfigs);

      setPhase("pinning");
      const preparedItems = await Promise.all(
        items.map(async (item, index) => {
          let mediaUri = item.mediaUri.trim();
          if (item.mediaFile) {
            const mediaCid = await pinMediaFile(item.mediaFile);
            mediaUri = `ipfs://${mediaCid}`;
          }
          const composesMetadata = item.name.trim() || item.description.trim() || mediaUri;
          if (!composesMetadata) return item;
          if (!item.name.trim()) {
            throw new Error(
              `${items.length > 1 ? `Item ${index + 1}: ` : ""}enter a name when composing item metadata.`,
            );
          }
          const cid = await pinJsonMetadata({
            name: item.name.trim(),
            ...(item.description.trim() ? { description: item.description.trim() } : {}),
            ...(mediaUri
              ? item.mediaFile && !item.mediaFile.type.startsWith("image/")
                ? { animation_url: mediaUri, mediaType: item.mediaFile.type }
                : { image: mediaUri }
              : {}),
          });
          return { ...item, uri: `ipfs://${cid}` };
        }),
      );
      const configs = buildTierConfigs(preparedItems, shop.pricing.decimals);
      if (typeof configs === "string") throw new Error(configs);

      // Simulate first — a revert (missing ADJUST_721_TIERS permission, bad
      // ordering, hook paused…) surfaces here instead of costing gas.
      setPhase("simulating");
      const { request } = await (publicClient as PublicClient).simulateContract({
        address: shop.hook,
        abi: jb721TiersHookAbi,
        functionName: "adjustTiers",
        args: [configs, []],
        account: address,
      });

      setPhase("sending");
      // The simulated request is the exact call — wagmi's union type just
      // can't carry the tuple inference across the runtime chain.
      const hash = await writeContractAsync(request as never);
      setTxHash(hash);

      setPhase("confirming");
      if (submittedViaSafe(hash)) {
        setPhase("safe-proposed");
        return;
      }
      requireOnchainExecution(hash, "Shop item update");
      const receipt = await waitForTransactionReceipt(config, { chainId, hash });
      if (receipt.status !== "success") throw new Error("The transaction failed.");

      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["v6Shop721", chainId, projectId.toString()] }),
        queryClient.invalidateQueries({ queryKey: ["v6PayShop", chainId, projectId.toString()] }),
        queryClient.invalidateQueries({ queryKey: ["v6Shop721Media", chainId, shop.hook] }),
      ]);
      setPhase("done");
    } catch (err) {
      setPhase("form");
      setError(shortError(err));
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Add items for sale</DialogTitle>
          <DialogDescription>
            Stage one or more items, then add them to the collection in one revnet operator
            transaction.
          </DialogDescription>
        </DialogHeader>

        {phase === "done" || phase === "safe-proposed" ? (
          <div className="py-6 text-center">
            <p className="text-sm font-medium text-zinc-900">
              {phase === "safe-proposed"
                ? "Safe proposal submitted"
                : `${items.length} item${items.length === 1 ? "" : "s"} added.`}
            </p>
            {phase === "safe-proposed" ? (
              <p className="mx-auto mt-2 max-w-md text-sm text-zinc-600">
                The items have not been added yet. The Safe still needs its approvals and onchain
                execution; follow the persistent transaction status before trying again.
              </p>
            ) : null}
            {txHash ? (
              <p className="mt-1 break-all font-mono text-xs text-zinc-500">{txHash}</p>
            ) : null}
            <Button className="mt-4" onClick={onClose}>
              Done
            </Button>
          </div>
        ) : (
          <>
            <div className="flex flex-col gap-5">
              {items.map((item, index) => (
                <div key={index} className="bg-melon-50 p-4 sm:p-5">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-zinc-800">Item {index + 1}</span>
                    {items.length > 1 ? (
                      <button
                        type="button"
                        onClick={() => removeItem(index)}
                        disabled={busy}
                        className="text-xs text-zinc-600 underline underline-offset-2 hover:text-zinc-900"
                      >
                        Remove
                      </button>
                    ) : null}
                  </div>

                  <div className="mt-4 flex flex-col gap-4 sm:flex-row">
                    <div className="flex shrink-0 flex-col items-start gap-2">
                      {item.mediaPreview ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={item.mediaPreview}
                          alt=""
                          className="h-20 w-20 border border-zinc-200 object-cover"
                        />
                      ) : (
                        <span className="flex h-20 w-20 items-center justify-center border border-dashed border-zinc-300 bg-white text-2xl">
                          {item.mediaFile ? "📄" : "🖼️"}
                        </span>
                      )}
                      <label className="cursor-pointer border border-zinc-300 bg-white px-3 py-2 text-xs font-medium hover:border-zinc-500">
                        {item.mediaFile ? "Change media" : "Upload media"}
                        <input
                          type="file"
                          accept="image/*,video/*,audio/*,application/pdf,text/*,.md,.markdown"
                          disabled={busy}
                          className="sr-only"
                          onChange={(event) => selectMedia(index, event.target.files?.[0] ?? null)}
                        />
                      </label>
                    </div>

                    <div className="min-w-0 flex-1 space-y-3">
                      <Input
                        aria-label={`Item ${index + 1} name`}
                        value={item.name}
                        onChange={(e) => updateItem(index, { name: e.target.value })}
                        placeholder="Item name"
                        disabled={busy}
                        className="h-11 bg-white"
                      />
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <div>
                          <Label className="text-xs">Price ({shop.pricing.symbol})</Label>
                          <Input
                            value={item.price}
                            onChange={(e) => updateItem(index, { price: e.target.value })}
                            placeholder={shop.pricing.symbol === "USD" ? "25" : "0.01"}
                            inputMode="decimal"
                            disabled={busy}
                            className="mt-1 h-11 bg-white"
                          />
                        </div>
                        <div>
                          <Label className="text-xs">Quantity</Label>
                          <Input
                            value={item.supply}
                            onChange={(e) => updateItem(index, { supply: e.target.value })}
                            placeholder="Unlimited"
                            inputMode="numeric"
                            disabled={busy}
                            className="mt-1 h-11 bg-white"
                          />
                        </div>
                      </div>
                    </div>
                  </div>

                  <Input
                    value={item.description}
                    onChange={(e) => updateItem(index, { description: e.target.value })}
                    placeholder="Short description (optional)"
                    disabled={busy}
                    className="mt-3 h-11 bg-white"
                  />

                  <button
                    type="button"
                    onClick={() => updateItem(index, { moreOpen: !item.moreOpen })}
                    disabled={busy}
                    aria-expanded={item.moreOpen}
                    className="mt-3 text-xs font-medium text-blue-600 hover:text-blue-800"
                  >
                    {item.moreOpen ? "Fewer options" : "More options"}
                  </button>

                  {item.moreOpen ? (
                    <div className="mt-4 space-y-5 border-t border-zinc-200 pt-4">
                      <div>
                        <Label className="text-xs">Category</Label>
                        <p className="mt-1 text-xs text-zinc-500">
                          Group this item with others in the collection.
                        </p>
                        <select
                          value={item.category}
                          onChange={(e) => updateItem(index, { category: e.target.value })}
                          disabled={busy}
                          className="mt-2 h-11 min-w-56 border border-zinc-300 bg-white px-3 text-sm"
                        >
                          <option value="0">Default</option>
                          {categories
                            .filter((category) => category.id !== 0)
                            .map((category) => (
                              <option key={category.id} value={category.id}>
                                {category.name}
                              </option>
                            ))}
                        </select>
                      </div>

                      <div>
                        <Label className="text-xs">Split sales</Label>
                        <p className="mt-1 text-xs text-zinc-500">
                          Route a share of each sale to other wallets.
                        </p>
                        {item.splits.length > 0 ? (
                          <div className="mt-2 space-y-2">
                            {item.splits.map((split, splitIndex) => (
                              <div
                                key={splitIndex}
                                className="grid grid-cols-[5.5rem_minmax(0,1fr)_auto] gap-2"
                              >
                                <Input
                                  aria-label={`Split ${splitIndex + 1} percent`}
                                  value={split.percent}
                                  onChange={(e) => {
                                    const splits = item.splits.map((current, i) =>
                                      i === splitIndex
                                        ? { ...current, percent: e.target.value }
                                        : current,
                                    );
                                    updateItem(index, { splits });
                                  }}
                                  placeholder="%"
                                  inputMode="decimal"
                                  disabled={busy}
                                  className="h-10 bg-white"
                                />
                                <Input
                                  aria-label={`Split ${splitIndex + 1} beneficiary`}
                                  value={split.beneficiary}
                                  onChange={(e) => {
                                    const splits = item.splits.map((current, i) =>
                                      i === splitIndex
                                        ? { ...current, beneficiary: e.target.value }
                                        : current,
                                    );
                                    updateItem(index, { splits });
                                  }}
                                  placeholder="0x… beneficiary"
                                  disabled={busy}
                                  className="h-10 bg-white font-mono text-xs"
                                />
                                <button
                                  type="button"
                                  aria-label={`Remove split ${splitIndex + 1}`}
                                  onClick={() =>
                                    updateItem(index, {
                                      splits: item.splits.filter((_, i) => i !== splitIndex),
                                    })
                                  }
                                  disabled={busy}
                                  className="px-2 text-zinc-500 hover:text-zinc-900"
                                >
                                  ×
                                </button>
                              </div>
                            ))}
                          </div>
                        ) : null}
                        <button
                          type="button"
                          onClick={() =>
                            updateItem(index, {
                              splits: [...item.splits, { percent: "", beneficiary: "" }],
                            })
                          }
                          disabled={busy}
                          className="mt-2 border border-dashed border-zinc-400 bg-white px-3 py-2 text-xs font-medium"
                        >
                          + Add a recipient
                        </button>
                      </div>

                      <div>
                        <Label className="text-xs">Discount</Label>
                        <p className="mt-1 text-xs text-zinc-500">
                          Launch this item at a discount off its listed price.
                        </p>
                        <div className="mt-2 flex items-center gap-2">
                          <Input
                            value={item.discountPct}
                            onChange={(e) => updateItem(index, { discountPct: e.target.value })}
                            placeholder="0"
                            inputMode="decimal"
                            disabled={busy}
                            className="h-10 w-24 bg-white"
                          />
                          <span className="text-sm text-zinc-600">% off</span>
                        </div>
                      </div>

                      <div>
                        <Label className="text-xs">Reserve inventory</Label>
                        <p className="mt-1 text-xs text-zinc-500">
                          Set aside some inventory for a specific wallet as others buy it.
                        </p>
                        {shop.configFlags?.noNewTiersWithReserves ? (
                          <p className="mt-2 text-xs text-zinc-500">
                            This collection no longer accepts new reserved items.
                          </p>
                        ) : (
                          <div className="mt-2 flex flex-wrap items-center gap-2">
                            <span className="text-sm text-zinc-600">1 of every</span>
                            <Input
                              value={item.reserveFrequency}
                              onChange={(e) =>
                                updateItem(index, { reserveFrequency: e.target.value })
                              }
                              placeholder="—"
                              inputMode="numeric"
                              disabled={busy}
                              className="h-10 w-20 bg-white"
                            />
                            <span className="text-sm text-zinc-600">sold goes to</span>
                            <Input
                              value={item.reserveBeneficiary}
                              onChange={(e) =>
                                updateItem(index, { reserveBeneficiary: e.target.value })
                              }
                              placeholder="0x… beneficiary"
                              disabled={busy}
                              className="h-10 min-w-52 flex-1 bg-white font-mono text-xs"
                            />
                          </div>
                        )}
                      </div>

                      <div>
                        <Label className="text-xs">Voting power</Label>
                        <p className="mt-1 text-xs text-zinc-500">
                          Give each item a custom number of governance votes.
                        </p>
                        {shop.configFlags?.noNewTiersWithVotes ? (
                          <p className="mt-2 text-xs text-zinc-500">
                            This collection no longer accepts items with voting units.
                          </p>
                        ) : (
                          <div className="mt-2 flex items-center gap-2">
                            <Input
                              value={item.votingUnits}
                              onChange={(e) => updateItem(index, { votingUnits: e.target.value })}
                              placeholder="0"
                              inputMode="numeric"
                              disabled={busy}
                              className="h-10 w-28 bg-white"
                            />
                            <span className="text-sm text-zinc-600">votes each</span>
                          </div>
                        )}
                      </div>

                      <div>
                        <Label className="text-xs">Item rules</Label>
                        <div className="mt-2 space-y-2">
                          {(
                            [
                              {
                                key: "allowOwnerMint" as const,
                                title: "Revnet operator can mint for free",
                                description:
                                  "The revnet operator can mint this item without paying.",
                                disabled: !!shop.configFlags?.noNewTiersWithOwnerMinting,
                              },
                              {
                                key: "cantBeRemoved" as const,
                                title: "Permanent",
                                description: "This item can never be removed from the shop.",
                                disabled: false,
                              },
                              {
                                key: "allowCredits" as const,
                                title: "Allow credit purchases",
                                description: "Buyers can spend leftover pay credits on this item.",
                                disabled: false,
                              },
                              {
                                key: "operatorCanEditDiscount" as const,
                                title: "Discounts can change later",
                                description:
                                  "The revnet operator can raise or end the discount after launch.",
                                disabled: false,
                              },
                            ] as const
                          ).map((rule) => (
                            <label
                              key={rule.key}
                              className="flex gap-3 border border-zinc-200 bg-white p-3"
                            >
                              <input
                                type="checkbox"
                                checked={item[rule.key]}
                                onChange={() => updateItem(index, { [rule.key]: !item[rule.key] })}
                                disabled={busy || rule.disabled}
                                className="mt-0.5 h-4 w-4"
                              />
                              <span>
                                <span className="block text-sm font-medium text-zinc-800">
                                  {rule.title}
                                </span>
                                <span className="mt-0.5 block text-xs text-zinc-500">
                                  {rule.disabled
                                    ? "This collection has locked this option."
                                    : rule.description}
                                </span>
                              </span>
                            </label>
                          ))}
                        </div>
                      </div>

                      <div>
                        <Label className="text-xs">Use existing metadata (optional)</Label>
                        <p className="mt-1 text-xs text-zinc-500">
                          Enter already-pinned metadata, or a media URI if you are not uploading a
                          file.
                        </p>
                        <Input
                          value={item.uri}
                          onChange={(e) => updateItem(index, { uri: e.target.value })}
                          placeholder="ipfs://Qm… metadata"
                          disabled={busy}
                          className="mt-2 h-10 bg-white font-mono text-xs"
                        />
                        <Input
                          value={item.mediaUri}
                          onChange={(e) => updateItem(index, { mediaUri: e.target.value })}
                          placeholder="ipfs://… or https://… media"
                          disabled={busy || !!item.mediaFile}
                          className="mt-2 h-10 bg-white font-mono text-xs"
                        />
                      </div>
                    </div>
                  ) : null}
                </div>
              ))}

              <button
                type="button"
                onClick={() => setItems((current) => [...current, newDraftItem()])}
                disabled={busy}
                className="self-start border border-dashed border-zinc-400 px-4 py-2.5 text-sm text-zinc-600 hover:border-zinc-700 hover:text-zinc-900"
              >
                + Add an item
              </button>

              <div className="w-full border-t border-zinc-200 pt-5">
                <Label className="text-xs">Add on</Label>
                <div
                  role="group"
                  aria-label="Chains to add items on"
                  className="mt-2 flex flex-wrap gap-2"
                >
                  <div className="inline-flex min-h-11 items-center gap-2 border border-teal-500 bg-teal-50 px-3 text-sm font-medium text-teal-800">
                    <ChainLogo chainId={chainId} width={22} height={22} />
                    <span>{JB_CHAINS[chainId].name}</span>
                  </div>
                </div>
              </div>
            </div>

            {error ? (
              <p role="alert" className="bg-red-50 px-3 py-2 text-xs leading-relaxed text-red-700">
                {error}
              </p>
            ) : null}

            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={onClose} disabled={busy}>
                Cancel
              </Button>
              <ButtonWithWallet
                targetChainId={chainId}
                loading={busy}
                onClick={() => void submit()}
              >
                {phase === "simulating"
                  ? "Simulating…"
                  : phase === "pinning"
                    ? "Pinning metadata…"
                    : phase === "sending"
                      ? "Confirm in wallet…"
                      : phase === "confirming"
                        ? "Confirming…"
                        : "Review items"}
              </ButtonWithWallet>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function shortError(error: unknown): string {
  if (error && typeof error === "object") {
    const err = error as { shortMessage?: string; message?: string };
    return err.shortMessage || err.message || "Could not add the items.";
  }
  return "Could not add the items.";
}
