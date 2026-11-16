"use client";

import {
  AccountActivityEventsOperation,
  AccountPermissionHoldersOperation,
  AccountTokenBalancesOperation,
  ActivityEventsOperation,
  AllLoansOperation,
  LoansByAccountOperation,
  OwnedNftsOperation,
  ParticipantsOperation,
  PermissionHoldersOperation,
  ProjectErc20TickersOperation,
  ProjectPayersOperation,
  ProjectsByOwnerOperation,
  V6AutoIssueEventsOperation,
  V6StoredAutoIssuancesOperation,
} from "@/lib/bendystraw";
import { queryBendystrawFromBrowser } from "@/lib/bendystraw/client";
import {
  matchesProjectRef,
  projectRefsWheres,
  type VersionedProjectRef,
} from "@/lib/bendystraw/projectRefs";
import type {
  AccountActivityEventsQuery,
  AccountPermissionHolderRow,
  AccountTokenBalanceRow,
  ActivityEventsQuery,
  ActivityEventsQueryVariables,
  AllLoansQuery,
  BendystrawFilter,
  LoansByAccountQuery,
  OwnedNftsQuery,
  OwnedProjectRow,
  ParticipantsQuery,
  PermissionHolder,
  PermissionHolderFilter,
  ProjectErc20TickerRow,
  ProjectPayerFilter,
  ProjectPayersQuery,
  V6AutoIssueEventsQuery,
  V6StoredAutoIssuancesQuery,
} from "@/lib/bendystraw/types";
import { PERSIST } from "@/lib/query-persist";
import { useQuery, type QueryClient } from "@tanstack/react-query";

const PAGE_SIZE = 250;

async function completeProjects(where: BendystrawFilter) {
  const items: OwnedProjectRow[] = [];
  let totalCount = 0;
  do {
    const data = await queryBendystrawFromBrowser(ProjectsByOwnerOperation, {
      where,
      limit: PAGE_SIZE,
      offset: items.length,
    });
    const page = data.projects.items ?? [];
    totalCount = data.projects.totalCount ?? page.length;
    items.push(...page);
    if (!page.length) break;
  } while (items.length < totalCount);
  return items;
}

async function completeAccountPermissions(where: BendystrawFilter) {
  const items: AccountPermissionHolderRow[] = [];
  let totalCount = 0;
  do {
    const data = await queryBendystrawFromBrowser(AccountPermissionHoldersOperation, {
      where,
      limit: PAGE_SIZE,
      offset: items.length,
    });
    const page = data.permissionHolders?.items ?? [];
    totalCount = data.permissionHolders?.totalCount ?? page.length;
    items.push(...page);
    if (!page.length) break;
  } while (items.length < totalCount);
  return items;
}

type ProjectPermissionRow = Pick<
  PermissionHolder,
  "chainId" | "projectId" | "account" | "operator" | "permissions" | "isRevnetOperator"
>;

async function completeProjectPermissions(where: PermissionHolderFilter) {
  const items: ProjectPermissionRow[] = [];
  let totalCount = 0;
  do {
    const data = await queryBendystrawFromBrowser(PermissionHoldersOperation, {
      where,
      limit: PAGE_SIZE,
      offset: items.length,
    });
    const page = data.permissionHolders?.items ?? [];
    totalCount = data.permissionHolders?.totalCount ?? page.length;
    items.push(...page);
    if (!page.length) break;
  } while (items.length < totalCount);
  return items;
}

async function completeActivityEvents(
  variables: Omit<ActivityEventsQueryVariables, "limit" | "offset">,
  chainId: number,
) {
  const items: ActivityEventsQuery["activityEvents"]["items"] = [];
  let offset = 0;
  let totalCount: number | undefined;
  do {
    const data = await queryBendystrawFromBrowser(
      ActivityEventsOperation,
      {
        ...variables,
        limit: PAGE_SIZE,
        offset,
      },
      chainId,
    );
    const page = data.activityEvents.items ?? [];
    totalCount = data.activityEvents.totalCount;
    items.push(...page);
    offset += PAGE_SIZE;
    if (!page.length || (totalCount === undefined && page.length < PAGE_SIZE)) break;
  } while (totalCount === undefined || items.length < totalCount);
  return items;
}

/**
 * The feed after one look at its newest page. Events are only ever added, so the newest page is
 * placed ahead of the events already held, by id. Everything is paged again when nothing is held,
 * when the newest page does not reach an event already held, or when the merged count differs
 * from the indexer's total (an event indexed late, or one removed by a reorg).
 */
export async function refreshActivityEvents(
  previous: ActivityEventsQuery["activityEvents"]["items"] | undefined,
  variables: Omit<ActivityEventsQueryVariables, "limit" | "offset">,
  chainId: number,
) {
  if (!previous?.length) return completeActivityEvents(variables, chainId);
  const data = await queryBendystrawFromBrowser(
    ActivityEventsOperation,
    { ...variables, limit: PAGE_SIZE, offset: 0 },
    chainId,
  );
  const page = data.activityEvents.items ?? [];
  const totalCount = data.activityEvents.totalCount;
  if (page.length < PAGE_SIZE && (totalCount === undefined || totalCount <= page.length))
    return page;
  const newest = new Set(page.map((event) => event.id));
  const older = previous.filter((event) => !newest.has(event.id));
  const merged = [...page, ...older];
  const reachesHeld = older.length < previous.length;
  if (!reachesHeld || (totalCount !== undefined && totalCount !== merged.length))
    return completeActivityEvents(variables, chainId);
  return merged;
}

const ACCOUNT_ACTIVITY_ROOTS = [
  "activityEvents",
  "beneficiaryPayEvents",
  "beneficiaryCashOutEvents",
  "beneficiaryMintTokensEvents",
  "beneficiaryManualMintTokensEvents",
  "beneficiaryAutoIssueEvents",
] as const;

async function completeAccountActivity(address: string): Promise<AccountActivityEventsQuery> {
  const result: AccountActivityEventsQuery = { activityEvents: { items: [] } };
  let offset = 0;
  while (true) {
    const data = await queryBendystrawFromBrowser(AccountActivityEventsOperation, {
      address,
      limit: PAGE_SIZE,
      offset,
    });
    let needsAnotherPage = false;
    for (const rootName of ACCOUNT_ACTIVITY_ROOTS) {
      const pageRoot = data[rootName];
      if (!pageRoot) continue;
      const resultRoot = result[rootName] as { totalCount?: number; items: unknown[] } | undefined;
      const mergedRoot = resultRoot ?? { items: [] };
      mergedRoot.items.push(...pageRoot.items);
      mergedRoot.totalCount = pageRoot.totalCount;
      (result as Record<string, unknown>)[rootName] = mergedRoot;
      needsAnotherPage ||=
        pageRoot.totalCount !== undefined
          ? mergedRoot.items.length < pageRoot.totalCount
          : pageRoot.items.length === PAGE_SIZE;
    }
    if (!needsAnotherPage) break;
    offset += PAGE_SIZE;
  }
  return result;
}

async function completeProjectPayers(where: ProjectPayerFilter) {
  const items: NonNullable<ProjectPayersQuery["projectPayers"]>["items"] = [];
  let totalCount = 0;
  do {
    const data = await queryBendystrawFromBrowser(ProjectPayersOperation, {
      where,
      limit: PAGE_SIZE,
      offset: items.length,
    });
    const page = data.projectPayers?.items ?? [];
    totalCount = data.projectPayers?.totalCount ?? page.length;
    items.push(...page);
    if (!page.length) break;
  } while (items.length < totalCount);
  return items;
}

async function completeStoredAutoIssuances(where: BendystrawFilter) {
  const items: V6StoredAutoIssuancesQuery["storeAutoIssuanceAmountEvents"]["items"] = [];
  let totalCount = 0;
  do {
    const data = await queryBendystrawFromBrowser(V6StoredAutoIssuancesOperation, {
      where,
      limit: PAGE_SIZE,
      offset: items.length,
    });
    const page = data.storeAutoIssuanceAmountEvents.items ?? [];
    totalCount = data.storeAutoIssuanceAmountEvents.totalCount ?? page.length;
    items.push(...page);
    if (!page.length) break;
  } while (items.length < totalCount);
  return items;
}

async function completeAutoIssueEvents(where: BendystrawFilter) {
  const items: V6AutoIssueEventsQuery["autoIssueEvents"]["items"] = [];
  let totalCount = 0;
  do {
    const data = await queryBendystrawFromBrowser(V6AutoIssueEventsOperation, {
      where,
      limit: PAGE_SIZE,
      offset: items.length,
    });
    const page = data.autoIssueEvents.items ?? [];
    totalCount = data.autoIssueEvents.totalCount ?? page.length;
    items.push(...page);
    if (!page.length) break;
  } while (items.length < totalCount);
  return items;
}

export async function fetchCompleteLoans(refs: readonly VersionedProjectRef[]) {
  const batches = projectRefsWheres(refs);
  const pages = await Promise.all(
    batches.map(async (where) => {
      const items: NonNullable<AllLoansQuery["loans"]>["items"] = [];
      let totalCount = 0;
      do {
        const data = await queryBendystrawFromBrowser(AllLoansOperation, {
          where,
          limit: PAGE_SIZE,
          offset: items.length,
        });
        const page = data.loans?.items ?? [];
        totalCount = data.loans?.totalCount ?? page.length;
        for (const row of page) {
          if (!matchesProjectRef(row, refs)) {
            throw new Error("Bendystraw returned a loan for the wrong deployment.");
          }
        }
        items.push(...page);
        if (!page.length && items.length < totalCount) {
          throw new Error("Indexed loan data ended before its reported total.");
        }
      } while (items.length < totalCount);
      return items;
    }),
  );
  return pages.flat().sort((a, b) => b.createdAt - a.createdAt);
}

/**
 * Every loan an account owns, paged to completion.
 *
 * The unpaginated form silently returned only the indexer's default page, so an account
 * past that many loans lost rows with no signal — and which rows survived depended on the
 * server's default ordering.
 */
export async function fetchLoansByAccount(owner: string, version: number, chainId?: number) {
  const items: LoansByAccountQuery["loans"]["items"] = [];
  let totalCount = 0;
  do {
    const data = await queryBendystrawFromBrowser(
      LoansByAccountOperation,
      { owner, version, limit: PAGE_SIZE, offset: items.length },
      chainId,
    );
    const page = data.loans?.items ?? [];
    totalCount = data.loans?.totalCount ?? page.length;
    items.push(...page);
    if (!page.length && items.length < totalCount) {
      throw new Error("Indexed loan data ended before its reported total.");
    }
    if (!page.length) break;
  } while (items.length < totalCount);
  return items;
}

async function participantsPage(where: BendystrawFilter, chainId: number, offset: number) {
  const data = await queryBendystrawFromBrowser(
    ParticipantsOperation,
    { where, orderBy: "balance", orderDirection: "desc", limit: PAGE_SIZE, offset },
    chainId,
  );
  const items = data.participants.items ?? [];
  return { items, totalCount: data.participants.totalCount ?? items.length };
}

const PARTICIPANTS_TAIL_MAX_AGE_MS = 5 * 60_000;
/** When each participant list was last paged to its end, by filter and chain. */
const participantsPagedAt = new Map<string, number>();

/**
 * Every participant row, after one look at the first page. A list of one page is always that
 * fresh page. A longer list keeps the rows already held while the total and the first page (the
 * largest balances) are unchanged, and is paged to its end again when either changes.
 *
 * ponytail: an unchanged total and first page cannot show a change among the smaller holders (a
 * balance moving, or one holder leaving as another arrives), so the held rows are trusted for at
 * most five minutes. A cursor of changes since a timestamp would remove that window.
 */
export async function refreshParticipants(
  previous: ParticipantsQuery["participants"]["items"] | undefined,
  where: BendystrawFilter,
  chainId: number,
  now = Date.now(),
) {
  const key = JSON.stringify([where, chainId]);
  const head = await participantsPage(where, chainId, 0);
  const pagedAt = participantsPagedAt.get(key);
  if (
    previous &&
    pagedAt !== undefined &&
    now - pagedAt < PARTICIPANTS_TAIL_MAX_AGE_MS &&
    head.totalCount > head.items.length &&
    previous.length === head.totalCount &&
    JSON.stringify(previous.slice(0, head.items.length)) === JSON.stringify(head.items)
  )
    return previous;
  const items = [...head.items];
  let totalCount = head.totalCount;
  while (items.length < totalCount) {
    const page = await participantsPage(where, chainId, items.length);
    if (!page.items.length) break;
    totalCount = page.totalCount;
    items.push(...page.items);
  }
  participantsPagedAt.set(key, now);
  return items;
}

async function completeAccountTokenBalances(account: string) {
  const items: AccountTokenBalanceRow[] = [];
  let totalCount = 0;
  do {
    const data = await queryBendystrawFromBrowser(AccountTokenBalancesOperation, {
      account,
      limit: PAGE_SIZE,
      offset: items.length,
    });
    const page = data.participants.items ?? [];
    totalCount = data.participants.totalCount ?? page.length;
    items.push(...page);
    if (!page.length) break;
  } while (items.length < totalCount);
  return items;
}

async function completeOwnedNfts(where: BendystrawFilter) {
  const items: OwnedNftsQuery["nfts"]["items"] = [];
  let totalCount = 0;
  do {
    const data = await queryBendystrawFromBrowser(OwnedNftsOperation, {
      where,
      limit: PAGE_SIZE,
      offset: items.length,
    });
    const page = data.nfts.items ?? [];
    totalCount = data.nfts.totalCount ?? page.length;
    items.push(...page);
    if (!page.length) break;
  } while (items.length < totalCount);
  return items;
}

async function completeProjectTickers(where: BendystrawFilter) {
  const items: ProjectErc20TickerRow[] = [];
  let totalCount = 0;
  do {
    const data = await queryBendystrawFromBrowser(ProjectErc20TickersOperation, {
      where,
      limit: PAGE_SIZE,
      offset: items.length,
    });
    const page = data.deployErc20Events.items ?? [];
    totalCount = data.deployErc20Events.totalCount ?? page.length;
    items.push(...page);
    if (!page.length) break;
  } while (items.length < totalCount);
  return items;
}

export function useCompleteProjectsByOwner(where: BendystrawFilter, enabled = true) {
  return useQuery({
    queryKey: ["complete-projects-by-owner", where],
    queryFn: () => completeProjects(where),
    enabled,
    staleTime: 60_000,
  });
}

export function useCompleteAccountPermissions(where: BendystrawFilter, enabled = true) {
  return useQuery({
    queryKey: ["complete-account-permissions", where],
    queryFn: () => completeAccountPermissions(where),
    enabled,
    staleTime: 60_000,
  });
}

export function useCompleteProjectPermissions(where: PermissionHolderFilter, enabled = true) {
  return useQuery({
    queryKey: ["complete-project-permissions", where],
    queryFn: () => completeProjectPermissions(where),
    enabled,
    staleTime: 60_000,
  });
}

export function useCompleteActivityEvents(
  variables: Omit<ActivityEventsQueryVariables, "limit" | "offset">,
  chainId: number,
  enabled = true,
) {
  return useQuery({
    queryKey: ["complete-activity-events", variables, chainId],
    queryFn: ({ client, queryKey }) =>
      refreshActivityEvents(client.getQueryData(queryKey), variables, chainId),
    enabled,
    refetchInterval: 30_000,
  });
}

export function useCompleteAccountActivity(address: string, enabled = true) {
  return useQuery({
    queryKey: ["complete-account-activity", address],
    queryFn: () => completeAccountActivity(address),
    enabled,
    refetchInterval: 30_000,
  });
}

export function useCompleteProjectPayers(where: ProjectPayerFilter, enabled = true) {
  return useQuery({
    queryKey: ["complete-project-payers", where],
    queryFn: () => completeProjectPayers(where),
    enabled,
    staleTime: 60_000,
  });
}

export function useCompleteStoredAutoIssuances(where: BendystrawFilter, enabled = true) {
  return useQuery({
    queryKey: ["complete-stored-auto-issuances", where],
    queryFn: () => completeStoredAutoIssuances(where),
    enabled,
  });
}

export function useCompleteAutoIssueEvents(where: BendystrawFilter, enabled = true) {
  return useQuery({
    queryKey: ["complete-auto-issue-events", where],
    queryFn: () => completeAutoIssueEvents(where),
    enabled,
  });
}

export function useCompleteLoans(refs: readonly VersionedProjectRef[], enabled = true) {
  return useQuery({
    queryKey: ["complete-loans", refs],
    queryFn: () => fetchCompleteLoans(refs),
    enabled: enabled && refs.length > 0,
  });
}

const LOANS_REFRESH_MS = 30_000;
const LOANS_AFTER_WRITE_REFRESH_MS = 3_000;
const LOANS_AFTER_WRITE_WINDOW_MS = 30_000;
let loanWriteConfirmedAt = Number.NEGATIVE_INFINITY;

/**
 * A borrow, reallocation or repayment confirmed: the account's loans are read now, then every
 * three seconds for thirty while the indexer catches up, then every thirty again.
 */
export function refreshLoansAfterWrite(client: QueryClient, now = Date.now()) {
  loanWriteConfirmedAt = now;
  void client.invalidateQueries({ queryKey: ["complete-loans-by-account"] });
}

export function loansRefreshInterval(now = Date.now()) {
  return now - loanWriteConfirmedAt < LOANS_AFTER_WRITE_WINDOW_MS
    ? LOANS_AFTER_WRITE_REFRESH_MS
    : LOANS_REFRESH_MS;
}

export function useCompleteLoansByAccount(
  owner: string | undefined,
  version: number,
  chainId?: number,
) {
  return useQuery({
    queryKey: ["complete-loans-by-account", owner ?? null, version, chainId ?? null],
    queryFn: () => fetchLoansByAccount(owner!, version, chainId),
    enabled: !!owner,
    refetchInterval: () => loansRefreshInterval(),
  });
}

export function useCompleteParticipants(where: BendystrawFilter, chainId: number, enabled = true) {
  return useQuery({
    queryKey: ["complete-participants", where, chainId],
    meta: PERSIST,
    queryFn: ({ client, queryKey }) =>
      refreshParticipants(client.getQueryData(queryKey), where, chainId),
    enabled,
    refetchInterval: 30_000,
  });
}

export function useCompleteAccountTokenBalances(account: string, enabled = true) {
  return useQuery({
    queryKey: ["complete-account-token-balances", account],
    queryFn: () => completeAccountTokenBalances(account),
    enabled,
    staleTime: 60_000,
  });
}

export function useCompleteOwnedNfts(where: BendystrawFilter, enabled = true) {
  return useQuery({
    queryKey: ["complete-owned-nfts", where],
    queryFn: () => completeOwnedNfts(where),
    enabled,
    staleTime: 60_000,
  });
}

export function useCompleteProjectsByRefs(wheres: BendystrawFilter[], enabled = true) {
  return useQuery({
    queryKey: ["complete-projects-by-refs", wheres],
    queryFn: async () => (await Promise.all(wheres.map(completeProjects))).flat(),
    enabled,
    staleTime: 60_000,
  });
}

export function useCompleteProjectTickersByRefs(wheres: BendystrawFilter[], enabled = true) {
  return useQuery({
    queryKey: ["complete-project-tickers-by-refs", wheres],
    queryFn: async () => (await Promise.all(wheres.map(completeProjectTickers))).flat(),
    enabled,
    staleTime: 60_000,
  });
}
