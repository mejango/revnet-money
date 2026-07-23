import { SuckerGroupOperation } from "@/lib/bendystraw/operations";
import { queryBendystraw } from "@/lib/bendystraw/query.server";
import { unstable_cache } from "next/cache";

export const getSuckerGroup = unstable_cache(
  async (suckerGroupId: string, chainId: number) => {
    try {
      const result = await queryBendystraw(chainId, SuckerGroupOperation, { id: suckerGroupId });
      return result.suckerGroup;
    } catch (err) {
      console.error((err as Error).message);
      return null;
    }
  },
  ["getSuckerGroup"],
  { revalidate: 15 },
);
