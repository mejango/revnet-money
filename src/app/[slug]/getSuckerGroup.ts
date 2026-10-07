import { SuckerGroupOperation } from "@/lib/bendystraw/operations";
import { queryBendystraw } from "@/lib/bendystraw/query.server";
import type { SuckerGroupQuery } from "@/lib/bendystraw/types";
import { indexedGroupStatus, type IndexedReadResult } from "@/lib/projectIndexStatus";
import { cachedIndexedDisplay } from "@/lib/server/projectDisplayCache";
import { cache } from "react";

// Share successful display reads briefly; failed/incomplete reads remain retryable.
export const getIndexedSuckerGroup = cache(
  async (
    suckerGroupId: string,
    chainId: number,
  ): Promise<IndexedReadResult<NonNullable<SuckerGroupQuery["suckerGroup"]>>> => {
    if (!suckerGroupId) return { data: null, status: "not-checked" };
    try {
      return await cachedIndexedDisplay(["group", chainId, suckerGroupId], async () => {
        const result = await queryBendystraw(chainId, SuckerGroupOperation, { id: suckerGroupId });
        return { data: result.suckerGroup, status: indexedGroupStatus(result.suckerGroup) };
      });
    } catch {
      return { data: null, status: "unavailable" };
    }
  },
);

export const getSuckerGroup = cache(
  async (suckerGroupId: string, chainId: number) =>
    (await getIndexedSuckerGroup(suckerGroupId, chainId)).data,
);
