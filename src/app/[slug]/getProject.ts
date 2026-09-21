import { ProjectOperation } from "@/lib/bendystraw/operations";
import { queryBendystraw } from "@/lib/bendystraw/query.server";
import { fillIndexedMetadata } from "@/lib/projectMetadataFill.server";
import { cache } from "react";

export const getProject = cache(async (projectId: number | bigint, chainId: number) => {
  try {
    const result = await queryBendystraw(chainId, ProjectOperation, {
      projectId: Number(projectId),
      chainId,
      version: 6,
    });
    if (!result.project) return null;
    // The row's name/logo can be null when the indexer's metadata fetch missed;
    // the page title, description, and link-preview card all read from here.
    return (await fillIndexedMetadata([result.project]))[0];
  } catch (err) {
    console.error((err as Error).message);
    return null;
  }
});
