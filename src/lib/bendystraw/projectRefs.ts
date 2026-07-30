import type { BendystrawFilter } from "@/lib/bendystraw/types";

export type VersionedProjectRef = {
  chainId: number;
  projectId: number;
  version: number;
};

/** Keep exact-ref OR filters small enough for the indexer's input parser. */
export const REF_LOOKUP_BATCH_SIZE = 200;

export function projectRefKey(ref: VersionedProjectRef): string {
  return `${ref.chainId}:${ref.projectId}:${ref.version}`;
}

/**
 * Build one exact project-ref branch.
 *
 * Bendystraw's Ponder filter dialect does not AND sibling fields inside an OR
 * branch. The explicit nested AND is therefore required: without it, a branch
 * containing chainId, projectId, and version can match any one of those fields
 * and leak unrelated projects into the result.
 */
export function projectRefAnd(ref: VersionedProjectRef): BendystrawFilter {
  return {
    AND: [{ chainId: ref.chainId }, { projectId: ref.projectId }, { version: ref.version }],
  };
}

/** A filter matching every unique ref exactly, or null for an empty input. */
export function projectRefsWhere(refs: readonly VersionedProjectRef[]): BendystrawFilter | null {
  return projectRefsWheres(refs)[0] ?? null;
}

/** Exact project-ref filters in complete, independently queryable batches. */
export function projectRefsWheres(refs: readonly VersionedProjectRef[]): BendystrawFilter[] {
  const seen = new Set<string>();
  const groups: BendystrawFilter[] = [];
  for (const ref of refs) {
    const key = projectRefKey(ref);
    if (seen.has(key)) continue;
    seen.add(key);
    groups.push(projectRefAnd(ref));
  }

  const batches: BendystrawFilter[] = [];
  for (let index = 0; index < groups.length; index += REF_LOOKUP_BATCH_SIZE) {
    batches.push({ OR: groups.slice(index, index + REF_LOOKUP_BATCH_SIZE) });
  }
  return batches;
}

/** Raw GraphQL equivalent for the one dynamic query which cannot use variables. */
export function projectRefGraphqlInput(ref: VersionedProjectRef): string {
  for (const value of [ref.chainId, ref.projectId, ref.version]) {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new Error("Project references must contain non-negative safe integers.");
    }
  }
  return `{ AND: [{ chainId: ${ref.chainId} }, { projectId: ${ref.projectId} }, { version: ${ref.version} }] }`;
}

export function matchesProjectRef(
  row: Pick<VersionedProjectRef, "chainId" | "projectId"> & { version?: number },
  refs: readonly VersionedProjectRef[],
): boolean {
  return refs.some(
    (ref) =>
      row.chainId === ref.chainId &&
      row.projectId === ref.projectId &&
      (row.version === undefined || row.version === ref.version),
  );
}
