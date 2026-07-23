import type {
  ActivityEventsQuery,
  ActivityEventsQueryVariables,
  AllLoansQuery,
  AllLoansQueryVariables,
  AutoIssueEventsQuery,
  AutoIssueEventsQueryVariables,
  CashOutTaxSnapshotsQuery,
  CashOutTaxSnapshotsQueryVariables,
  HasPermissionQuery,
  HasPermissionQueryVariables,
  IndexedBuybackPoolsQuery,
  IndexedBuybackPoolsQueryVariables,
  IndexedPoolSwapsQuery,
  IndexedPoolSwapsQueryVariables,
  LoansByAccountQuery,
  LoansByAccountQueryVariables,
  MintNftEventsQuery,
  MintNftEventsQueryVariables,
  OwnedNftsQuery,
  OwnedNftsQueryVariables,
  ParticipantsQuery,
  ParticipantsQueryVariables,
  PermissionHoldersQuery,
  PermissionHoldersQueryVariables,
  ProjectAccountingContextQuery,
  ProjectAccountingContextQueryVariables,
  ProjectCreateEventQuery,
  ProjectCreateEventQueryVariables,
  ProjectOperatorQuery,
  ProjectOperatorQueryVariables,
  ProjectPayersQuery,
  ProjectPayersQueryVariables,
  ProjectQuery,
  ProjectQueryVariables,
  ProjectWithPermissionsQuery,
  ProjectWithPermissionsQueryVariables,
  ShieldGroupQuery,
  ShieldGroupQueryVariables,
  ShieldProjectQuery,
  ShieldProjectQueryVariables,
  StoreAutoIssuanceAmountEventsQuery,
  StoreAutoIssuanceAmountEventsQueryVariables,
  SuckerGroupMomentsQuery,
  SuckerGroupMomentsQueryVariables,
  SuckerGroupQuery,
  SuckerGroupQueryVariables,
  TopSuckerGroupsQuery,
  TopSuckerGroupsQueryVariables,
  V6AutoIssueEventsQuery,
  V6AutoIssueEventsQueryVariables,
  V6StoredAutoIssuancesQuery,
  V6StoredAutoIssuancesQueryVariables,
} from "./types";

export type BendystrawOperation<TResult, TVariables extends Record<string, unknown>> = {
  readonly id: string;
  readonly validateData: (value: unknown) => value is TResult;
  readonly validateVariables: (value: unknown) => value is TVariables;
};

export type OperationResult<TOperation> =
  TOperation extends BendystrawOperation<infer TResult, Record<string, unknown>> ? TResult : never;
export type OperationVariables<TOperation> =
  TOperation extends BendystrawOperation<unknown, infer TVariables> ? TVariables : never;

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const isString = (value: unknown): value is string => typeof value === "string";
const isNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);
const isInteger = (value: unknown): value is number => isNumber(value) && Number.isInteger(value);
const isOptionalString = (value: unknown): boolean => value === undefined || isString(value);
const isOptionalNumber = (value: unknown): boolean => value === undefined || isNumber(value);

function isSafeInput(value: unknown, depth = 0): boolean {
  if (depth > 8) return false;
  if (
    value === undefined ||
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value))
  ) {
    return typeof value !== "string" || value.length <= 4_096;
  }
  if (Array.isArray(value)) {
    return value.length <= 500 && value.every((item) => isSafeInput(item, depth + 1));
  }
  if (!isObject(value) || Object.keys(value).length > 100) return false;
  return Object.entries(value).every(
    ([key, item]) => /^[A-Za-z_][A-Za-z0-9_]*$/u.test(key) && isSafeInput(item, depth + 1),
  );
}

function variablesWith(
  required: Record<string, (value: unknown) => boolean>,
  optional: Record<string, (value: unknown) => boolean> = {},
) {
  const allowed = new Set([...Object.keys(required), ...Object.keys(optional)]);
  return (value: unknown): value is Record<string, unknown> => {
    if (!isObject(value) || !isSafeInput(value)) return false;
    if (Object.keys(value).some((key) => !allowed.has(key))) return false;
    return (
      Object.entries(required).every(([key, validate]) => key in value && validate(value[key])) &&
      Object.entries(optional).every(([key, validate]) => !(key in value) || validate(value[key]))
    );
  };
}

const noVariables = (value: unknown): value is Record<string, never> =>
  isObject(value) && Object.keys(value).length === 0;
const filter = (value: unknown): boolean => isObject(value) && isSafeInput(value);
const positiveLimit = (value: unknown): boolean => isInteger(value) && value > 0 && value <= 1_000;
const offset = (value: unknown): boolean => isInteger(value) && value >= 0 && value <= 100_000;

function hasRoot(
  root: string,
  shape: "object" | "nullable-object" | "items" | "nullable-items",
): (value: unknown) => boolean {
  return (value) => {
    if (!isObject(value) || !(root in value)) return false;
    const rootValue = value[root];
    if (rootValue === null) return shape === "nullable-object" || shape === "nullable-items";
    if (!isObject(rootValue)) return false;
    if (shape === "object" || shape === "nullable-object") return true;
    return Array.isArray(rootValue.items) && rootValue.items.every(isObject);
  };
}

function operation<TResult, TVariables extends Record<string, unknown>>(
  id: string,
  validateVariables: (value: unknown) => boolean,
  validateData: (value: unknown) => boolean,
): BendystrawOperation<TResult, TVariables> {
  return {
    id,
    validateVariables: validateVariables as (value: unknown) => value is TVariables,
    validateData: validateData as (value: unknown) => value is TResult,
  };
}

const projectVariables = variablesWith({
  projectId: isNumber,
  chainId: isNumber,
  version: isNumber,
});

export const ProjectOperation = operation<ProjectQuery, ProjectQueryVariables>(
  "project.v1",
  projectVariables,
  hasRoot("project", "nullable-object"),
);
export const ProjectAccountingContextOperation = operation<
  ProjectAccountingContextQuery,
  ProjectAccountingContextQueryVariables
>("project-accounting-context.v1", projectVariables, hasRoot("project", "nullable-object"));
export const SuckerGroupOperation = operation<SuckerGroupQuery, SuckerGroupQueryVariables>(
  "sucker-group.v1",
  variablesWith({ id: isString }),
  hasRoot("suckerGroup", "nullable-object"),
);
export const ParticipantsOperation = operation<ParticipantsQuery, ParticipantsQueryVariables>(
  "participants.v1",
  variablesWith(
    {},
    {
      where: filter,
      orderBy: isString,
      orderDirection: isString,
      limit: positiveLimit,
    },
  ),
  hasRoot("participants", "items"),
);
export const ActivityEventsOperation = operation<ActivityEventsQuery, ActivityEventsQueryVariables>(
  "activity-events.v1",
  variablesWith({}, { where: filter, orderBy: isString, orderDirection: isString }),
  hasRoot("activityEvents", "items"),
);
export const HasPermissionOperation = operation<HasPermissionQuery, HasPermissionQueryVariables>(
  "has-permission.v1",
  variablesWith({
    account: isString,
    chainId: isNumber,
    projectId: isNumber,
    operator: isString,
    version: isNumber,
  }),
  hasRoot("permissionHolder", "nullable-object"),
);
export const ProjectCreateEventOperation = operation<
  ProjectCreateEventQuery,
  ProjectCreateEventQueryVariables
>(
  "project-create-event.v1",
  variablesWith({}, { where: filter }),
  hasRoot("projectCreateEvents", "items"),
);
export const ProjectOperatorOperation = operation<
  ProjectOperatorQuery,
  ProjectOperatorQueryVariables
>("project-operator.v1", projectVariables, hasRoot("permissionHolders", "items"));
export const ProjectWithPermissionsOperation = operation<
  ProjectWithPermissionsQuery,
  ProjectWithPermissionsQueryVariables
>("project-with-permissions.v1", projectVariables, hasRoot("project", "nullable-object"));
export const StoreAutoIssuanceAmountEventsOperation = operation<
  StoreAutoIssuanceAmountEventsQuery,
  StoreAutoIssuanceAmountEventsQueryVariables
>(
  "stored-auto-issuance-events.v1",
  variablesWith({}, { where: filter, orderBy: isString, orderDirection: isString }),
  hasRoot("storeAutoIssuanceAmountEvents", "items"),
);
export const AutoIssueEventsOperation = operation<
  AutoIssueEventsQuery,
  AutoIssueEventsQueryVariables
>(
  "auto-issue-events.v1",
  variablesWith({}, { where: filter, orderBy: isString, orderDirection: isString }),
  hasRoot("autoIssueEvents", "items"),
);
export const LoansByAccountOperation = operation<LoansByAccountQuery, LoansByAccountQueryVariables>(
  "loans-by-account.v1",
  variablesWith({ owner: isString, version: isNumber }),
  hasRoot("loans", "items"),
);
export const CashOutTaxSnapshotsOperation = operation<
  CashOutTaxSnapshotsQuery,
  CashOutTaxSnapshotsQueryVariables
>(
  "cash-out-tax-snapshots.v1",
  variablesWith({ suckerGroupId: isString }, { after: isOptionalString }),
  hasRoot("cashOutTaxSnapshots", "items"),
);
export const SuckerGroupMomentsOperation = operation<
  SuckerGroupMomentsQuery,
  SuckerGroupMomentsQueryVariables
>(
  "sucker-group-moments.v1",
  variablesWith({ suckerGroupId: isString }, { after: isOptionalString }),
  hasRoot("suckerGroupMoments", "items"),
);
export const TopSuckerGroupsOperation = operation<
  TopSuckerGroupsQuery,
  TopSuckerGroupsQueryVariables
>("top-sucker-groups.v1", noVariables, hasRoot("suckerGroups", "items"));
export const ProjectPayersOperation = operation<ProjectPayersQuery, ProjectPayersQueryVariables>(
  "project-payers.v1",
  variablesWith({ where: filter }),
  hasRoot("projectPayers", "nullable-items"),
);
export const PermissionHoldersOperation = operation<
  PermissionHoldersQuery,
  PermissionHoldersQueryVariables
>(
  "permission-holders.v1",
  variablesWith({ where: filter }),
  hasRoot("permissionHolders", "nullable-items"),
);
export const V6StoredAutoIssuancesOperation = operation<
  V6StoredAutoIssuancesQuery,
  V6StoredAutoIssuancesQueryVariables
>(
  "v6-stored-auto-issuances.v1",
  variablesWith({ where: filter }),
  hasRoot("storeAutoIssuanceAmountEvents", "items"),
);
export const V6AutoIssueEventsOperation = operation<
  V6AutoIssueEventsQuery,
  V6AutoIssueEventsQueryVariables
>("v6-auto-issue-events.v1", variablesWith({ where: filter }), hasRoot("autoIssueEvents", "items"));
export const AllLoansOperation = operation<AllLoansQuery, AllLoansQueryVariables>(
  "all-loans.v1",
  variablesWith({ where: filter }),
  hasRoot("loans", "nullable-items"),
);
export const IndexedBuybackPoolsOperation = operation<
  IndexedBuybackPoolsQuery,
  IndexedBuybackPoolsQueryVariables
>("indexed-buyback-pools.v1", projectVariables, hasRoot("buybackPoolEvents", "items"));
export const IndexedPoolSwapsOperation = operation<
  IndexedPoolSwapsQuery,
  IndexedPoolSwapsQueryVariables
>(
  "indexed-pool-swaps.v1",
  variablesWith({
    projectId: isNumber,
    chainId: isNumber,
    version: isNumber,
    limit: positiveLimit,
    offset,
  }),
  hasRoot("swapEvents", "items"),
);
export const OwnedNftsOperation = operation<OwnedNftsQuery, OwnedNftsQueryVariables>(
  "owned-nfts.v1",
  variablesWith({ where: filter, limit: positiveLimit, offset }),
  hasRoot("nfts", "items"),
);
export const MintNftEventsOperation = operation<MintNftEventsQuery, MintNftEventsQueryVariables>(
  "mint-nft-events.v1",
  variablesWith({ where: filter, limit: positiveLimit, offset }),
  hasRoot("mintNftEvents", "items"),
);
export const ShieldProjectOperation = operation<ShieldProjectQuery, ShieldProjectQueryVariables>(
  "shield-project.v1",
  variablesWith({ chainId: isNumber, projectId: isNumber }),
  hasRoot("project", "nullable-object"),
);
export const ShieldGroupOperation = operation<ShieldGroupQuery, ShieldGroupQueryVariables>(
  "shield-group.v1",
  variablesWith({ id: isString }),
  hasRoot("suckerGroup", "nullable-object"),
);

export const BENDYSTRAW_OPERATIONS = [
  ProjectOperation,
  ProjectAccountingContextOperation,
  SuckerGroupOperation,
  ParticipantsOperation,
  ActivityEventsOperation,
  HasPermissionOperation,
  ProjectCreateEventOperation,
  ProjectOperatorOperation,
  ProjectWithPermissionsOperation,
  StoreAutoIssuanceAmountEventsOperation,
  AutoIssueEventsOperation,
  LoansByAccountOperation,
  CashOutTaxSnapshotsOperation,
  SuckerGroupMomentsOperation,
  TopSuckerGroupsOperation,
  ProjectPayersOperation,
  PermissionHoldersOperation,
  V6StoredAutoIssuancesOperation,
  V6AutoIssueEventsOperation,
  AllLoansOperation,
  IndexedBuybackPoolsOperation,
  IndexedPoolSwapsOperation,
  OwnedNftsOperation,
  MintNftEventsOperation,
  ShieldProjectOperation,
  ShieldGroupOperation,
] as const;

export type RegisteredBendystrawOperation = (typeof BENDYSTRAW_OPERATIONS)[number];

export function getOperationById(id: string): RegisteredBendystrawOperation | undefined {
  return BENDYSTRAW_OPERATIONS.find((operation) => operation.id === id);
}

/**
 * Operations needed by client components through the same-origin BFF.
 *
 * Server-rendered pages and server routes call `queryBendystraw` directly.
 * Keeping those operations out of this list prevents the public proxy from
 * exposing heavier history, ranking, price, and shield queries which have no
 * browser consumer.
 */
export const BROWSER_BENDYSTRAW_OPERATIONS = [
  ProjectOperation,
  ProjectAccountingContextOperation,
  SuckerGroupOperation,
  ParticipantsOperation,
  ActivityEventsOperation,
  HasPermissionOperation,
  ProjectCreateEventOperation,
  ProjectOperatorOperation,
  ProjectWithPermissionsOperation,
  StoreAutoIssuanceAmountEventsOperation,
  AutoIssueEventsOperation,
  LoansByAccountOperation,
  ProjectPayersOperation,
  PermissionHoldersOperation,
  V6StoredAutoIssuancesOperation,
  V6AutoIssueEventsOperation,
  AllLoansOperation,
  OwnedNftsOperation,
  MintNftEventsOperation,
] as const;

export type BrowserBendystrawOperation = (typeof BROWSER_BENDYSTRAW_OPERATIONS)[number];

export function getBrowserOperationById(id: string): BrowserBendystrawOperation | undefined {
  return BROWSER_BENDYSTRAW_OPERATIONS.find((operation) => operation.id === id);
}
