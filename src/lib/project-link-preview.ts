import { formatUsd, usdFromScaled } from "@/app/[slug]/components/v6/extras/projectPayers";
import type { Project, ProjectTokenBalance } from "@/lib/bendystraw/types";
import { formatTokenAmount } from "@/lib/token";
import { getTokenSymbolFromAddress, tokenKindOf } from "@/lib/tokenUtils";

type BalanceDeployment = Pick<Project, "balance" | "decimals" | "tokenSymbol"> & {
  projectTokenBalances?: { items: ProjectTokenBalance[] } | null;
};

/**
 * What one deployment holds, one row per token in that token's own units. The raw
 * `balance` (which adds unlike units once a project accepts several tokens) is read only
 * when the indexer served no per-token rows.
 */
export function deploymentTokenBalances(
  deployment: BalanceDeployment,
): Array<
  Pick<Project, "balance" | "decimals" | "tokenSymbol"> &
    Pick<Partial<ProjectTokenBalance>, "token" | "balanceUsd">
> {
  const rows = deployment.projectTokenBalances?.items;
  if (!rows?.length) return [deployment];
  return rows.map((row) => ({ ...row, tokenSymbol: tokenSymbolOf(row) }));
}

/** A per-token row's symbol: the indexer's, else a token this app knows, else null. */
export function tokenSymbolOf(row: Pick<ProjectTokenBalance, "token" | "tokenSymbol">) {
  if (row.tokenSymbol) return row.tokenSymbol;
  const known = getTokenSymbolFromAddress(row.token);
  return known === "TOKEN" ? null : known;
}

type BalanceBucket = {
  symbol: string;
  decimals: number;
  amount: bigint;
};

export function projectPreviewSlogan(...values: Array<string | null | undefined>): string | null {
  for (const value of values) {
    const text = value
      ?.replace(/<br\s*\/?>/giu, " ")
      .replace(/<[^>]+>/gu, " ")
      .replace(/&amp;/gu, "&")
      .replace(/&quot;/gu, '"')
      .replace(/&#39;|&apos;/gu, "'")
      .replace(/&nbsp;/gu, " ")
      .replace(/\s+/gu, " ")
      .trim();
    if (text) return text.slice(0, 240);
  }
  return null;
}

/** Keep unlike treasury assets separate instead of presenting a fake total. */
export function formatProjectPreviewBalance(deployments: readonly BalanceDeployment[]): string {
  const buckets = new Map<string, BalanceBucket>();
  // Holdings in a token whose symbol is unreadable are shown in USD.
  let unnamedUsd = 0;
  for (const deployment of deployments.flatMap(deploymentTokenBalances)) {
    const symbol = deployment.tokenSymbol?.trim();
    const decimals = deployment.decimals;
    if (!symbol) unnamedUsd += usdFromScaled(deployment.balanceUsd) ?? 0;
    if (!symbol || decimals == null || !Number.isSafeInteger(decimals) || decimals < 0) continue;
    try {
      const key = tokenKindOf(deployment);
      const current = buckets.get(key);
      buckets.set(key, {
        symbol,
        decimals,
        amount: (current?.amount ?? 0n) + BigInt(deployment.balance || 0),
      });
    } catch {
      // An invalid indexer value is unknown, not zero.
    }
  }

  // A token the project no longer holds is noise beside one it does.
  const held = [...buckets.values()].filter((bucket) => bucket.amount > 0n);
  const values = (held.length || unnamedUsd > 0 ? held : [...buckets.values()])
    .sort((left, right) => left.symbol.localeCompare(right.symbol))
    .map((bucket) => `${formatTokenAmount(bucket.amount, bucket)} ${bucket.symbol}`)
    .concat(unnamedUsd > 0 ? [formatUsd(unnamedUsd)] : []);
  if (!values.length) return "Unavailable";
  if (values.length <= 2) return values.join(" + ");
  return `${values.slice(0, 2).join(" + ")} + ${values.length - 2} more`;
}
