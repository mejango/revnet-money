import type { BendystrawFilter } from "@/lib/bendystraw/types";

/** A project reference as Bendystraw namespaces it — projectId is only unique per (chainId, version). */
export type VersionedProjectRef = {
  chainId: number;
  projectId: number;
  version: number;
};

function keepHighestVersion<T extends { version: number }>(
  rows: readonly T[],
  keyOf: (row: T) => string,
): T[] {
  const best = new Map<string, T>();
  for (const row of rows) {
    const key = keyOf(row);
    const current = best.get(key);
    if (!current || row.version > current.version) best.set(key, row);
  }
  return [...best.values()];
}

/**
 * Bendystraw indexes the same participant once per protocol version tag, so
 * balances duplicate across versions for one (chainId, projectId). Keep the
 * highest-version row per (chainId, projectId).
 */
export function dedupeToHighestVersion<T extends VersionedProjectRef>(rows: readonly T[]): T[] {
  return keepHighestVersion(rows, (row) => `${row.chainId}:${row.projectId}`);
}

/**
 * Owned-NFT rows duplicate the same way. Token ids are only unique per
 * collection, so the dedupe key includes the project — per-version duplicates
 * share (chainId, projectId, tokenId) while same-numbered tokens from other
 * projects survive.
 */
export function dedupeOwnedNfts<T extends VersionedProjectRef & { tokenId: string | number }>(
  rows: readonly T[],
): T[] {
  return keepHighestVersion(rows, (row) => `${row.chainId}:${row.projectId}:${row.tokenId}`);
}

/** The lookup key for a project ref — matches `projectRefsWhere`'s AND groups. */
export function projectRefKey(ref: VersionedProjectRef): string {
  return `${ref.chainId}:${ref.projectId}:${ref.version}`;
}

/**
 * A `projects` filter matching each ref exactly. Every branch is an explicit
 * AND group — this Ponder version does not AND sibling fields inside OR
 * branches — and version is part of each group because projectId alone names
 * different projects across protocol versions.
 */
export function projectRefsWhere(refs: readonly VersionedProjectRef[]): BendystrawFilter | null {
  const seen = new Set<string>();
  const groups: BendystrawFilter[] = [];
  for (const ref of refs) {
    const key = projectRefKey(ref);
    if (seen.has(key)) continue;
    seen.add(key);
    groups.push({
      AND: [{ chainId: ref.chainId }, { projectId: ref.projectId }, { version: ref.version }],
    });
  }
  return groups.length ? { OR: groups.slice(0, 200) } : null;
}
