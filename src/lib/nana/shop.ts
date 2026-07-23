"use client";

import { MintNftEventsOperation, OwnedNftsOperation, useBendystrawQuery } from "@/lib/bendystraw";
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
