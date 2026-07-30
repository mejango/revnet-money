"use client";

import { MintNftEventsOperation, OwnedNftsOperation, useBendystrawQuery } from "@/lib/bendystraw";
import { queryBendystrawFromBrowser } from "@/lib/bendystraw/client";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { useJBChainId, useJBContractContext } from "./project";

export type ShopPurchase = {
  beneficiary: string;
  chainId: number;
  projectId: number;
  tierId: number;
  timestamp: number;
  tokenId: string;
  totalAmountPaid: string;
  txHash: string;
};

export type OwnedShopItem = {
  chainId: number;
  projectId: number;
  owner: string;
  tierId: number;
  tokenId: string;
  tokenUri: string | null;
};

export type ShopProjectRef = { chainId: number; projectId: number };
export type CompleteShopRows<T> = {
  items: T[];
  totalCount: number;
  failedScopes: ShopProjectRef[];
};

const SHOP_PAGE_SIZE = 200;

async function fetchCompleteShopRows<T>(
  projects: readonly ShopProjectRef[],
  fetchPage: (
    project: ShopProjectRef,
    limit: number,
    offset: number,
  ) => Promise<{ items: T[]; totalCount: number }>,
): Promise<CompleteShopRows<T>> {
  const pages = await Promise.all(
    projects.map(async (project) => {
      const items: T[] = [];
      let totalCount = 0;
      try {
        for (;;) {
          const page = await fetchPage(project, SHOP_PAGE_SIZE, items.length);
          totalCount = page.totalCount;
          items.push(...page.items);
          if (page.items.length === 0 || items.length >= totalCount) break;
        }
        return { project, items, totalCount, failed: false };
      } catch {
        return { project, items, totalCount, failed: true };
      }
    }),
  );
  return {
    items: pages.flatMap((page) => page.items),
    totalCount: pages.reduce((total, page) => total + page.totalCount, 0),
    failedScopes: pages.filter((page) => page.failed).map((page) => page.project),
  };
}

export function useAllShopPurchases(projects: readonly ShopProjectRef[]) {
  const key = projects
    .map((p) => `${p.chainId}:${p.projectId}`)
    .sort()
    .join("|");
  return useQuery({
    queryKey: ["all-shop-purchases", key],
    enabled: projects.length > 0,
    staleTime: 30_000,
    queryFn: async (): Promise<CompleteShopRows<ShopPurchase>> => {
      const page = await fetchCompleteShopRows(projects, async (project, limit, offset) => {
        const data = await queryBendystrawFromBrowser(
          MintNftEventsOperation,
          {
            where: { ...project, version: 6 },
            limit,
            offset,
          },
          project.chainId,
        );
        return {
          items: data.mintNftEvents.items.map((item) => ({
            ...item,
            chainId: Number(item.chainId),
            projectId: Number(item.projectId),
            timestamp: Number(item.timestamp),
            tierId: Number(item.tierId),
            tokenId: String(item.tokenId),
            totalAmountPaid: String(item.totalAmountPaid),
          })),
          totalCount: data.mintNftEvents.totalCount,
        };
      });
      page.items.sort((a, b) => b.timestamp - a.timestamp);
      return page;
    },
  });
}

export function useAllOwnedShopItems(
  projects: readonly ShopProjectRef[],
  owner: string | undefined,
) {
  const key = projects
    .map((p) => `${p.chainId}:${p.projectId}`)
    .sort()
    .join("|");
  return useQuery({
    queryKey: ["all-owned-shop-items", key, owner?.toLowerCase()],
    enabled: projects.length > 0 && !!owner,
    staleTime: 30_000,
    queryFn: async (): Promise<CompleteShopRows<OwnedShopItem>> =>
      fetchCompleteShopRows(projects, async (project, limit, offset) => {
        const data = await queryBendystrawFromBrowser(
          OwnedNftsOperation,
          {
            where: { ...project, version: 6, owner: owner!.toLowerCase() },
            limit,
            offset,
          },
          project.chainId,
        );
        return {
          items: data.nfts.items.map((item) => ({
            chainId: Number(item.chainId),
            projectId: Number(item.projectId),
            owner: item.owner.toLowerCase(),
            tierId: Number(item.tierId),
            tokenId: String(item.tokenId),
            tokenUri: item.tokenUri,
          })),
          totalCount: data.nfts.totalCount,
        };
      }),
  });
}

export function useShopPurchases({
  beneficiary,
  limit = 100,
  offset = 0,
  enabled = true,
}: {
  beneficiary?: string;
  limit?: number;
  offset?: number;
  enabled?: boolean;
} = {}) {
  const chainId = useJBChainId();
  const { projectId, version } = useJBContractContext();
  const query = useBendystrawQuery(
    MintNftEventsOperation,
    {
      where: {
        projectId: Number(projectId),
        chainId: Number(chainId),
        version,
        ...(beneficiary ? { beneficiary: beneficiary.toLowerCase() } : {}),
      },
      limit,
      offset,
    },
    { enabled: !!chainId && enabled, chainId },
  );
  const data = useMemo<ShopPurchase[] | undefined>(
    () =>
      query.data?.mintNftEvents.items.map((item) => ({
        ...item,
        chainId: Number(item.chainId),
        projectId: Number(item.projectId),
        timestamp: Number(item.timestamp),
        tierId: Number(item.tierId),
        tokenId: String(item.tokenId),
        totalAmountPaid: String(item.totalAmountPaid),
      })),
    [query.data],
  );
  return {
    ...query,
    data,
    totalCount: query.data?.mintNftEvents.totalCount,
  };
}

export function useOwnedShopItems({
  owner,
  limit = 100,
  offset = 0,
  enabled = true,
}: {
  owner: string | undefined;
  limit?: number;
  offset?: number;
  enabled?: boolean;
}) {
  const chainId = useJBChainId();
  const { projectId, version } = useJBContractContext();
  const query = useBendystrawQuery(
    OwnedNftsOperation,
    {
      where: {
        projectId: Number(projectId),
        chainId: Number(chainId),
        version,
        owner: (owner ?? "").toLowerCase(),
      },
      limit,
      offset,
    },
    { enabled: !!chainId && !!owner && enabled, chainId },
  );
  const data = useMemo<OwnedShopItem[] | undefined>(
    () =>
      query.data?.nfts.items.map((item) => ({
        chainId: Number(item.chainId),
        projectId: Number(item.projectId),
        owner: item.owner.toLowerCase(),
        tierId: Number(item.tierId),
        tokenId: String(item.tokenId),
        tokenUri: item.tokenUri,
      })),
    [query.data],
  );
  return {
    ...query,
    data,
    totalCount: query.data?.nfts.totalCount,
  };
}
