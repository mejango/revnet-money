import { getViemPublicClient } from "@/lib/wagmiTransports";
import {
  JBBuybackHookContracts,
  jbBuybackHookRegistryAbi,
  JBChainId,
  jbContractAddress,
  jbControllerAbi,
  JBCoreContracts,
  jbDirectoryAbi,
  jbOmnichainDeployerAbi,
  JBOmnichainDeployerContracts,
  jbSplitsAbi,
  NATIVE_TOKEN,
  RevnetCoreContracts,
} from "@bananapus/nana-sdk-core";
import {
  getAccountingContexts,
  UNISWAP_V4_INITIALIZE_TOPIC,
  UNISWAP_V4_MODIFY_LIQUIDITY_TOPIC,
  UNISWAP_V4_POOL_MANAGER_ADDRESSES,
  UNISWAP_V4_POSITION_MANAGER_ADDRESSES,
  uniswapV4AmountsForLiquidity,
  uniswapV4PoolId,
  uniswapV4PoolStateSlot,
  uniswapV4PositionTicks,
  uniswapV4PositionTokenIdFromLog,
  uniswapV4PriceFromSqrtPriceX96,
  uniswapV4SqrtPriceX96AtTick,
  uniswapV4SqrtPriceX96FromSlot0,
  type UniswapV4PoolKey,
} from "@bananapus/nana-sdk-core/v6";
import {
  Address,
  encodeAbiParameters,
  erc20Abi,
  Hex,
  parseAbiItem,
  PublicClient,
  zeroAddress,
} from "viem";
import { ChainProject } from "../settlement/lib";

// ── Uniswap V4 singletons (from deploy-all-v6 Deploy.s.sol) ──────────────────

export const POOL_MANAGER_BY_CHAIN = UNISWAP_V4_POOL_MANAGER_ADDRESSES as Readonly<
  Partial<Record<number, Address>>
>;
export const POSITION_MANAGER_BY_CHAIN = UNISWAP_V4_POSITION_MANAGER_ADDRESSES as Readonly<
  Partial<Record<number, Address>>
>;

const POOL_KEY_OF_ABI = [
  {
    type: "function",
    name: "poolKeyOf",
    stateMutability: "view",
    inputs: [
      { name: "projectId", type: "uint256" },
      { name: "terminalToken", type: "address" },
    ],
    outputs: [
      {
        name: "key",
        type: "tuple",
        components: [
          { name: "currency0", type: "address" },
          { name: "currency1", type: "address" },
          { name: "fee", type: "uint24" },
          { name: "tickSpacing", type: "int24" },
          { name: "hooks", type: "address" },
        ],
      },
    ],
  },
] as const;

const EXTSLOAD_ABI = [
  {
    type: "function",
    name: "extsload",
    stateMutability: "view",
    inputs: [{ name: "slot", type: "bytes32" }],
    outputs: [{ type: "bytes32" }],
  },
] as const;

export const POSITION_MANAGER_ABI = [
  {
    type: "function",
    name: "positionInfo",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "getPoolAndPositionInfo",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [
      {
        name: "poolKey",
        type: "tuple",
        components: [
          { name: "currency0", type: "address" },
          { name: "currency1", type: "address" },
          { name: "fee", type: "uint24" },
          { name: "tickSpacing", type: "int24" },
          { name: "hooks", type: "address" },
        ],
      },
      { name: "info", type: "uint256" },
    ],
  },
  {
    type: "function",
    name: "getPositionLiquidity",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [{ type: "uint128" }],
  },
  {
    type: "function",
    name: "ownerOf",
    stateMutability: "view",
    inputs: [{ name: "id", type: "uint256" }],
    outputs: [{ name: "owner", type: "address" }],
  },
  {
    type: "function",
    name: "modifyLiquidities",
    stateMutability: "payable",
    inputs: [
      { name: "unlockData", type: "bytes" },
      { name: "deadline", type: "uint256" },
    ],
    outputs: [],
  },
] as const;

export type PoolKey = UniswapV4PoolKey;

// ── Buyback hook resolution ───────────────────────────────────────────────────

function v6Address(contract: string, chainId: JBChainId): Address | null {
  const byChain = (jbContractAddress[6] as Record<string, Record<string, string>>)[contract];
  return (byChain?.[String(chainId)] as Address | undefined) ?? null;
}

interface DataHookInfo {
  dataHook: Address;
  rulesetId: bigint;
  weight: bigint;
}

/** The project's current ruleset data hook + id + weight, controller resolved from the directory. */
async function projectDataHook(
  client: PublicClient,
  chainId: JBChainId,
  projectId: bigint,
): Promise<DataHookInfo | null> {
  const directory = jbContractAddress[6][JBCoreContracts.JBDirectory][chainId] as Address;
  const controller = await client.readContract({
    address: directory,
    abi: jbDirectoryAbi,
    functionName: "controllerOf",
    args: [projectId],
  });
  if (!controller || controller === zeroAddress) return null;
  const [ruleset, metadata] = await client.readContract({
    address: controller,
    abi: jbControllerAbi,
    functionName: "currentRulesetOf",
    args: [projectId],
  });
  return { dataHook: metadata.dataHook, rulesetId: BigInt(ruleset.id), weight: ruleset.weight };
}

/**
 * The project's ACTUAL buyback hook, or null when it has no buyback pool.
 * Recognizes the ruleset data hook against the known singleton wrappers — the
 * defaulting hookOf/terminal getters must NOT be trusted for a project that
 * doesn't route through the registry (they return a default → wrong pool):
 * REVOwner / JBBuybackHookRegistry → registry.hookOf(projectId);
 * JBOmnichainDeployer → unwrap extraDataHookOf and recognize that;
 * the concrete JBBuybackHook wired directly → itself; anything else → null.
 */
export async function projectBuybackHook(
  client: PublicClient,
  chainId: JBChainId,
  projectId: bigint,
): Promise<{ hook: Address | null; info: DataHookInfo | null }> {
  const info = await projectDataHook(client, chainId, projectId).catch(() => null);
  if (!info || info.dataHook === zeroAddress) return { hook: null, info };

  const registry = v6Address(JBBuybackHookContracts.JBBuybackHookRegistry, chainId);
  const revOwner = v6Address(RevnetCoreContracts.REVOwner, chainId);
  const omni = v6Address(JBOmnichainDeployerContracts.JBOmnichainDeployer, chainId);
  const concrete = v6Address(JBBuybackHookContracts.JBBuybackHook, chainId);
  const lc = (a: string | null) => (a ?? "").toLowerCase();

  const recognize = async (dataHook: Address): Promise<Address | null> => {
    const d = dataHook.toLowerCase();
    if (registry && (d === lc(registry) || d === lc(revOwner))) {
      try {
        const hook = await client.readContract({
          address: registry,
          abi: jbBuybackHookRegistryAbi,
          functionName: "hookOf",
          args: [projectId],
        });
        return hook && hook !== zeroAddress ? hook : null;
      } catch {
        return null;
      }
    }
    if (concrete && d === lc(concrete)) return dataHook;
    return null;
  };

  let hook = await recognize(info.dataHook);
  if (!hook && omni && info.dataHook.toLowerCase() === lc(omni)) {
    // The omnichain deployer inserts ITSELF as the data hook and stores the real one.
    try {
      const extra = await client.readContract({
        address: omni,
        abi: jbOmnichainDeployerAbi,
        functionName: "extraDataHookOf",
        args: [projectId, info.rulesetId],
      });
      if (extra.dataHook && extra.dataHook !== zeroAddress) hook = await recognize(extra.dataHook);
    } catch {
      hook = null;
    }
  }
  return { hook, info };
}

// ── Pool state ────────────────────────────────────────────────────────────────

export interface PairToken {
  /** Pool-currency form: native ETH = zero address, else the ERC-20. */
  addr: Address;
  decimals: number;
  symbol: string;
}

export interface PoolSnapshot {
  chainId: JBChainId;
  hook: Address;
  key: PoolKey;
  poolId: Hex;
  sqrtP: bigint;
  pair: PairToken;
  pairIsC0: boolean;
  /** Human pair-token per project token. */
  price: number | null;
  poolManager: Address;
}

async function pairTokenFor(
  client: PublicClient,
  chainId: JBChainId,
  projectId: bigint,
): Promise<PairToken | null> {
  const contexts = await getAccountingContexts(client, { chainId, projectId }).catch(() => null);
  const primary = contexts?.[0];
  if (!primary) return null;
  const native =
    primary.token.toLowerCase() === NATIVE_TOKEN.toLowerCase() || primary.token === zeroAddress;
  let symbol = "ETH";
  if (!native) {
    symbol = await client
      .readContract({ address: primary.token, abi: erc20Abi, functionName: "symbol" })
      .catch(() => "tokens");
  }
  return {
    addr: native ? zeroAddress : (primary.token.toLowerCase() as Address),
    decimals: primary.decimals,
    symbol,
  };
}

/**
 * The buyback pool's key + live price. The hook keys its pool by
 * (projectId, terminalToken) — pass the project's actual PAIR/accounting token,
 * never a hardcoded native 0x0, or a USDC pool is never found.
 */
export async function readPoolSnapshot(
  chainId: JBChainId,
  projectId: bigint,
): Promise<{ hook: Address | null; pool: PoolSnapshot | null }> {
  const client = getViemPublicClient(chainId) as PublicClient;
  const poolManager = POOL_MANAGER_BY_CHAIN[Number(chainId)];
  const { hook } = await projectBuybackHook(client, chainId, projectId);
  if (!hook || !poolManager) return { hook: hook ?? null, pool: null };

  const pair = await pairTokenFor(client, chainId, projectId);
  if (!pair) return { hook, pool: null };

  let key: PoolKey;
  try {
    key = (await client.readContract({
      address: hook,
      abi: POOL_KEY_OF_ABI,
      functionName: "poolKeyOf",
      args: [projectId, pair.addr],
    })) as PoolKey;
  } catch {
    return { hook, pool: null };
  }
  const c0 = key.currency0.toLowerCase();
  const c1 = key.currency1.toLowerCase();
  if (c0 === zeroAddress && c1 === zeroAddress) return { hook, pool: null };

  const poolId = uniswapV4PoolId(key);
  const stateSlot = uniswapV4PoolStateSlot(poolId);
  let sqrtP = 0n;
  try {
    const slot0 = await client.readContract({
      address: poolManager,
      abi: EXTSLOAD_ABI,
      functionName: "extsload",
      args: [stateSlot],
    });
    sqrtP = uniswapV4SqrtPriceX96FromSlot0(slot0);
  } catch {
    return { hook, pool: null };
  }
  if (sqrtP === 0n) return { hook, pool: null };

  const pairIsC0 = c0 === pair.addr.toLowerCase();
  const price = uniswapV4PriceFromSqrtPriceX96(sqrtP, pairIsC0, pair.decimals);

  return {
    hook,
    pool: {
      chainId,
      hook,
      key,
      poolId,
      sqrtP,
      pair,
      pairIsC0,
      price,
      poolManager,
    },
  };
}

// ── Pool composition via net ModifyLiquidity deltas ───────────────────────────

const INIT_EVENT = parseAbiItem(
  "event Initialize(bytes32 indexed id, address indexed currency0, address indexed currency1, uint24 fee, int24 tickSpacing, address hooks, uint160 sqrtPriceX96, int24 tick)",
);
const MODIFY_EVENT = parseAbiItem(
  "event ModifyLiquidity(bytes32 indexed id, address indexed sender, int24 tickLower, int24 tickUpper, int256 liquidityDelta, bytes32 salt)",
);

const SCAN_WINDOW = 45_000n;
const SCAN_BATCH = 6;
const SCAN_MAX_WINDOWS = 80; // ~3.6M blocks back before giving up

export interface PoolComposition {
  /** Exact pool reserves at the current price (fees excluded). */
  pairAmount: bigint;
  tokenAmount: bigint;
}

const compositionCache = new Map<string, { block: bigint; value: PoolComposition }>();

/**
 * The pool's current reserves, reconstructed by netting every ModifyLiquidity
 * delta per tick range (all senders — composition covers the whole pool) back to
 * the pool's Initialize event, then valuing each surviving range at the current
 * price. Null when the RPC can't return the complete history.
 */
export async function fetchPoolComposition(pool: PoolSnapshot): Promise<PoolComposition | null> {
  const client = getViemPublicClient(pool.chainId) as PublicClient;
  const cacheKey = `${pool.chainId}:${pool.poolId}`;
  const latest = await client.getBlockNumber();
  const cached = compositionCache.get(cacheKey);
  // A pool's history only grows; reuse a snapshot taken within the last ~30 blocks.
  if (cached && latest - cached.block < 30n) return cached.value;

  const ranges = new Map<string, { tickLower: number; tickUpper: number; liquidity: bigint }>();
  let initFound = false;
  let cursor = latest;
  let windows = 0;

  while (!initFound && cursor >= 0n && windows < SCAN_MAX_WINDOWS) {
    const spans: { lo: bigint; hi: bigint }[] = [];
    for (let n = 0; n < SCAN_BATCH && cursor >= 0n && windows < SCAN_MAX_WINDOWS; n++) {
      const hi = cursor;
      const lo = hi >= SCAN_WINDOW ? hi - SCAN_WINDOW + 1n : 0n;
      spans.push({ lo, hi });
      cursor = lo === 0n ? -1n : lo - 1n;
      windows++;
    }
    const results = await Promise.all(
      spans.map(async (s) => {
        const [inits, mods] = await Promise.all([
          client.getLogs({
            address: pool.poolManager,
            event: INIT_EVENT,
            args: { id: pool.poolId },
            fromBlock: s.lo,
            toBlock: s.hi,
          }),
          client.getLogs({
            address: pool.poolManager,
            event: MODIFY_EVENT,
            args: { id: pool.poolId },
            fromBlock: s.lo,
            toBlock: s.hi,
          }),
        ]);
        return { inits, mods };
      }),
    );
    for (const r of results) {
      if (r.inits.length > 0) initFound = true;
      for (const log of r.mods) {
        const tickLower = Number(log.args.tickLower);
        const tickUpper = Number(log.args.tickUpper);
        const delta = log.args.liquidityDelta ?? 0n;
        const key = `${tickLower}:${tickUpper}`;
        const entry = ranges.get(key) ?? { tickLower, tickUpper, liquidity: 0n };
        entry.liquidity += delta;
        ranges.set(key, entry);
      }
    }
  }
  if (!initFound) return null; // incomplete history — never show an invented composition

  let amount0 = 0n;
  let amount1 = 0n;
  for (const r of ranges.values()) {
    if (r.liquidity <= 0n) continue;
    const amounts = uniswapV4AmountsForLiquidity(
      pool.sqrtP,
      uniswapV4SqrtPriceX96AtTick(r.tickLower),
      uniswapV4SqrtPriceX96AtTick(r.tickUpper),
      r.liquidity,
    );
    amount0 += amounts.amount0;
    amount1 += amounts.amount1;
  }
  const value: PoolComposition = {
    pairAmount: pool.pairIsC0 ? amount0 : amount1,
    tokenAmount: pool.pairIsC0 ? amount1 : amount0,
  };
  compositionCache.set(cacheKey, { block: latest, value });
  return value;
}

// ── Wallet LP positions + full-exit removal ─────────────────────────────────

type RawPoolLog = {
  topics?: readonly (string | null)[];
  data?: string;
  blockNumber?: bigint | string | number;
};

export interface UserLpPosition {
  tokenId: bigint;
  owner: Address;
  info: bigint;
  liquidity: bigint;
  tickLower: number;
  tickUpper: number;
  pairAmount: bigint;
  tokenAmount: bigint;
}

export interface RemoveLiquidityPlan {
  unlockData: Hex;
  deadline: bigint;
  pairMinimum: bigint;
  tokenMinimum: bigint;
}

async function rawPoolLogs(
  client: PublicClient,
  pool: PoolSnapshot,
  fromBlock: bigint,
  toBlock: bigint,
): Promise<RawPoolLog[]> {
  return (await client.request({
    method: "eth_getLogs",
    params: [
      {
        address: pool.poolManager,
        topics: [[UNISWAP_V4_INITIALIZE_TOPIC, UNISWAP_V4_MODIFY_LIQUIDITY_TOPIC], pool.poolId],
        fromBlock: `0x${fromBlock.toString(16)}`,
        toBlock: `0x${toBlock.toString(16)}`,
      },
    ],
  } as never)) as RawPoolLog[];
}

/**
 * Enumerate every canonical PositionManager NFT in this pool. A capped or
 * failed history is rejected: silently omitting an owned position would make
 * the management surface incorrect.
 */
async function poolPositionTokenIds(
  client: PublicClient,
  pool: PoolSnapshot,
  positionManager: Address,
): Promise<bigint[]> {
  const latest = await client.getBlockNumber();
  const ids = new Map<string, bigint>();
  let cursor = latest;
  let initialized = false;
  for (let window = 0; window < SCAN_MAX_WINDOWS && cursor >= 0n; window += 1) {
    const fromBlock = cursor >= SCAN_WINDOW ? cursor - SCAN_WINDOW + 1n : 0n;
    const logs = await rawPoolLogs(client, pool, fromBlock, cursor);
    for (const log of logs) {
      const topic = String(log.topics?.[0] ?? "").toLowerCase();
      if (topic === UNISWAP_V4_INITIALIZE_TOPIC.toLowerCase()) initialized = true;
      const tokenId = uniswapV4PositionTokenIdFromLog(log, positionManager);
      if (tokenId != null) ids.set(tokenId.toString(), tokenId);
    }
    if (initialized) break;
    if (fromBlock === 0n) break;
    cursor = fromBlock - 1n;
  }
  if (!initialized) throw new Error("Could not verify the complete LP position history.");
  return [...ids.values()].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

async function positionFor(
  client: PublicClient,
  pool: PoolSnapshot,
  positionManager: Address,
  tokenId: bigint,
): Promise<UserLpPosition | null> {
  const [info, liquidity, owner] = await Promise.all([
    client.readContract({
      address: positionManager,
      abi: POSITION_MANAGER_ABI,
      functionName: "positionInfo",
      args: [tokenId],
    }),
    client.readContract({
      address: positionManager,
      abi: POSITION_MANAGER_ABI,
      functionName: "getPositionLiquidity",
      args: [tokenId],
    }),
    client
      .readContract({
        address: positionManager,
        abi: POSITION_MANAGER_ABI,
        functionName: "ownerOf",
        args: [tokenId],
      })
      .catch(() => null),
  ]);
  if (!owner || info === 0n || liquidity === 0n) return null;
  const [key, verifiedInfo] = await client.readContract({
    address: positionManager,
    abi: POSITION_MANAGER_ABI,
    functionName: "getPoolAndPositionInfo",
    args: [tokenId],
  });
  if (verifiedInfo !== info || uniswapV4PoolId(key).toLowerCase() !== pool.poolId.toLowerCase()) {
    throw new Error("PositionManager returned inconsistent pool data.");
  }
  const ticks = uniswapV4PositionTicks(info);
  const amounts = uniswapV4AmountsForLiquidity(
    pool.sqrtP,
    uniswapV4SqrtPriceX96AtTick(ticks.lower),
    uniswapV4SqrtPriceX96AtTick(ticks.upper),
    liquidity,
  );
  return {
    tokenId,
    owner,
    info,
    liquidity,
    tickLower: ticks.lower,
    tickUpper: ticks.upper,
    pairAmount: pool.pairIsC0 ? amounts.amount0 : amounts.amount1,
    tokenAmount: pool.pairIsC0 ? amounts.amount1 : amounts.amount0,
  };
}

export async function readUserLpPositions(
  pool: PoolSnapshot,
  account: Address,
): Promise<UserLpPosition[]> {
  const positionManager = POSITION_MANAGER_BY_CHAIN[Number(pool.chainId)];
  if (!positionManager) return [];
  const client = getViemPublicClient(pool.chainId) as PublicClient;
  const ids = await poolPositionTokenIds(client, pool, positionManager);
  const positions = await Promise.all(
    ids.map((tokenId) => positionFor(client, pool, positionManager, tokenId)),
  );
  return positions.filter(
    (position): position is UserLpPosition =>
      position != null && position.owner.toLowerCase() === account.toLowerCase(),
  );
}

export async function refreshUserLpPosition(
  pool: PoolSnapshot,
  tokenId: bigint,
  account: Address,
): Promise<UserLpPosition> {
  const positionManager = POSITION_MANAGER_BY_CHAIN[Number(pool.chainId)];
  if (!positionManager) throw new Error("LP management is unavailable on this chain.");
  // Refresh slot0 directly while the pool identity is re-verified by
  // getPoolAndPositionInfo below.
  const client = getViemPublicClient(pool.chainId) as PublicClient;
  const slot0 = await client.readContract({
    address: pool.poolManager,
    abi: EXTSLOAD_ABI,
    functionName: "extsload",
    args: [uniswapV4PoolStateSlot(pool.poolId)],
  });
  const refreshedPool = {
    ...pool,
    sqrtP: uniswapV4SqrtPriceX96FromSlot0(slot0),
  };
  const position = await positionFor(client, refreshedPool, positionManager, tokenId);
  if (!position || position.owner.toLowerCase() !== account.toLowerCase()) {
    throw new Error("The connected wallet no longer owns this LP position.");
  }
  return position;
}

function retainedFloor(value: bigint): bigint {
  if (value <= 0n) return 0n;
  const floor = (value * 9_500n) / 10_000n;
  return floor > 0n ? floor : 1n;
}

export function prepareRemoveLiquidity(
  pool: PoolSnapshot,
  position: UserLpPosition,
  recipient: Address,
  nowSeconds = Math.floor(Date.now() / 1000),
): RemoveLiquidityPlan {
  const pairMinimum = retainedFloor(position.pairAmount);
  const tokenMinimum = retainedFloor(position.tokenAmount);
  const amount0Minimum = pool.pairIsC0 ? pairMinimum : tokenMinimum;
  const amount1Minimum = pool.pairIsC0 ? tokenMinimum : pairMinimum;
  const burn = encodeAbiParameters(
    [{ type: "uint256" }, { type: "uint128" }, { type: "uint128" }, { type: "bytes" }],
    [position.tokenId, amount0Minimum, amount1Minimum, "0x"],
  );
  const takePair = encodeAbiParameters(
    [{ type: "address" }, { type: "address" }, { type: "address" }],
    [pool.key.currency0, pool.key.currency1, recipient],
  );
  return {
    unlockData: encodeAbiParameters(
      [{ type: "bytes" }, { type: "bytes[]" }],
      ["0x0311", [burn, takePair]],
    ),
    deadline: BigInt(nowSeconds + 1_200),
    pairMinimum,
    tokenMinimum,
  };
}

// ── AMM card aggregate ────────────────────────────────────────────────────────

export interface AmmChainState {
  chainId: JBChainId;
  hook: Address | null;
  pool: PoolSnapshot | null;
  composition: PoolComposition | null;
}

export async function fetchAmmStates(chains: ChainProject[]): Promise<AmmChainState[]> {
  return Promise.all(
    chains.map(async ({ chainId, projectId }): Promise<AmmChainState> => {
      try {
        const { hook, pool } = await readPoolSnapshot(chainId, projectId);
        const composition = pool ? await fetchPoolComposition(pool).catch(() => null) : null;
        return { chainId, hook, pool, composition };
      } catch {
        return { chainId, hook: null, pool: null, composition: null };
      }
    }),
  );
}

// ── LP split hook (JBP6FeeLPSplitHook / JBUniswapV4LPSplitHook) ───────────────

export const lpSplitHookAbi = [
  {
    type: "function",
    name: "initialWeightOf",
    stateMutability: "view",
    inputs: [{ name: "projectId", type: "uint256" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "accumulatedProjectTokens",
    stateMutability: "view",
    inputs: [{ name: "projectId", type: "uint256" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "hasDeployedPool",
    stateMutability: "view",
    inputs: [{ name: "projectId", type: "uint256" }],
    outputs: [{ type: "bool" }],
  },
  {
    type: "function",
    name: "claimableFeeTokens",
    stateMutability: "view",
    inputs: [{ name: "projectId", type: "uint256" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "tokenIdOf",
    stateMutability: "view",
    inputs: [
      { name: "projectId", type: "uint256" },
      { name: "terminalToken", type: "address" },
    ],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "activeTickLowerOf",
    stateMutability: "view",
    inputs: [
      { name: "projectId", type: "uint256" },
      { name: "terminalToken", type: "address" },
    ],
    outputs: [{ type: "int24" }],
  },
  {
    type: "function",
    name: "activeTickUpperOf",
    stateMutability: "view",
    inputs: [
      { name: "projectId", type: "uint256" },
      { name: "terminalToken", type: "address" },
    ],
    outputs: [{ type: "int24" }],
  },
  {
    type: "function",
    name: "deployPool",
    stateMutability: "nonpayable",
    inputs: [
      { name: "projectId", type: "uint256" },
      { name: "minCashOutReturn", type: "uint256" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "collectAndRouteLPFees",
    stateMutability: "nonpayable",
    inputs: [
      { name: "projectId", type: "uint256" },
      { name: "terminalToken", type: "address" },
    ],
    outputs: [],
  },
  // Custom errors so a reverting simulate decodes to the real reason.
  {
    type: "error",
    name: "JBUniswapV4LPSplitHook_ZeroLiquidity",
    inputs: [
      { name: "amount0", type: "uint256" },
      { name: "amount1", type: "uint256" },
    ],
  },
  {
    type: "error",
    name: "JBUniswapV4LPSplitHook_InsufficientLiquidity",
    inputs: [{ name: "liquidity", type: "uint128" }],
  },
  {
    type: "error",
    name: "JBUniswapV4LPSplitHook_InsufficientBalance",
    inputs: [
      { name: "available", type: "uint256" },
      { name: "required", type: "uint256" },
    ],
  },
  {
    type: "error",
    name: "JBUniswapV4LPSplitHook_NoTokensAccumulated",
    inputs: [{ name: "projectId", type: "uint256" }],
  },
  {
    type: "error",
    name: "JBUniswapV4LPSplitHook_PoolAlreadyDeployed",
    inputs: [
      { name: "projectId", type: "uint256" },
      { name: "terminalToken", type: "address" },
      { name: "tokenId", type: "uint256" },
    ],
  },
  {
    type: "error",
    name: "JBUniswapV4LPSplitHook_OnlyOneTerminalTokenSupported",
    inputs: [
      { name: "projectId", type: "uint256" },
      { name: "terminalToken", type: "address" },
    ],
  },
  {
    type: "error",
    name: "JBUniswapV4LPSplitHook_InvalidStageForAction",
    inputs: [
      { name: "projectId", type: "uint256" },
      { name: "terminalToken", type: "address" },
      { name: "tokenId", type: "uint256" },
    ],
  },
  {
    type: "error",
    name: "JBUniswapV4LPSplitHook_TwapUnavailable",
    inputs: [
      { name: "projectId", type: "uint256" },
      { name: "terminalToken", type: "address" },
    ],
  },
  {
    type: "error",
    name: "JBUniswapV4LPSplitHook_PriceDeviationTooHigh",
    inputs: [
      { name: "spotTick", type: "int24" },
      { name: "twapTick", type: "int24" },
      { name: "maxDeviationTicks", type: "int24" },
    ],
  },
  {
    type: "error",
    name: "JBUniswapV4LPSplitHook_InvalidTerminalToken",
    inputs: [
      { name: "projectId", type: "uint256" },
      { name: "terminalToken", type: "address" },
    ],
  },
] as const;

/** Reserved-token split group id (JBSplitGroupIds.RESERVED_TOKENS). */
const RESERVED_SPLIT_GROUP = 1n;

export interface SplitHookChainState {
  chainId: JBChainId;
  projectId: bigint;
  hook: Address;
  /** The project's terminal/pair token in accounting form (NATIVE sentinel kept). */
  terminalToken: Address;
  pairSymbol: string;
  pairDecimals: number;
  accumulated: bigint;
  hasPool: boolean;
  claimableFees: bigint;
  tokenId: bigint;
  tickLower: number | null;
  tickUpper: number | null;
  /**
   * True while deployPool still needs the operator (SET_BUYBACK_POOL): it only
   * becomes permissionless once the issuance rate decays to ≤10% of what it was
   * when tokens started accumulating.
   */
  deployGated: boolean;
}

/**
 * Detects an LP split hook by behavior, not by a hardcoded address: any reserved
 * split whose hook answers both `accumulatedProjectTokens` and `hasDeployedPool`
 * is treated as the LP split hook (the canonical deployment is not in the SDK's
 * address book). Returns one state per chain where a hook is found.
 */
export async function fetchSplitHookStates(chains: ChainProject[]): Promise<SplitHookChainState[]> {
  const states = await Promise.all(
    chains.map(async ({ chainId, projectId }): Promise<SplitHookChainState | null> => {
      try {
        const client = getViemPublicClient(chainId) as PublicClient;
        const info = await projectDataHook(client, chainId, projectId);
        if (!info) return null;
        const splitsAddr = jbContractAddress[6][JBCoreContracts.JBSplits][chainId] as Address;
        const splits = await client.readContract({
          address: splitsAddr,
          abi: jbSplitsAbi,
          functionName: "splitsOf",
          args: [projectId, info.rulesetId, RESERVED_SPLIT_GROUP],
        });
        const candidates = [
          ...new Set(
            splits
              .map((s) => s.hook)
              .filter((h): h is Address => !!h && h !== zeroAddress)
              .map((h) => h.toLowerCase() as Address),
          ),
        ];
        let hook: Address | null = null;
        for (const candidate of candidates) {
          try {
            await Promise.all([
              client.readContract({
                address: candidate,
                abi: lpSplitHookAbi,
                functionName: "accumulatedProjectTokens",
                args: [projectId],
              }),
              client.readContract({
                address: candidate,
                abi: lpSplitHookAbi,
                functionName: "hasDeployedPool",
                args: [projectId],
              }),
            ]);
            hook = candidate;
            break;
          } catch {
            // Not the LP split hook — a 721 hook or custom split hook lands here.
          }
        }
        if (!hook) return null;

        const contexts = await getAccountingContexts(client, { chainId, projectId });
        const primary = contexts[0];
        if (!primary) return null;
        const native =
          primary.token.toLowerCase() === NATIVE_TOKEN.toLowerCase() ||
          primary.token === zeroAddress;
        const pairSymbol = native
          ? "ETH"
          : await client
              .readContract({ address: primary.token, abi: erc20Abi, functionName: "symbol" })
              .catch(() => "tokens");

        const rd = <T>(p: Promise<T>): Promise<T | null> => p.catch(() => null);
        const [accumulated, hasPool, fees, initialWeight, tokenId, tickLower, tickUpper] =
          await Promise.all([
            rd(
              client.readContract({
                address: hook,
                abi: lpSplitHookAbi,
                functionName: "accumulatedProjectTokens",
                args: [projectId],
              }),
            ),
            rd(
              client.readContract({
                address: hook,
                abi: lpSplitHookAbi,
                functionName: "hasDeployedPool",
                args: [projectId],
              }),
            ),
            rd(
              client.readContract({
                address: hook,
                abi: lpSplitHookAbi,
                functionName: "claimableFeeTokens",
                args: [projectId],
              }),
            ),
            rd(
              client.readContract({
                address: hook,
                abi: lpSplitHookAbi,
                functionName: "initialWeightOf",
                args: [projectId],
              }),
            ),
            rd(
              client.readContract({
                address: hook,
                abi: lpSplitHookAbi,
                functionName: "tokenIdOf",
                args: [projectId, primary.token],
              }),
            ),
            rd(
              client.readContract({
                address: hook,
                abi: lpSplitHookAbi,
                functionName: "activeTickLowerOf",
                args: [projectId, primary.token],
              }),
            ),
            rd(
              client.readContract({
                address: hook,
                abi: lpSplitHookAbi,
                functionName: "activeTickUpperOf",
                args: [projectId, primary.token],
              }),
            ),
          ]);

        const iw = initialWeight ?? 0n;
        return {
          chainId,
          projectId,
          hook,
          terminalToken: primary.token,
          pairSymbol,
          pairDecimals: primary.decimals,
          accumulated: accumulated ?? 0n,
          hasPool: !!hasPool,
          claimableFees: fees ?? 0n,
          tokenId: tokenId ?? 0n,
          tickLower: tickLower ?? null,
          tickUpper: tickUpper ?? null,
          deployGated: iw === 0n || info.weight * 10n > iw,
        };
      } catch {
        return null;
      }
    }),
  );
  return states.filter((s): s is SplitHookChainState => s !== null);
}
