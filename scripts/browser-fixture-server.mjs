import {
  JBBuybackHookContracts,
  JBCoreContracts,
  JBRouterTerminalContracts,
  RevnetCoreContracts,
  jbBuybackHookRegistryAbi,
  jbContractAddress,
  jbControllerAbi,
  jbDirectoryAbi,
  jbMultiTerminalAbi,
  jbProjectsAbi,
  jbRouterTerminalRegistryAbi,
  jbRulesetsAbi,
  jbSplitsAbi,
  jbTerminalStoreAbi,
  jbTokensAbi,
  revOwnerAbi,
} from "@bananapus/nana-sdk-core";
import { Kind, parse, print, stripIgnoredCharacters } from "graphql";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import {
  decodeFunctionData,
  encodeFunctionResult,
  erc20Abi,
  getAddress,
  multicall3Abi,
  toFunctionSelector,
  zeroAddress,
} from "viem";
import { mainnet } from "viem/chains";
import browserProject from "../test/fixtures/browser-project.json" with { type: "json" };

const port = browserProject.fixturePort;
const host = "127.0.0.1";
const appOrigin = `http://127.0.0.1:${browserProject.appPort}`;
const maxBodyBytes = 1024 * 1024;
const chainId = 1;
const projectId = 1;
const suckerGroupId = "fixture-sucker-group";
const fixtureCid = browserProject.cid;
const usdc = getAddress("0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48");
const projectToken = getAddress("0x4444444444444444444444444444444444444444");
const nativeToken = getAddress("0x000000000000000000000000000000000000EEEe");
const fixtureOwner = getAddress("0x1111111111111111111111111111111111111111");
const fixtureParticipant = getAddress("0x2222222222222222222222222222222222222222");
const fixtureOwners = [fixtureOwner, fixtureParticipant];
const ensReverseAbi = [
  {
    name: "reverseWithGateways",
    type: "function",
    stateMutability: "view",
    inputs: [
      { type: "bytes", name: "reverseName" },
      { type: "uint256", name: "coinType" },
      { type: "string[]", name: "gateways" },
    ],
    outputs: [
      { type: "string", name: "resolvedName" },
      { type: "address", name: "resolver" },
      { type: "address", name: "reverseResolver" },
    ],
  },
];
const allowedEnsReverseAddresses = new Set(fixtureOwners.map((address) => address.toLowerCase()));

function base32(bytes) {
  const alphabet = "abcdefghijklmnopqrstuvwxyz234567";
  let bits = 0;
  let value = 0;
  let result = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      result += alphabet[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) result += alphabet[(value << (5 - bits)) & 31];
  return result;
}

const metadataDigest = createHash("sha256")
  .update(JSON.stringify(browserProject.metadata))
  .digest();
const computedFixtureCid = `b${base32(
  Buffer.concat([Buffer.from([0x01, 0x55, 0x12, 0x20]), metadataDigest]),
)}`;
if (computedFixtureCid !== fixtureCid) {
  throw new Error(`Fixture metadata CID mismatch: expected ${computedFixtureCid}`);
}

const addressOf = (contract) => getAddress(jbContractAddress[6][contract][chainId]);
const addresses = {
  buybackRegistry: addressOf(JBBuybackHookContracts.JBBuybackHookRegistry),
  controller: addressOf(JBCoreContracts.JBController),
  directory: addressOf(JBCoreContracts.JBDirectory),
  ensUniversalResolver: getAddress(mainnet.contracts.ensUniversalResolver.address),
  fundAccessLimits: addressOf(JBCoreContracts.JBFundAccessLimits),
  multicall: getAddress(mainnet.contracts.multicall3.address),
  projects: addressOf(JBCoreContracts.JBProjects),
  rulesets: addressOf(JBCoreContracts.JBRulesets),
  splits: addressOf(JBCoreContracts.JBSplits),
  terminal: addressOf(JBCoreContracts.JBMultiTerminal),
  terminalStore: addressOf(JBCoreContracts.JBTerminalStore),
  tokens: addressOf(JBCoreContracts.JBTokens),
  revOwner: addressOf(RevnetCoreContracts.REVOwner),
  routerRegistry: addressOf(JBRouterTerminalContracts.JBRouterTerminalRegistry),
  routerTerminal: addressOf(JBRouterTerminalContracts.JBRouterTerminal),
};

const ruleset = {
  cycleNumber: 1n,
  id: 1n,
  basedOnId: 0n,
  start: 1_740_000_000n,
  duration: 31_536_000,
  weight: 1_000_000_000_000_000_000_000_000n,
  weightCutPercent: 50_000_000,
  approvalHook: zeroAddress,
  metadata: 0n,
};
const rulesetMetadata = {
  reservedPercent: 2_000,
  cashOutTaxRate: 1_000,
  baseCurrency: 2,
  pausePay: false,
  pauseCreditTransfers: false,
  allowOwnerMinting: false,
  allowSetCustomToken: false,
  allowTerminalMigration: false,
  allowSetTerminals: false,
  allowSetController: false,
  allowAddAccountingContext: false,
  allowAddPriceFeed: false,
  ownerMustSendPayouts: false,
  holdFees: false,
  scopeCashOutsToLocalBalances: true,
  useDataHookForPay: false,
  useDataHookForCashOut: false,
  dataHook: zeroAddress,
  metadata: 0,
};

const fixtureProject = {
  projectId,
  chainId,
  metadataUri: `ipfs://${fixtureCid}`,
  handle: "fixture-revnet",
  createdAt: 1_740_000_000,
  suckerGroupId,
  logoUri: null,
  name: "Fixture Revnet",
  projectTagline: "A deterministic protocol-backed browser fixture.",
  version: 6,
  token: usdc,
  decimals: 6,
  currency: "2",
  tokenSymbol: "USDC",
  isRevnet: true,
  owner: fixtureOwner,
  permissionHolders: { items: [] },
  suckerGroup: {
    projects: {
      items: [
        { chainId, balance: "1250000000", tokenSupply: "1000000000000000000000000", projectId },
      ],
    },
  },
};
const fixtureSuckerGroup = {
  id: suckerGroupId,
  tokenSupply: "1000000000000000000000000",
  projects: {
    items: [
      {
        balance: "1250000000",
        chainId,
        currency: "2",
        decimals: 6,
        projectId,
        token: usdc,
        tokenSupply: "1000000000000000000000000",
        tokenSymbol: "USDC",
        version: 6,
        suckerGroupId,
      },
    ],
  },
};

const state = {
  graphqlOperations: {},
  graphqlDocuments: {},
  rpcMethods: {},
  contractFunctions: {},
  multicallBatches: 0,
  unknownRequests: [],
};

function increment(record, key) {
  record[key] = (record[key] ?? 0) + 1;
}

function unknown(kind, detail) {
  const entry = { kind, detail, at: new Date().toISOString() };
  state.unknownRequests.push(entry);
  console.error(`[browser-fixture] rejected ${kind}: ${detail}`);
  return new Error(`Unsupported ${kind}: ${detail}`);
}

function requireFixture(condition, message) {
  if (!condition) throw unknown("fixture input", message);
}

const allowedGraphqlDocuments = new Map();

function graphqlDocumentHash(document) {
  return createHash("sha256")
    .update(stripIgnoredCharacters(print(document)))
    .digest("hex");
}

function allowGraphqlSource(source, variants = {}) {
  const parsed = parse(source);
  const fragments = parsed.definitions.filter(
    (definition) => definition.kind === Kind.FRAGMENT_DEFINITION,
  );
  for (const definition of parsed.definitions) {
    if (definition.kind !== Kind.OPERATION_DEFINITION) continue;
    requireFixture(definition.operation === "query", "GraphQL fixture only permits queries");
    requireFixture(definition.name?.value, "GraphQL fixture requires named operations");
    const operation = definition.name.value;
    const document = { kind: Kind.DOCUMENT, definitions: [definition, ...fragments] };
    const hash = graphqlDocumentHash(document);
    allowedGraphqlDocuments.set(hash, {
      hash,
      operation,
      variant: variants[operation] ?? "generated",
    });
  }
}

for (const filename of [
  "activityEvents.graphql",
  "cashOutTaxSnapshots.graphql",
  "participants.graphql",
  "project.graphql",
  "projectCreateEvent.graphql",
  "projectOperator.graphql",
  "projectWithPermissions.graphql",
  "suckerGroup.graphql",
  "suckerGroupMoments.graphql",
  "storeAutoIssueAmountEvents.graphql",
  "storeAutoIssueDistributeEvents.graphql",
  "topSuckerGroups.graphql",
]) {
  allowGraphqlSource(readFileSync(new URL(`../src/graphql/${filename}`, import.meta.url), "utf8"));
}

// The currently published nana-sdk-react release owns a separate Project
// document for its sucker-pair hook. Keep that external boundary explicit so
// a dependency update cannot silently change the shape consumed by Revnet.
allowGraphqlSource(
  `query Project($projectId: Float!, $chainId: Float!, $version: Float!) {
    project(projectId: $projectId, chainId: $chainId, version: $version) {
      projectId
      metadataUri
      handle
      createdAt
      logoUri
      name
      version
      suckerGroupId
      suckerGroup {
        projects {
          items {
            chainId
            balance
            tokenSupply
            projectId
          }
        }
      }
    }
  }`,
  { Project: "sdk-suckers" },
);

allowGraphqlSource(
  `query IndexedBuybackPools($projectId: Int!, $chainId: Int!, $version: Int!) {
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
  { IndexedBuybackPools: "price-history" },
);

allowGraphqlSource(
  `query Projects {
    projects(first: 50, orderBy: projectId, orderDirection: desc) {
      projectId
      handle
      metadataUri
    }
  }`,
  { Projects: "discover" },
);

allowGraphqlSource(
  `query V6ProjectPayers($where: ProjectPayerFilter) {
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
  { V6ProjectPayers: "extras" },
);

allowGraphqlSource(
  `query V6PermissionHolders($where: PermissionHolderFilter) {
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
  { V6PermissionHolders: "operator" },
);

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function requireExactVariables(operation, actual, expected) {
  requireFixture(
    stableJson(actual) === stableJson(expected),
    `${operation} variables=${JSON.stringify(actual)} expected=${JSON.stringify(expected)}`,
  );
}

const graphqlHandlers = {
  Project(variables, descriptor) {
    requireExactVariables(
      "Project",
      variables,
      descriptor.variant === "sdk-suckers"
        ? { chainId, enabled: true, projectId, staleTime: null, version: 6 }
        : { chainId, projectId, version: 6 },
    );
    return { project: fixtureProject };
  },
  ProjectAccountingContext(variables) {
    requireExactVariables("ProjectAccountingContext", variables, {
      chainId,
      projectId,
      version: 6,
    });
    return { project: fixtureProject };
  },
  ProjectOperator(variables) {
    requireExactVariables("ProjectOperator", variables, { chainId, projectId, version: 6 });
    return { permissionHolders: { items: [] } };
  },
  ProjectWithPermissions(variables) {
    requireExactVariables("ProjectWithPermissions", variables, {
      chainId,
      projectId,
      version: 6,
    });
    return { project: fixtureProject };
  },
  SuckerGroup(variables) {
    requireExactVariables("SuckerGroup", variables, { id: suckerGroupId });
    return { suckerGroup: fixtureSuckerGroup };
  },
  Participants(variables) {
    requireFixture(
      variables.where?.suckerGroupId === suckerGroupId && variables.where?.balance_gt === 0,
      `Participants variables=${JSON.stringify(variables)}`,
    );
    requireFixture(
      [undefined, "balance"].includes(variables.orderBy) &&
        [undefined, "desc"].includes(variables.orderDirection) &&
        [undefined, 1000].includes(variables.limit),
      `Participants paging=${JSON.stringify(variables)}`,
    );
    requireFixture(
      Object.keys(variables).every((key) =>
        ["where", "orderBy", "orderDirection", "limit"].includes(key),
      ),
      `Participants unexpected keys=${JSON.stringify(variables)}`,
    );
    return {
      participants: {
        totalCount: 2,
        items: [
          {
            chainId,
            address: fixtureOwner,
            volume: "750000000",
            lastPaidTimestamp: 1_760_000_000,
            balance: "600000000000000000000000",
            erc20Balance: "600000000000000000000000",
            creditBalance: "0",
          },
          {
            chainId,
            address: fixtureParticipant,
            volume: "500000000",
            lastPaidTimestamp: 1_750_000_000,
            balance: "400000000000000000000000",
            erc20Balance: "400000000000000000000000",
            creditBalance: "0",
          },
        ],
      },
    };
  },
  ActivityEvents(variables) {
    requireExactVariables("ActivityEvents", variables, {
      orderBy: "timestamp",
      orderDirection: "desc",
      where: { suckerGroupId },
    });
    return { activityEvents: { items: [] } };
  },
  CashOutTaxSnapshots(variables) {
    requireExactVariables("CashOutTaxSnapshots", variables, { suckerGroupId });
    return {
      cashOutTaxSnapshots: {
        items: [
          {
            cashOutTax: 1_000,
            start: 1_740_000_000,
            duration: 31_536_000,
            rulesetId: "1",
            suckerGroupId,
            version: 6,
          },
        ],
        pageInfo: { hasNextPage: false, endCursor: null },
      },
    };
  },
  SuckerGroupMoments(variables) {
    requireExactVariables("SuckerGroupMoments", variables, { suckerGroupId });
    return {
      suckerGroupMoments: {
        items: [
          {
            timestamp: 1_740_000_000,
            balance: "1000000000",
            tokenSupply: "800000000000000000000000",
            suckerGroupId,
            version: 6,
          },
          {
            timestamp: 1_770_000_000,
            balance: "1250000000",
            tokenSupply: "1000000000000000000000000",
            suckerGroupId,
            version: 6,
          },
        ],
        pageInfo: { hasNextPage: false, endCursor: null },
      },
    };
  },
  StoreAutoIssuanceAmountEvents(variables) {
    requireExactVariables("StoreAutoIssuanceAmountEvents", variables, {
      where: { chainId, projectId, version: 6 },
    });
    return { storeAutoIssuanceAmountEvents: { items: [] } };
  },
  AutoIssueEvents(variables) {
    requireExactVariables("AutoIssueEvents", variables, {
      where: { chainId, projectId, version: 6 },
    });
    return { autoIssueEvents: { items: [] } };
  },
  IndexedBuybackPools(variables) {
    requireExactVariables("IndexedBuybackPools", variables, { projectId, chainId, version: 6 });
    return { buybackPoolEvents: { items: [] } };
  },
  ProjectCreateEvent(variables) {
    requireExactVariables("ProjectCreateEvent", variables, {
      where: { projectId, version: 6 },
    });
    return { projectCreateEvents: { items: [] } };
  },
  TopSuckerGroups(variables) {
    requireExactVariables("TopSuckerGroups", variables, {});
    return {
      suckerGroups: {
        items: [
          {
            balance: "1250000000",
            projects: {
              items: [
                {
                  chainId,
                  currency: "2",
                  decimals: 6,
                  isRevnet: true,
                  logoUri: null,
                  name: browserProject.metadata.name,
                  projectId,
                  projectTagline: browserProject.metadata.projectTagline,
                  tokenSymbol: "USDC",
                },
              ],
            },
          },
        ],
      },
    };
  },
  Projects(variables, descriptor) {
    requireFixture(descriptor.variant === "discover", `Projects variant=${descriptor.variant}`);
    requireExactVariables("Projects", variables, {});
    return {
      projects: [
        {
          projectId: String(projectId),
          handle: fixtureProject.handle,
          metadataUri: fixtureProject.metadataUri,
        },
      ],
    };
  },
  V6ProjectPayers(variables, descriptor) {
    requireFixture(
      descriptor.variant === "extras",
      `V6ProjectPayers variant=${descriptor.variant}`,
    );
    requireExactVariables("V6ProjectPayers", variables, {
      where: { OR: [{ chainId, projectId, version: 6 }] },
    });
    return { projectPayers: { items: [] } };
  },
  V6PermissionHolders(variables, descriptor) {
    requireFixture(
      descriptor.variant === "operator",
      `V6PermissionHolders variant=${descriptor.variant}`,
    );
    const expectedBase = { chainId, projectId, version: 6 };
    const expected = [
      { where: { OR: [expectedBase] } },
      { where: { OR: [{ ...expectedBase, isRevnetOperator: true }] } },
    ];
    requireFixture(
      expected.some((candidate) => stableJson(candidate) === stableJson(variables)),
      `V6PermissionHolders variables=${JSON.stringify(variables)}`,
    );
    return { permissionHolders: { items: [] } };
  },
};

function handleGraphql(body) {
  requireFixture(
    body && typeof body === "object" && !Array.isArray(body),
    "GraphQL body must be an object",
  );
  requireFixture(
    Object.keys(body).every((key) => ["operationName", "query", "variables"].includes(key)),
    `GraphQL envelope keys=${Object.keys(body).join(",")}`,
  );
  requireFixture(typeof body.query === "string", "GraphQL query must be a string");
  let parsed;
  try {
    parsed = parse(body.query);
  } catch {
    throw unknown("GraphQL document", "invalid syntax");
  }
  const operations = parsed.definitions.filter(
    (definition) => definition.kind === Kind.OPERATION_DEFINITION,
  );
  requireFixture(operations.length === 1, `GraphQL operation count=${operations.length}`);
  const operationDefinition = operations[0];
  requireFixture(operationDefinition.operation === "query", "GraphQL mutations are forbidden");
  const operation = operationDefinition.name?.value;
  requireFixture(operation, "GraphQL operation must be named");
  if (body.operationName !== undefined) {
    requireFixture(body.operationName === operation, `GraphQL operationName=${body.operationName}`);
  }
  const hash = graphqlDocumentHash(parsed);
  const descriptor = allowedGraphqlDocuments.get(hash);
  if (!descriptor || descriptor.operation !== operation) {
    throw unknown("GraphQL document", `${operation} sha256=${hash}`);
  }
  const variables = body.variables ?? {};
  requireFixture(
    variables && typeof variables === "object" && !Array.isArray(variables),
    `${operation} variables must be an object`,
  );
  const handler = graphqlHandlers[operation];
  if (!handler) throw unknown("GraphQL operation", String(operation ?? "anonymous"));
  increment(state.graphqlOperations, operation);
  increment(state.graphqlDocuments, hash);
  return handler(variables, descriptor);
}

const registeredCalls = new Map();

function registerCall({ abi, functionName, address, result }) {
  const item = abi.find((entry) => entry.type === "function" && entry.name === functionName);
  if (!item) throw new Error(`Fixture ABI does not contain ${functionName}`);
  const selector = toFunctionSelector(item);
  registeredCalls.set(`${address.toLowerCase()}:${selector}`, {
    abi: [item],
    functionName,
    result,
  });
}

registerCall({
  abi: jbDirectoryAbi,
  functionName: "primaryTerminalOf",
  address: addresses.directory,
  result: ([requestedProjectId, token]) => {
    requireFixture(requestedProjectId === 1n, `primaryTerminalOf projectId=${requestedProjectId}`);
    requireFixture(
      token.toLowerCase() === usdc.toLowerCase() ||
        token.toLowerCase() === nativeToken.toLowerCase(),
      `primaryTerminalOf token=${token}`,
    );
    return token.toLowerCase() === usdc.toLowerCase() ? addresses.terminal : zeroAddress;
  },
});
registerCall({
  abi: jbDirectoryAbi,
  functionName: "controllerOf",
  address: addresses.directory,
  result: ([requestedProjectId]) => {
    requireFixture(requestedProjectId === 1n, `controllerOf projectId=${requestedProjectId}`);
    return addresses.controller;
  },
});
registerCall({
  abi: jbDirectoryAbi,
  functionName: "terminalsOf",
  address: addresses.directory,
  result: ([requestedProjectId]) => {
    requireFixture(requestedProjectId === 1n, `terminalsOf projectId=${requestedProjectId}`);
    return [addresses.terminal];
  },
});
registerCall({
  abi: jbDirectoryAbi,
  functionName: "isTerminalOf",
  address: addresses.directory,
  result: ([requestedProjectId, terminal]) => {
    requireFixture(requestedProjectId === 1n, `isTerminalOf projectId=${requestedProjectId}`);
    requireFixture(
      [addresses.routerRegistry, addresses.routerTerminal].some(
        (candidate) => candidate.toLowerCase() === terminal.toLowerCase(),
      ),
      `isTerminalOf terminal=${terminal}`,
    );
    return false;
  },
});
for (const [functionName, result] of [
  ["FUND_ACCESS_LIMITS", addresses.fundAccessLimits],
  ["RULESETS", addresses.rulesets],
  ["TOKENS", addresses.tokens],
  ["SPLITS", addresses.splits],
]) {
  registerCall({
    abi: jbControllerAbi,
    functionName,
    address: addresses.controller,
    result: () => result,
  });
}
// Nana's contract provider briefly issues these reads against its explicit
// zero-address sentinel while controllerOf is hydrating. They are exact,
// ABI-decoded calls and resolve to the same empty sentinel.
for (const functionName of ["FUND_ACCESS_LIMITS", "RULESETS", "TOKENS", "SPLITS"]) {
  registerCall({
    abi: jbControllerAbi,
    functionName,
    address: zeroAddress,
    result: () => zeroAddress,
  });
}
registerCall({
  abi: jbControllerAbi,
  functionName: "currentRulesetOf",
  address: addresses.controller,
  result: ([requestedProjectId]) => {
    requireFixture(requestedProjectId === 1n, `currentRulesetOf projectId=${requestedProjectId}`);
    return [ruleset, rulesetMetadata];
  },
});
registerCall({
  abi: jbControllerAbi,
  functionName: "getRulesetOf",
  address: addresses.controller,
  result: ([requestedProjectId, rulesetId]) => {
    requireFixture(requestedProjectId === 1n, `getRulesetOf projectId=${requestedProjectId}`);
    requireFixture(rulesetId === ruleset.id, `getRulesetOf rulesetId=${rulesetId}`);
    return [ruleset, rulesetMetadata];
  },
});
registerCall({
  abi: jbControllerAbi,
  functionName: "uriOf",
  address: addresses.controller,
  result: ([requestedProjectId]) => {
    requireFixture(requestedProjectId === 1n, `uriOf projectId=${requestedProjectId}`);
    return `ipfs://${fixtureCid}`;
  },
});
registerCall({
  abi: jbRulesetsAbi,
  functionName: "allOf",
  address: addresses.rulesets,
  result: ([requestedProjectId, startingId, size]) => {
    requireFixture(requestedProjectId === 1n, `allOf projectId=${requestedProjectId}`);
    requireFixture(startingId === 0n && size === 3n, `allOf range=${startingId}:${size}`);
    return [ruleset];
  },
});
registerCall({
  abi: jbSplitsAbi,
  functionName: "splitsOf",
  address: addresses.splits,
  result: ([requestedProjectId, rulesetId]) => {
    requireFixture(requestedProjectId === 1n, `splitsOf projectId=${requestedProjectId}`);
    requireFixture(rulesetId === ruleset.id, `splitsOf rulesetId=${rulesetId}`);
    return [];
  },
});
registerCall({
  abi: jbMultiTerminalAbi,
  functionName: "STORE",
  address: addresses.terminal,
  result: () => addresses.terminalStore,
});
registerCall({
  abi: jbMultiTerminalAbi,
  functionName: "accountingContextsOf",
  address: addresses.terminal,
  result: ([requestedProjectId]) => {
    requireFixture(
      requestedProjectId === 1n,
      `accountingContextsOf projectId=${requestedProjectId}`,
    );
    return [{ token: usdc, decimals: 6, currency: 2 }];
  },
});
registerCall({
  abi: jbTokensAbi,
  functionName: "tokenOf",
  address: addresses.tokens,
  result: ([requestedProjectId]) => {
    requireFixture(requestedProjectId === 1n, `tokenOf projectId=${requestedProjectId}`);
    return projectToken;
  },
});
registerCall({
  abi: jbProjectsAbi,
  functionName: "ownerOf",
  address: addresses.projects,
  result: ([requestedProjectId]) => {
    requireFixture(requestedProjectId === 1n, `ownerOf projectId=${requestedProjectId}`);
    return fixtureProject.owner;
  },
});
registerCall({
  abi: revOwnerAbi,
  functionName: "tiered721HookOf",
  address: addresses.revOwner,
  result: ([requestedProjectId]) => {
    requireFixture(requestedProjectId === 1n, `tiered721HookOf projectId=${requestedProjectId}`);
    return zeroAddress;
  },
});
registerCall({
  abi: revOwnerAbi,
  functionName: "cashOutDelayOf",
  address: addresses.revOwner,
  result: ([requestedProjectId]) => {
    requireFixture(requestedProjectId === 1n, `cashOutDelayOf projectId=${requestedProjectId}`);
    return 0n;
  },
});
registerCall({
  abi: jbTerminalStoreAbi,
  functionName: "currentReclaimableSurplusOf",
  address: addresses.terminalStore,
  result: ([requestedProjectId, cashOutCount, terminals, tokens, decimals, currency]) => {
    requireFixture(
      requestedProjectId === 1n,
      `currentReclaimableSurplusOf projectId=${requestedProjectId}`,
    );
    requireFixture(
      cashOutCount === 975_000_000_000_000_000_000_000n,
      `currentReclaimableSurplusOf cashOutCount=${cashOutCount}`,
    );
    requireFixture(
      terminals.length === 0 && tokens.length === 0,
      "currentReclaimableSurplusOf terminal/token overrides",
    );
    requireFixture(
      decimals === 18n && currency === 2n,
      `currentReclaimableSurplusOf quote=${decimals}:${currency}`,
    );
    return 1_250_000_000_000_000_000_000n;
  },
});
registerCall({
  abi: jbBuybackHookRegistryAbi,
  functionName: "defaultHook",
  address: addresses.buybackRegistry,
  result: () => zeroAddress,
});
registerCall({
  abi: jbRouterTerminalRegistryAbi,
  functionName: "defaultTerminal",
  address: addresses.routerRegistry,
  result: () => zeroAddress,
});
for (const [functionName, result] of [
  ["name", "Fixture Revnet Token"],
  ["symbol", "FREV"],
  ["decimals", 18],
  ["totalSupply", 1_000_000_000_000_000_000_000_000n],
]) {
  registerCall({ abi: erc20Abi, functionName, address: projectToken, result: () => result });
}
for (const [functionName, result] of [
  ["name", "USD Coin"],
  ["symbol", "USDC"],
  ["decimals", 6],
  ["totalSupply", 50_000_000_000_000n],
]) {
  registerCall({ abi: erc20Abi, functionName, address: usdc, result: () => result });
}
registerCall({
  abi: ensReverseAbi,
  functionName: "reverseWithGateways",
  address: addresses.ensUniversalResolver,
  result: ([reverseName, coinType, gateways]) => {
    requireFixture(
      allowedEnsReverseAddresses.has(reverseName.toLowerCase()),
      `ENS reverseName=${reverseName}`,
    );
    requireFixture(coinType === 60n, `ENS coinType=${coinType}`);
    requireFixture(
      gateways.length === 1 && gateways[0] === "x-batch-gateway:true",
      `ENS gateways=${gateways.join(",")}`,
    );
    // An empty name is the universal resolver's canonical "no verified
    // reverse record" result as interpreted by viem.
    return ["", zeroAddress, zeroAddress];
  },
});

function executeContractCall(to, data) {
  const address = getAddress(to);
  if (address === addresses.multicall && data.startsWith(toFunctionSelector(multicall3Abi[0]))) {
    const decoded = decodeFunctionData({ abi: multicall3Abi, data });
    requireFixture(
      decoded.functionName === "aggregate3",
      `multicall function=${decoded.functionName}`,
    );
    state.multicallBatches += 1;
    const calls = decoded.args[0];
    requireFixture(calls.length > 0 && calls.length <= 100, `multicall size=${calls.length}`);
    const results = calls.map(({ target, allowFailure, callData }) => {
      try {
        return { success: true, returnData: executeContractCall(target, callData) };
      } catch (error) {
        if (!allowFailure) throw error;
        return { success: false, returnData: "0x" };
      }
    });
    return encodeFunctionResult({
      abi: multicall3Abi,
      functionName: "aggregate3",
      result: results,
    });
  }

  const selector = data.slice(0, 10);
  const registered = registeredCalls.get(`${address.toLowerCase()}:${selector}`);
  if (!registered) throw unknown("contract call", `${address} selector ${selector}`);
  const decoded = decodeFunctionData({ abi: registered.abi, data });
  increment(state.contractFunctions, registered.functionName);
  const result = registered.result(decoded.args ?? []);
  return encodeFunctionResult({
    abi: registered.abi,
    functionName: registered.functionName,
    result,
  });
}

function handleRpc(request) {
  requireFixture(
    request && typeof request === "object" && !Array.isArray(request),
    "JSON-RPC request must be an object",
  );
  requireFixture(request.jsonrpc === "2.0", `JSON-RPC version=${request.jsonrpc}`);
  requireFixture(
    Object.keys(request).every((key) => ["jsonrpc", "id", "method", "params"].includes(key)),
    `JSON-RPC envelope keys=${Object.keys(request).join(",")}`,
  );
  requireFixture(
    typeof request.id === "number" || typeof request.id === "string",
    `JSON-RPC id=${request.id}`,
  );
  requireFixture(typeof request.method === "string", "JSON-RPC method must be a string");
  const { id, method } = request;
  const params = request.params ?? [];
  requireFixture(Array.isArray(params), `${method} params must be an array`);
  increment(state.rpcMethods, String(method));
  let result;
  if (method === "eth_chainId") {
    requireFixture(params.length === 0, `eth_chainId params=${JSON.stringify(params)}`);
    result = "0x1";
  } else if (method === "net_version") {
    requireFixture(params.length === 0, `net_version params=${JSON.stringify(params)}`);
    result = "1";
  } else if (method === "eth_blockNumber") {
    requireFixture(params.length === 0, `eth_blockNumber params=${JSON.stringify(params)}`);
    result = "0x12d687";
  } else if (method === "eth_call") {
    requireFixture(
      params.length === 2 && params[1] === "latest",
      `eth_call params=${params.length}`,
    );
    const call = params[0];
    requireFixture(
      call &&
        typeof call === "object" &&
        !Array.isArray(call) &&
        typeof call.to === "string" &&
        typeof call.data === "string" &&
        Object.keys(call).every((key) => ["to", "data"].includes(key)),
      "invalid eth_call",
    );
    result = executeContractCall(call.to, call.data);
  } else if (method === "eth_getCode") {
    requireFixture(
      params.length === 2 && params[1] === "latest",
      `eth_getCode params=${JSON.stringify(params)}`,
    );
    const requested = getAddress(params[0]);
    const known =
      requested === projectToken ||
      requested === addresses.multicall ||
      Object.values(addresses).includes(requested);
    requireFixture(known, `eth_getCode address=${requested}`);
    result = "0x60006000";
  } else {
    throw unknown("JSON-RPC method", String(method));
  }
  return { jsonrpc: "2.0", id, result };
}

async function readJson(request) {
  const contentType = request.headers["content-type"] ?? "";
  requireFixture(
    contentType.toLowerCase().startsWith("application/json"),
    `content-type=${contentType}`,
  );
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxBodyBytes) throw unknown("request body", `larger than ${maxBodyBytes} bytes`);
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw unknown("request body", "invalid JSON");
  }
}

function sendJson(response, status, body, cors = false) {
  const encoded = JSON.stringify(body);
  response.writeHead(status, {
    "cache-control": "no-store",
    "content-length": Buffer.byteLength(encoded),
    "content-type": "application/json; charset=utf-8",
    ...(cors
      ? {
          "access-control-allow-headers": "content-type",
          "access-control-allow-methods": "POST, OPTIONS",
          "access-control-allow-origin": appOrigin,
        }
      : {}),
  });
  response.end(encoded);
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", `http://${host}:${port}`);
  const isApi = url.pathname === "/graphql" || url.pathname === "/rpc";
  try {
    if (request.method === "GET" && url.pathname === "/healthz") {
      sendJson(response, 200, { status: "ok", fixture: "revnet-browser-v1" });
      return;
    }
    if (request.method === "GET" && url.pathname === "/__fixture/status") {
      sendJson(response, 200, state, true);
      return;
    }
    if (request.method === "OPTIONS" && isApi) {
      response.writeHead(204, {
        "access-control-allow-headers": "content-type",
        "access-control-allow-methods": "POST, OPTIONS",
        "access-control-allow-origin": appOrigin,
      });
      response.end();
      return;
    }
    if (request.method === "POST" && url.pathname === "/graphql") {
      sendJson(response, 200, { data: handleGraphql(await readJson(request)) }, true);
      return;
    }
    if (request.method === "POST" && url.pathname === "/rpc") {
      const body = await readJson(request);
      requireFixture(
        !Array.isArray(body) || (body.length > 0 && body.length <= 100),
        "invalid RPC batch",
      );
      const result = Array.isArray(body) ? body.map(handleRpc) : handleRpc(body);
      sendJson(response, 200, result, true);
      return;
    }
    throw unknown("HTTP request", `${request.method} ${url.pathname}`);
  } catch (error) {
    sendJson(
      response,
      400,
      { error: error instanceof Error ? error.message : "Fixture request failed" },
      isApi,
    );
  }
});

server.listen(port, host, () => {
  console.log(`[browser-fixture] listening on http://${host}:${port}`);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
