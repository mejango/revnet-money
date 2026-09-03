"use client";

import { ButtonWithWallet } from "@/components/ButtonWithWallet";
import { ChainLogo } from "@/components/ChainLogo";
import {
  buildTierConfigs,
  MAX_MEDIA_BYTES,
  newDraftItem,
  pinDraftItems,
  type DraftItem,
} from "@/components/shop/itemDraft";
import { ItemDraftFields } from "@/components/shop/ItemDraftFields";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { SummaryRow, TxConfirmDialog } from "@/components/ui/TxConfirmDialog";
import {
  requireOnchainExecution,
  submittedViaSafe,
  useWriteContract,
} from "@/hooks/useReviewedWriteContract";
import { waitForReceiptWithRetry } from "@/lib/waitForReceipt";
import { jb721TiersHookAbi, JB_CHAINS, JBChainId } from "@bananapus/nana-sdk-core";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { PublicClient } from "viem";
import { useAccount, usePublicClient } from "wagmi";
import { ShopInventory } from "./shopLib";
import { canAdjust721Tiers } from "./shopPermissions";

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
    | "form"
    | "checking"
    | "pinning"
    | "simulating"
    | "sending"
    | "confirming"
    | "safe-proposed"
    | "done"
  >("form");
  const [reviewing, setReviewing] = useState(false);
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
    phase === "checking" ||
    phase === "pinning" ||
    phase === "simulating" ||
    phase === "sending" ||
    phase === "confirming";

  const updateItem = (index: number, patch: Partial<DraftItem>) => {
    setItems((current) => current.map((item, i) => (i === index ? { ...item, ...patch } : item)));
    setError(null);
  };

  const selectMedia = (index: number, file: File | null) => {
    if (file && file.size > MAX_MEDIA_BYTES) {
      setError("Media must be 500 MB or smaller.");
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

  const review = async () => {
    if (!address || !publicClient || busy) return;
    setError(null);

    setReviewing(true);
    try {
      setPhase("checking");
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
      setPhase("form");
    } catch (err) {
      setPhase("form");
      setReviewing(false);
      setError(shortError(err));
    }
  };

  const submit = async () => {
    if (!address || !publicClient || busy) return;
    setError(null);

    try {
      setPhase("pinning");
      const preparedItems = await pinDraftItems(items, categories);
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
        setReviewing(false);
        setPhase("safe-proposed");
        return;
      }
      requireOnchainExecution(hash, "Shop item update");
      const receipt = await waitForReceiptWithRetry(publicClient as PublicClient, hash);
      if (receipt.status !== "success") throw new Error("The transaction failed.");

      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["v6Shop721", chainId, projectId.toString()] }),
        queryClient.invalidateQueries({ queryKey: ["v6PayShop", chainId, projectId.toString()] }),
        // shopLib keys tier media as "v6Shop721TierMedia"; this prefix matched nothing, so
        // media never refreshed after items were added.
        queryClient.invalidateQueries({ queryKey: ["v6Shop721TierMedia", chainId, shop.hook] }),
      ]);
      setReviewing(false);
      setPhase("done");
    } catch (err) {
      setPhase("form");
      setError(shortError(err));
    }
  };

  const status =
    phase === "checking"
      ? "Checking the shop and your permissions…"
      : phase === "pinning"
        ? "Pinning metadata…"
        : phase === "simulating"
          ? "Simulating…"
          : phase === "sending"
            ? "Confirm in wallet…"
            : phase === "confirming"
              ? "Confirming…"
              : null;

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

                  <ItemDraftFields
                    item={item}
                    index={index}
                    priceSymbol={shop.pricing.symbol}
                    categories={categories}
                    limits={{
                      noNewTiersWithReserves: shop.configFlags?.noNewTiersWithReserves,
                      noNewTiersWithVotes: shop.configFlags?.noNewTiersWithVotes,
                      noNewTiersWithOwnerMinting: shop.configFlags?.noNewTiersWithOwnerMinting,
                      transferabilityFixed: shop.fixedTierTransferability,
                    }}
                    disabled={busy}
                    onChange={(patch) => updateItem(index, patch)}
                    onSelectMedia={(file) => selectMedia(index, file)}
                  />
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

            {error && !reviewing ? (
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
                disabled={busy}
                onClick={() => void review()}
                connectWalletText="Connect Wallet"
                className="bg-teal-500 text-melon-950 hover:bg-teal-600"
              >
                Add items
              </ButtonWithWallet>
            </div>
          </>
        )}
      </DialogContent>
      {reviewing ? (
        <TxConfirmDialog
          open
          onOpenChange={(open) => {
            if (!open) setReviewing(false);
          }}
          title="Confirm items"
          chainId={chainId}
          preparing={phase === "checking"}
          steps={[
            {
              title: `Add ${items.length} item${items.length === 1 ? "" : "s"}`,
              detail: "Metadata is pinned first; then one call on the shop hook.",
            },
          ]}
          activeIndex={busy ? 0 : -1}
          action="Add items"
          onConfirm={() => void submit()}
          busy={busy}
          status={status}
          error={error}
        >
          {items.map((item, index) => (
            <SummaryRow key={index} label={item.name.trim() || `Item ${index + 1}`}>
              {item.price.trim() ? `${item.price.trim()} ${shop.pricing.symbol}` : "Free"}
              <span className="block text-xs text-zinc-500">
                {item.supply.trim() ? `${item.supply.trim()} in stock` : "Unlimited stock"}
              </span>
            </SummaryRow>
          ))}
          <SummaryRow label="On">{JB_CHAINS[chainId].name}</SummaryRow>
        </TxConfirmDialog>
      ) : null}
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
