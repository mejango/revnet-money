import { isAddress, type Address } from "viem";

export type RevnetOperatorRow = {
  operator?: string | null;
  permissions?: readonly unknown[] | null;
  isRevnetOperator?: boolean | null;
};

/**
 * Pick the currently indexed revnet operator.
 *
 * Bendystraw normally leaves the active row with a non-empty permission set.
 * During an indexing transition it may expose only the role-marked row, so
 * match Juicebox Money's behavior and use that row as a truthful fallback.
 */
export function pickRevnetOperator(rows: readonly RevnetOperatorRow[]): Address | null {
  const candidates = rows.filter(
    (row): row is RevnetOperatorRow & { operator: Address } =>
      row.isRevnetOperator !== false && typeof row.operator === "string" && isAddress(row.operator),
  );
  const active = candidates.find((row) => (row.permissions?.length ?? 0) > 0);
  return active?.operator ?? candidates[0]?.operator ?? null;
}
