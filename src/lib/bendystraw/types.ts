export type BigNumberish = string | number;
export type BendystrawFilter = Record<string, unknown>;

export type Project = {
  balance: BigNumberish;
  chainId: number;
  createdAt: number;
  currency: BigNumberish | null;
  decimals: number | null;
  handle: string | null;
  isRevnet: boolean | null;
  logoUri: string | null;
  metadata?: unknown;
  metadataUri: string | null;
  name: string | null;
  owner: string;
  projectId: number;
  projectTagline?: string | null;
  suckerGroupId: string;
  token: string | null;
  tokenSupply: BigNumberish;
  tokenSymbol: string | null;
  version: number;
};

export type Participant = {
  address: string;
  balance: BigNumberish;
  chainId: number;
  creditBalance: BigNumberish;
  erc20Balance: BigNumberish;
  lastPaidTimestamp: number;
  projectId: number;
  suckerGroupId: string;
  version: number;
  volume: BigNumberish;
};

export type PermissionHolder = {
  account: string;
  chainId: number;
  isRevnetOperator: boolean | null;
  operator: string;
  permissions: number[] | null;
  projectId: number;
  version: number;
};

export type ProjectPayer = {
  addToBalanceCount: number;
  address: string;
  balanceAdded: BigNumberish;
  balanceAddedUsd: BigNumberish;
  chainId: number;
  createdAt: number;
  defaultAddToBalance: boolean;
  defaultBeneficiary: string;
  defaultMemo: string;
  defaultMetadata: string;
  deployer: string;
  lastUsedAt: number | null;
  owner: string;
  paymentsCount: number;
  projectId: number;
  suckerGroupId: string;
  totalFacilitated: BigNumberish;
  totalFacilitatedUsd: BigNumberish;
  version: number;
  volume: BigNumberish;
  volumeUsd: BigNumberish;
};

export type PermissionHolderFilter = BendystrawFilter;
export type ProjectPayerFilter = BendystrawFilter;

export type ProjectQueryVariables = {
  projectId: number;
  chainId: number;
  version: number;
};
export type ProjectQuery = {
  project: Pick<
    Project,
    | "projectId"
    | "metadataUri"
    | "handle"
    | "createdAt"
    | "suckerGroupId"
    | "logoUri"
    | "name"
    | "version"
    | "token"
    | "decimals"
    | "currency"
    | "tokenSymbol"
    | "isRevnet"
  > | null;
};

export type ProjectAccountingContextQueryVariables = ProjectQueryVariables;
export type ProjectAccountingContextQuery = {
  project: Pick<Project, "token" | "decimals" | "currency"> | null;
};

export type SuckerGroupProject = Pick<
  Project,
  | "balance"
  | "chainId"
  | "currency"
  | "decimals"
  | "projectId"
  | "token"
  | "tokenSymbol"
  | "version"
  | "suckerGroupId"
> & { tokenSupply: BigNumberish };

export type SuckerGroupQueryVariables = { id: string };
export type SuckerGroupQuery = {
  suckerGroup: {
    id: string;
    tokenSupply: BigNumberish;
    projects: { items: SuckerGroupProject[] } | null;
  } | null;
};

export type ParticipantsQueryVariables = {
  where?: BendystrawFilter;
  orderBy?: string;
  orderDirection?: string;
  limit?: number;
};
export type ParticipantsQuery = {
  participants: {
    totalCount: number;
    items: Array<
      Pick<
        Participant,
        | "chainId"
        | "address"
        | "volume"
        | "lastPaidTimestamp"
        | "balance"
        | "erc20Balance"
        | "creditBalance"
      >
    >;
  };
};

type ActivityProject = Pick<Project, "projectId" | "handle" | "version"> & { id: string };
type ActivityPayment = {
  id: string;
  amount: BigNumberish;
  beneficiary: string;
  memo: string | null;
  timestamp: number;
  feeFromProject: number | null;
  newlyIssuedTokenCount: BigNumberish;
  from: string;
  txHash: string;
  amountUsd: BigNumberish;
  caller: string;
  distributionFromProjectId: number | null;
  projectId: number;
  project: ActivityProject | null;
};
type ActivityCashOut = {
  id: string;
  timestamp: number;
  txHash: string;
  from: string;
  beneficiary: string;
  reclaimAmount: BigNumberish;
  cashOutCount: BigNumberish;
  metadata: string;
  project: ActivityProject | null;
};
type ActivityBase = { txHash: string; timestamp: number; from: string };

export type ActivityEventsQueryVariables = {
  where?: BendystrawFilter;
  orderBy?: string;
  orderDirection?: string;
};
export type ActivityEventsQuery = {
  activityEvents: {
    items: Array<{
      id: string;
      chainId: number;
      timestamp: number;
      txHash: string;
      payEvent: ActivityPayment | null;
      cashOutTokensEvent: ActivityCashOut | null;
      addToBalanceEvent: (ActivityBase & { amount: BigNumberish; memo: string | null }) | null;
      mintTokensEvent:
        | (ActivityBase & {
            caller: string;
            beneficiary: string;
            beneficiaryTokenCount: BigNumberish;
            memo: string | null;
          })
        | null;
      manualMintTokensEvent:
        | (ActivityBase & {
            beneficiary: string;
            beneficiaryTokenCount: BigNumberish;
            memo: string | null;
          })
        | null;
      autoIssueEvent: (ActivityBase & { beneficiary: string; count: BigNumberish }) | null;
      deployErc20Event: (ActivityBase & { symbol: string }) | null;
      projectCreateEvent: ActivityBase | null;
      projectTransferEvent: (ActivityBase & { previousOwner: string; owner: string }) | null;
      operatorPermissionsSetEvent:
        | (ActivityBase & { caller: string; operator: string; isRevnetOperator: boolean | null })
        | null;
      rulesetQueuedEvent: (ActivityBase & { caller: string; cycleNumber: number }) | null;
      buybackPoolEvent: (ActivityBase & { caller: string }) | null;
    }>;
  };
};

export type HasPermissionQueryVariables = {
  account: string;
  chainId: number;
  projectId: number;
  operator: string;
  version: number;
};
export type HasPermissionQuery = {
  permissionHolder: { permissions: number[] | null } | null;
};

export type ProjectCreateEventQueryVariables = { where?: BendystrawFilter };
export type ProjectCreateEventQuery = {
  projectCreateEvents: { items: Array<{ txHash: string; timestamp: number }> };
};

export type ProjectOperatorQueryVariables = {
  chainId: number;
  projectId: number;
  version: number;
};
export type ProjectOperatorQuery = {
  permissionHolders: { items: Array<{ operator: string }> };
};

export type ProjectWithPermissionsQueryVariables = ProjectQueryVariables;
export type ProjectWithPermissionsQuery = {
  project: {
    projectId: number;
    chainId: number;
    version: number;
    owner: string;
    permissionHolders: {
      items: Array<Pick<PermissionHolder, "account" | "operator" | "permissions">>;
    } | null;
  } | null;
};

export type StoreAutoIssuanceAmountEventsQueryVariables = {
  where?: BendystrawFilter;
  orderBy?: string;
  orderDirection?: string;
};
export type StoreAutoIssuanceAmountEventsQuery = {
  storeAutoIssuanceAmountEvents: {
    items: Array<{
      id: string;
      projectId: number;
      beneficiary: string;
      count: BigNumberish;
      stageId: BigNumberish;
      caller: string;
    }>;
  };
};

export type AutoIssueEventsQueryVariables = StoreAutoIssuanceAmountEventsQueryVariables;
export type AutoIssueEventsQuery = {
  autoIssueEvents: {
    items: Array<{
      id: string;
      projectId: number;
      stageId: BigNumberish;
      beneficiary: string;
      count: BigNumberish;
      caller: string;
    }>;
  };
};

export type LoanRow = {
  borrowAmount: BigNumberish;
  collateral: BigNumberish;
  prepaidDuration: number;
  projectId: number;
  terminal: string;
  token: string;
  chainId: number;
  createdAt: number;
  id: BigNumberish;
  project: { version: number } | null;
};
export type LoansByAccountQueryVariables = { owner: string; version: number };
export type LoansByAccountQuery = { loans: { items: LoanRow[] } };

export type CashOutTaxSnapshot = {
  cashOutTax: number;
  start: BigNumberish;
  duration: BigNumberish;
  rulesetId: BigNumberish;
  suckerGroupId: string;
  version: number;
};
export type CashOutTaxSnapshotsQueryVariables = { suckerGroupId: string; after?: string };
export type CashOutTaxSnapshotsQuery = {
  cashOutTaxSnapshots: {
    items: CashOutTaxSnapshot[];
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
  };
};

export type SuckerGroupMoment = {
  timestamp: number;
  balance: BigNumberish;
  tokenSupply: BigNumberish;
  suckerGroupId: string;
  version: number;
};
export type SuckerGroupMomentsQueryVariables = { suckerGroupId: string; after?: string };
export type SuckerGroupMomentsQuery = {
  suckerGroupMoments: {
    items: SuckerGroupMoment[];
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
  };
};

export type TopSuckerGroupsQueryVariables = Record<string, never>;
export type TopSuckerGroupsQuery = {
  suckerGroups: {
    items: Array<{
      balance: BigNumberish;
      projects: {
        items: Array<
          Pick<
            Project,
            | "decimals"
            | "currency"
            | "chainId"
            | "name"
            | "projectTagline"
            | "tokenSymbol"
            | "logoUri"
            | "projectId"
            | "isRevnet"
          >
        >;
      } | null;
    }>;
  };
};

export type ProjectPayersQueryVariables = { where: ProjectPayerFilter };
export type ProjectPayersQuery = {
  projectPayers: {
    items: Array<
      Pick<
        ProjectPayer,
        | "address"
        | "chainId"
        | "owner"
        | "paymentsCount"
        | "defaultAddToBalance"
        | "defaultBeneficiary"
        | "addToBalanceCount"
        | "totalFacilitated"
        | "totalFacilitatedUsd"
        | "createdAt"
        | "lastUsedAt"
      >
    >;
  } | null;
};

export type PermissionHoldersQueryVariables = { where: PermissionHolderFilter };
export type PermissionHoldersQuery = {
  permissionHolders: {
    items: Array<
      Pick<
        PermissionHolder,
        "chainId" | "projectId" | "account" | "operator" | "permissions" | "isRevnetOperator"
      >
    >;
  } | null;
};

export type V6StoredAutoIssuancesQueryVariables = { where: BendystrawFilter };
export type V6StoredAutoIssuancesQuery = {
  storeAutoIssuanceAmountEvents: {
    items: Array<{
      id: string;
      chainId: number;
      projectId: number;
      stageId: string;
      beneficiary: string;
      count: string;
    }>;
  };
};
export type V6AutoIssueEventsQueryVariables = { where: BendystrawFilter };
export type V6AutoIssueEventsQuery = {
  autoIssueEvents: {
    items: Array<{
      id: string;
      chainId: number;
      stageId: string;
      beneficiary: string;
      count: string;
    }>;
  };
};

export type AllLoansQueryVariables = {
  where: { projectId_in: number[]; version: number; chainId_in: number[] };
};
export type AllLoansQuery = {
  loans: {
    items: Array<{
      id: string;
      borrowAmount: string;
      collateral: string;
      beneficiary: string;
      owner: string;
      createdAt: number;
      chainId: number;
    }>;
    totalCount: number;
  } | null;
};

export type IndexedBuybackPoolsQueryVariables = {
  projectId: number;
  chainId: number;
  version: number;
};
export type IndexedBuybackPoolsQuery = {
  buybackPoolEvents: {
    items: Array<{
      timestamp: number;
      terminalToken: string;
      poolId: string;
      initialSqrtPriceX96: string | null;
      projectTokenIsCurrency0: boolean | null;
    }>;
  };
};
export type IndexedPoolSwapsQueryVariables = IndexedBuybackPoolsQueryVariables & {
  limit: number;
  offset: number;
};
export type IndexedPoolSwapsQuery = {
  swapEvents: {
    items: Array<{
      timestamp: number;
      direction: string;
      poolId: string | null;
      terminalTokenAmount: string;
      projectTokenAmount: string;
      sqrtPriceX96: string | null;
      projectTokenIsCurrency0: boolean | null;
    }>;
    totalCount: number;
  };
};

export type OwnedNftsQueryVariables = {
  where: BendystrawFilter;
  limit: number;
  offset: number;
};
export type OwnedNftsQuery = {
  nfts: {
    items: Array<{
      chainId: number;
      projectId: number;
      owner: string;
      tierId: number;
      tokenId: BigNumberish;
      tokenUri: string | null;
    }>;
    totalCount: number;
  };
};

export type MintNftEventsQueryVariables = {
  where: BendystrawFilter;
  limit: number;
  offset: number;
};
export type MintNftEventsQuery = {
  mintNftEvents: {
    items: Array<{
      beneficiary: string;
      chainId: number;
      projectId: number;
      tierId: number;
      timestamp: number;
      tokenId: BigNumberish;
      totalAmountPaid: BigNumberish;
      txHash: string;
    }>;
    totalCount: number;
  };
};

export type ShieldProjectQueryVariables = { chainId: number; projectId: number };
export type ShieldProjectQuery = {
  project: { id: string; suckerGroupId: string } | null;
};
export type ShieldGroupQueryVariables = { id: string };
export type ShieldGroupQuery = {
  suckerGroup: {
    balance: BigNumberish;
    volume: BigNumberish;
    volumeUsd: BigNumberish;
    projects: {
      items: Array<{
        balance: BigNumberish;
        chainId: number;
        isRevnet: boolean | null;
        id: string;
        name: string | null;
        volumeUsd: BigNumberish;
        volume: BigNumberish;
        participants: {
          totalCount: number;
          items: Array<{
            address: string;
            chainId: number;
            projectId: number;
            lastPaidTimestamp: number;
            balance: BigNumberish;
          }>;
        } | null;
        metadata: unknown;
      }>;
    } | null;
  } | null;
};
