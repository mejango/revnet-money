import { chainSortOrder } from "@/app/constants";
import { ProjectPayer, ProjectPayerFilter } from "@/generated/graphql";
import { JB_CHAINS, JBChainId } from "@bananapus/nana-sdk-core";
import { TypedDocumentNode } from "@graphql-typed-document-node/core";
import gql from "graphql-tag";
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

export type ProjectPayersQuery = { projectPayers: { items: PayerRow[] } | null };
export type ProjectPayersQueryVariables = { where: ProjectPayerFilter };

/**
 * Bendystraw's indexed payer addresses across the sucker group, ordered by
 * facilitated USD volume (the only honest common denomination — raw totals can
 * mix payment-token decimals). No generated document exists for projectPayers,
 * so this is a hand-typed one executed through useBendystrawQuery.
 */
export const ProjectPayersDocument = gql`
  query V6ProjectPayers($where: ProjectPayerFilter) {
    projectPayers(
      where: $where
      orderBy: "totalFacilitatedUsd"
      orderDirection: "desc"
      limit: 250
    ) {
      items {
        chainId
        address
        defaultAddToBalance
        defaultBeneficiary
        owner
        paymentsCount
        addToBalanceCount
        totalFacilitated
        totalFacilitatedUsd
        lastUsedAt
        createdAt
      }
    }
  }
` as unknown as TypedDocumentNode<ProjectPayersQuery, ProjectPayersQueryVariables>;

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
