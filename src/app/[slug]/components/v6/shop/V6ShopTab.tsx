"use client";

import { Skeleton } from "@/components/ui/skeleton";
import { useJBChainId, useJBContractContext } from "@bananapus/nana-sdk-react";
import clsx from "clsx";
import { useState } from "react";
import { ProjectItem } from "../shared";
import { CustomersSection } from "./CustomersSection";
import { InventorySection } from "./InventorySection";
import { useShopInventory, useTierMedia } from "./shopLib";

const SUBTABS = [
  { key: "inventory", label: "INVENTORY" },
  { key: "customers", label: "CUSTOMERS" },
] as const;

type SubtabKey = (typeof SUBTABS)[number]["key"];

/**
 * The Shop tab (website/ renderShopTab parity): INVENTORY | CUSTOMERS
 * subtabs over the project's 721 tiers hook. Items added here land in the
 * shared shop cart the Pay card checks out from.
 */
export function V6ShopTab({ projects }: { projects: ProjectItem[] }) {
  const { projectId } = useJBContractContext();
  const chainId = useJBChainId();

  const [subtab, setSubtab] = useState<SubtabKey>("inventory");
  // Lazy mount: a subtab renders the first time it's opened, then stays
  // mounted (hidden) so its state and queries survive switching back.
  const [visited, setVisited] = useState<Record<SubtabKey, boolean>>({
    inventory: true,
    customers: false,
  });

  const shopQuery = useShopInventory(chainId, projectId);
  const { data: mediaById } = useTierMedia(chainId, shopQuery.data);

  if (!chainId) return null;

  if (shopQuery.isLoading) {
    return <ShopInventorySkeleton />;
  }
  if (shopQuery.isError) {
    return (
      <div className="text-zinc-500">
        Couldn&apos;t load the shop right now — try again in a moment.
      </div>
    );
  }
  if (!shopQuery.data) {
    return <div className="text-zinc-500">This project has no shop.</div>;
  }

  const shop = shopQuery.data;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex gap-5 border-b border-zinc-200">
        {SUBTABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => {
              setSubtab(tab.key);
              setVisited((current) =>
                current[tab.key] ? current : { ...current, [tab.key]: true },
              );
            }}
            className={clsx(
              "-mb-px pb-2 text-sm font-medium tracking-wide transition-colors",
              subtab === tab.key
                ? "border-b-2 border-teal-500 text-zinc-900"
                : "border-b-2 border-transparent text-zinc-500 hover:text-zinc-800",
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {visited.inventory ? (
        <div className={subtab === "inventory" ? "" : "hidden"}>
          <InventorySection
            shop={shop}
            chainId={chainId}
            projectId={projectId}
            projects={projects}
            mediaById={mediaById}
          />
        </div>
      ) : null}

      {visited.customers ? (
        <div className={subtab === "customers" ? "" : "hidden"}>
          <CustomersSection shop={shop} mediaById={mediaById} />
        </div>
      ) : null}
    </div>
  );
}

function ShopInventorySkeleton() {
  const chipWidths = ["w-16", "w-24", "w-20", "w-28", "w-20", "w-16", "w-24", "w-20"];

  return (
    <div role="status" aria-label="Loading shop" className="flex flex-col gap-4">
      <span className="sr-only">Loading shop</span>

      <div className="flex gap-5 border-b border-zinc-200 pb-2">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-4 w-24" />
      </div>

      <div className="border border-zinc-200 bg-white p-4">
        <Skeleton className="h-5 w-14" />

        <div className="mt-3 flex flex-wrap gap-1.5">
          {chipWidths.map((width, index) => (
            <Skeleton key={index} className={`h-8 ${width}`} />
          ))}
        </div>

        <Skeleton className="mb-2 mt-4 h-3 w-24" />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {Array.from({ length: 3 }, (_, index) => (
            <div key={index} className="overflow-hidden border border-zinc-200 bg-white">
              <Skeleton className="aspect-square w-full" />
              <div className="space-y-2 border-t border-zinc-200 bg-melon-50 p-3">
                <Skeleton className="h-4 w-2/3" />
                <Skeleton className="h-4 w-1/3" />
                <div className="flex items-center justify-between gap-2 pt-1">
                  <Skeleton className="h-3 w-14" />
                  <Skeleton className="h-7 w-12" />
                </div>
              </div>
            </div>
          ))}
        </div>

        <Skeleton className="mt-4 h-4 w-40" />
      </div>
    </div>
  );
}
