import "server-only";

import {
  ActivityEventsOperation,
  AllLoansOperation,
  AutoIssueEventsOperation,
  CashOutTaxSnapshotsOperation,
  HasPermissionOperation,
  IndexedBuybackPoolsOperation,
  IndexedPoolSwapsOperation,
  LoansByAccountOperation,
  MintNftEventsOperation,
  OwnedNftsOperation,
  ParticipantsOperation,
  PermissionHoldersOperation,
  ProjectAccountingContextOperation,
  ProjectCreateEventOperation,
  ProjectOperation,
  ProjectOperatorOperation,
  ProjectPayersOperation,
  ProjectWithPermissionsOperation,
  ShieldGroupOperation,
  ShieldProjectOperation,
  StoreAutoIssuanceAmountEventsOperation,
  SuckerGroupMomentsOperation,
  SuckerGroupOperation,
  TopSuckerGroupsOperation,
  V6AutoIssueEventsOperation,
  V6StoredAutoIssuancesOperation,
} from "./operations";

type RegisteredQuery = {
  readonly operationName: string;
  readonly query: string;
};

const PROJECT_FIELDS = `
  projectId
  metadataUri
  handle
  createdAt
  suckerGroupId
  logoUri
  name
  version
  token
  decimals
  currency
  tokenSymbol
  isRevnet
`;

export const BENDYSTRAW_QUERY_REGISTRY: Readonly<Record<string, RegisteredQuery>> = {
  [ProjectOperation.id]: {
    operationName: "Project",
    query: `query Project($projectId: Float!, $chainId: Float!, $version: Float!) {
      project(projectId: $projectId, chainId: $chainId, version: $version) {
        ${PROJECT_FIELDS}
      }
    }`,
  },
  [ProjectAccountingContextOperation.id]: {
    operationName: "ProjectAccountingContext",
    query: `query ProjectAccountingContext(
      $chainId: Float!
      $projectId: Float!
      $version: Float!
    ) {
      project(chainId: $chainId, projectId: $projectId, version: $version) {
        token
        decimals
        currency
      }
    }`,
  },
  [SuckerGroupOperation.id]: {
    operationName: "SuckerGroup",
    query: `query SuckerGroup($id: String!) {
      suckerGroup(id: $id) {
        id
        tokenSupply
        projects {
          items {
            balance
            chainId
            currency
            decimals
            projectId
            token
            tokenSupply
            tokenSymbol
            version
            suckerGroupId
          }
        }
      }
    }`,
  },
  [ParticipantsOperation.id]: {
    operationName: "Participants",
    query: `query Participants(
      $where: participantFilter
      $orderBy: String
      $orderDirection: String
      $limit: Int
    ) {
      participants(
        where: $where
        orderBy: $orderBy
        orderDirection: $orderDirection
        limit: $limit
      ) {
        totalCount
        items {
          chainId
          address
          volume
          lastPaidTimestamp
          balance
          erc20Balance
          creditBalance
        }
      }
    }`,
  },
  [ActivityEventsOperation.id]: {
    operationName: "ActivityEvents",
    query: `query ActivityEvents(
      $where: activityEventFilter
      $orderBy: String
      $orderDirection: String
    ) {
      activityEvents(
        where: $where
        orderBy: $orderBy
        orderDirection: $orderDirection
        limit: 1000
      ) {
        items {
          id
          chainId
          timestamp
          txHash
          payEvent {
            id
            amount
            beneficiary
            memo
            timestamp
            feeFromProject
            newlyIssuedTokenCount
            from
            txHash
            amountUsd
            caller
            distributionFromProjectId
            projectId
            project { id projectId handle version }
          }
          cashOutTokensEvent {
            id
            timestamp
            txHash
            from
            beneficiary
            reclaimAmount
            cashOutCount
            metadata
            project { id projectId handle version }
          }
          addToBalanceEvent { txHash timestamp from amount memo }
          mintTokensEvent {
            txHash timestamp from caller beneficiary beneficiaryTokenCount memo
          }
          manualMintTokensEvent {
            txHash timestamp from beneficiary beneficiaryTokenCount memo
          }
          autoIssueEvent { txHash timestamp from beneficiary count }
          deployErc20Event { txHash timestamp from symbol }
          projectCreateEvent { txHash timestamp from }
          projectTransferEvent { txHash timestamp from previousOwner owner }
          operatorPermissionsSetEvent {
            txHash timestamp from caller operator isRevnetOperator
          }
          rulesetQueuedEvent { txHash timestamp from caller cycleNumber }
          buybackPoolEvent { txHash timestamp from caller }
        }
      }
    }`,
  },
  [HasPermissionOperation.id]: {
    operationName: "HasPermission",
    query: `query HasPermission(
      $account: String!
      $chainId: Float!
      $projectId: Float!
      $operator: String!
      $version: Float!
    ) {
      permissionHolder(
        account: $account
        chainId: $chainId
        projectId: $projectId
        operator: $operator
        version: $version
      ) {
        permissions
      }
    }`,
  },
  [ProjectCreateEventOperation.id]: {
    operationName: "ProjectCreateEvent",
    query: `query ProjectCreateEvent($where: projectCreateEventFilter) {
      projectCreateEvents(where: $where, limit: 1) {
        items { txHash timestamp }
      }
    }`,
  },
  [ProjectOperatorOperation.id]: {
    operationName: "ProjectOperator",
    query: `query ProjectOperator($chainId: Int!, $projectId: Int!, $version: Int!) {
      permissionHolders(
        where: {
          chainId: $chainId
          projectId: $projectId
          version: $version
          isRevnetOperator: true
        }
        limit: 1
      ) {
        items { operator }
      }
    }`,
  },
  [ProjectWithPermissionsOperation.id]: {
    operationName: "ProjectWithPermissions",
    query: `query ProjectWithPermissions(
      $projectId: Float!
      $chainId: Float!
      $version: Float!
    ) {
      project(projectId: $projectId, chainId: $chainId, version: $version) {
        projectId
        chainId
        version
        owner
        permissionHolders {
          items { account operator permissions }
        }
      }
    }`,
  },
  [StoreAutoIssuanceAmountEventsOperation.id]: {
    operationName: "StoreAutoIssuanceAmountEvents",
    query: `query StoreAutoIssuanceAmountEvents(
      $where: storeAutoIssuanceAmountEventFilter
      $orderBy: String
      $orderDirection: String
    ) {
      storeAutoIssuanceAmountEvents(
        where: $where
        orderBy: $orderBy
        orderDirection: $orderDirection
      ) {
        items { id projectId beneficiary count stageId caller }
      }
    }`,
  },
  [AutoIssueEventsOperation.id]: {
    operationName: "AutoIssueEvents",
    query: `query AutoIssueEvents(
      $where: autoIssueEventFilter
      $orderBy: String
      $orderDirection: String
    ) {
      autoIssueEvents(
        where: $where
        orderBy: $orderBy
        orderDirection: $orderDirection
      ) {
        items { id projectId stageId beneficiary count caller }
      }
    }`,
  },
  [LoansByAccountOperation.id]: {
    operationName: "LoansByAccount",
    query: `query LoansByAccount($owner: String!, $version: Int!) {
      loans(where: { owner: $owner, version: $version }) {
        items {
          borrowAmount
          collateral
          prepaidDuration
          projectId
          terminal
          token
          chainId
          createdAt
          id
          project { version }
        }
      }
    }`,
  },
  [CashOutTaxSnapshotsOperation.id]: {
    operationName: "CashOutTaxSnapshots",
    query: `query CashOutTaxSnapshots($suckerGroupId: String!, $after: String) {
      cashOutTaxSnapshots(
        where: { suckerGroupId: $suckerGroupId }
        orderBy: "start"
        orderDirection: "asc"
        limit: 1000
        after: $after
      ) {
        items { cashOutTax start duration rulesetId suckerGroupId version }
        pageInfo { hasNextPage endCursor }
      }
    }`,
  },
  [SuckerGroupMomentsOperation.id]: {
    operationName: "SuckerGroupMoments",
    query: `query SuckerGroupMoments($suckerGroupId: String!, $after: String) {
      suckerGroupMoments(
        where: { suckerGroupId: $suckerGroupId }
        orderBy: "timestamp"
        orderDirection: "asc"
        limit: 1000
        after: $after
      ) {
        items { timestamp balance tokenSupply suckerGroupId version }
        pageInfo { hasNextPage endCursor }
      }
    }`,
  },
  [TopSuckerGroupsOperation.id]: {
    operationName: "TopSuckerGroups",
    query: `query TopSuckerGroups {
      suckerGroups(
        orderBy: "paymentsCount"
        orderDirection: "desc"
        where: { version: 6 }
        limit: 1000
      ) {
        items {
          balance
          projects(limit: 1, orderBy: "chainId", orderDirection: "asc") {
            items {
              decimals
              currency
              chainId
              name
              projectTagline
              tokenSymbol
              logoUri
              projectId
              isRevnet
            }
          }
        }
      }
    }`,
  },
  [ProjectPayersOperation.id]: {
    operationName: "V6ProjectPayers",
    query: `query V6ProjectPayers($where: ProjectPayerFilter) {
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
    }`,
  },
  [PermissionHoldersOperation.id]: {
    operationName: "V6PermissionHolders",
    query: `query V6PermissionHolders($where: PermissionHolderFilter) {
      permissionHolders(where: $where, limit: 500) {
        items {
          chainId
          projectId
          account
          operator
          permissions
          isRevnetOperator
        }
      }
    }`,
  },
  [V6StoredAutoIssuancesOperation.id]: {
    operationName: "V6StoredAutoIssuances",
    query: `query V6StoredAutoIssuances($where: storeAutoIssuanceAmountEventFilter) {
      storeAutoIssuanceAmountEvents(where: $where, limit: 200) {
        items { id chainId projectId stageId beneficiary count }
      }
    }`,
  },
  [V6AutoIssueEventsOperation.id]: {
    operationName: "V6AutoIssueEvents",
    query: `query V6AutoIssueEvents($where: autoIssueEventFilter) {
      autoIssueEvents(where: $where, limit: 200) {
        items { id chainId stageId beneficiary count }
      }
    }`,
  },
  [AllLoansOperation.id]: {
    operationName: "V6AllLoans",
    query: `query V6AllLoans($where: loanFilter) {
      loans(where: $where, orderBy: "createdAt", orderDirection: "desc", limit: 50) {
        items { id borrowAmount collateral beneficiary owner createdAt chainId }
        totalCount
      }
    }`,
  },
  [IndexedBuybackPoolsOperation.id]: {
    operationName: "IndexedBuybackPools",
    query: `query IndexedBuybackPools($projectId: Int!, $chainId: Int!, $version: Int!) {
      buybackPoolEvents(
        where: { projectId: $projectId, chainId: $chainId, version: $version }
        orderBy: "timestamp"
        orderDirection: "desc"
        limit: 100
      ) {
        items {
          timestamp
          terminalToken
          poolId
          initialSqrtPriceX96
          projectTokenIsCurrency0
        }
      }
    }`,
  },
  [IndexedPoolSwapsOperation.id]: {
    operationName: "IndexedPoolSwaps",
    query: `query IndexedPoolSwaps(
      $projectId: Int!
      $chainId: Int!
      $version: Int!
      $limit: Int!
      $offset: Int!
    ) {
      swapEvents(
        where: { projectId: $projectId, chainId: $chainId, version: $version }
        orderBy: "timestamp"
        orderDirection: "asc"
        limit: $limit
        offset: $offset
      ) {
        items {
          timestamp
          direction
          poolId
          terminalTokenAmount
          projectTokenAmount
          sqrtPriceX96
          projectTokenIsCurrency0
        }
        totalCount
      }
    }`,
  },
  [OwnedNftsOperation.id]: {
    operationName: "OwnedNfts",
    query: `query OwnedNfts($where: nftFilter, $limit: Int!, $offset: Int!) {
      nfts(
        where: $where
        orderBy: "createdAt"
        orderDirection: "desc"
        limit: $limit
        offset: $offset
      ) {
        items { chainId projectId owner tierId tokenId tokenUri }
        totalCount
      }
    }`,
  },
  [MintNftEventsOperation.id]: {
    operationName: "MintNftEvents",
    query: `query MintNftEvents($where: mintNftEventFilter, $limit: Int!, $offset: Int!) {
      mintNftEvents(
        where: $where
        orderBy: "timestamp"
        orderDirection: "desc"
        limit: $limit
        offset: $offset
      ) {
        items {
          beneficiary
          chainId
          projectId
          tierId
          timestamp
          tokenId
          totalAmountPaid
          txHash
        }
        totalCount
      }
    }`,
  },
  [ShieldProjectOperation.id]: {
    operationName: "ShieldProject",
    query: `query ShieldProject($chainId: Int!, $projectId: Int!) {
      project(chainId: $chainId, projectId: $projectId) {
        id
        suckerGroupId
      }
    }`,
  },
  [ShieldGroupOperation.id]: {
    operationName: "ShieldGroup",
    query: `query ShieldGroup($id: String!) {
      suckerGroup(id: $id) {
        balance
        volume
        volumeUsd
        projects {
          items {
            balance
            chainId
            isRevnet
            id
            name
            volumeUsd
            volume
            participants {
              totalCount
              items { address chainId projectId lastPaidTimestamp balance }
            }
            metadata
          }
        }
      }
    }`,
  },
};

export function getRegisteredQuery(operationId: string): RegisteredQuery | undefined {
  return BENDYSTRAW_QUERY_REGISTRY[operationId];
}
