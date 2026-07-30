import type { BendystrawFilter } from "@/lib/bendystraw/types";
import { mainnet } from "viem/chains";

/**
 * The account view spans chains, so it has no single chainId to route its
 * Bendystraw queries by (project pages route by the project's own chain).
 * This app browses the production networks only, so every account query pins
 * the mainnet endpoint through this ONE constant — change it here if a
 * testnet account mode ever exists.
 */
export const ACCOUNT_BENDYSTRAW_CHAIN_ID: number = mainnet.id;

/**
 * A project reference as Bendystraw namespaces it. This app is V6-only, so
 * every account query pins version 6 and rows carry version: 6.
 */
export type VersionedProjectRef = {
  chainId: number;
  projectId: number;
  version: number;
};

/** Keep exact-ref OR filters small enough for the indexer's input parser. */
export const REF_LOOKUP_BATCH_SIZE = 200;

/** The lookup key for a project ref — matches `projectRefsWhere`'s AND groups. */
export function projectRefKey(ref: VersionedProjectRef): string {
  return `${ref.chainId}:${ref.projectId}:${ref.version}`;
}

/**
 * A `projects` filter matching each ref exactly. Every branch is an explicit
 * AND group — this Ponder version does not AND sibling fields inside OR
 * branches — and version stays part of each group because the indexer's
 * projects table spans protocol versions.
 */
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
    groups.push({
      AND: [{ chainId: ref.chainId }, { projectId: ref.projectId }, { version: ref.version }],
    });
  }
  const batches: BendystrawFilter[] = [];
  for (let index = 0; index < groups.length; index += REF_LOOKUP_BATCH_SIZE) {
    batches.push({ OR: groups.slice(index, index + REF_LOOKUP_BATCH_SIZE) });
  }
  return batches;
}
