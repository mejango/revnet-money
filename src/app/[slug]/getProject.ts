import { ProjectOperation } from "@/lib/bendystraw/operations";
import { queryBendystraw } from "@/lib/bendystraw/query.server";
import type { ProjectQuery } from "@/lib/bendystraw/types";
import { indexedProjectStatus, type IndexedReadResult } from "@/lib/projectIndexStatus";
import { fillIndexedMetadata } from "@/lib/projectMetadataFill.server";
import { cache } from "react";

export const getIndexedProject = cache(
  async (
    projectId: number | bigint,
    chainId: number,
  ): Promise<IndexedReadResult<NonNullable<ProjectQuery["project"]>>> => {
    try {
      const result = await queryBendystraw(chainId, ProjectOperation, {
        projectId: Number(projectId),
        chainId,
        version: 6,
      });
      if (!result.project) return { data: null, status: "missing" };
      // The row's name/logo can be null when the indexer's metadata fetch missed;
      // the page title, description, and link-preview card all read from here.
      const project = (await fillIndexedMetadata([result.project]))[0];
      return { data: project, status: indexedProjectStatus(project) };
    } catch {
      return { data: null, status: "unavailable" };
    }
  },
);

export const getProject = cache(
  async (projectId: number | bigint, chainId: number) =>
    (await getIndexedProject(projectId, chainId)).data,
);
