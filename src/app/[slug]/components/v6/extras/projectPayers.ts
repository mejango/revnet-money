import { chainSortOrder } from "@/app/constants";
import type { ProjectPayer, ProjectPayerFilter } from "@/lib/bendystraw/types";
import { JB_CHAINS, JBChainId } from "@bananapus/nana-sdk-core";
import { ProjectItem } from "../shared";

/** A sucker-group project on a chain this UI understands. */
export type ChainProjectRow = { chainId: JBChainId; projectId: number };

/** JB_CHAINS-known rows, in the app's canonical chain order. */
export function chainProjectRows(projects: ProjectItem[]): ChainProjectRow[] {
  return projects
    .filter((p) => Boolean(JB_CHAINS[p.chainId as JBChainId]))
    .map((p) => ({ chainId: p.chainId as JBChainId, projectId: p.projectId }))
    .sort((a, b) => (chainSortOrder.get(a.chainId) ?? 0) - (chainSortOrder.get(b.chainId) ?? 0));
}

export type PayerRow = Pick<
  ProjectPayer,
  | "chainId"
  | "address"
  | "defaultAddToBalance"
  | "defaultBeneficiary"
  | "owner"
  | "paymentsCount"
  | "addToBalanceCount"
  | "totalFacilitated"
  | "totalFacilitatedUsd"
  | "lastUsedAt"
  | "createdAt"
>;

/** Per-project (chainId, projectId) filter for v6 projects. */
export function payersWhere(rows: ChainProjectRow[]): ProjectPayerFilter {
  return {
    OR: rows.map((row) => ({
      chainId: row.chainId,
      projectId: row.projectId,
      version: 6,
    })),
  };
}

/** Bendystraw USD aggregates are 18-decimal fixed-point. */
export function usdFromScaled(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  try {
    return Number(BigInt(String(value).split(".")[0]) / 1_000_000_000_000n) / 1e6;
  } catch {
    return null;
  }
}

export function formatUsd(value: number): string {
  return value.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: value >= 100 ? 0 : 2,
  });
}
