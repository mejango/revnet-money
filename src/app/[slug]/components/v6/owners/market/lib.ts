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
  UNISWAP_PERMIT2_ADDRESS,
  UNISWAP_V4_INITIALIZE_TOPIC,
  UNISWAP_V4_MAX_TICK,
  UNISWAP_V4_MODIFY_LIQUIDITY_TOPIC,
  UNISWAP_V4_POOL_MANAGER_ADDRESSES,
  UNISWAP_V4_POSITION_MANAGER_ADDRESSES,
  uniswapV4AlignTickDown,
  uniswapV4AlignTickUp,
  uniswapV4AmountsForLiquidity,
  uniswapV4LiquidityForAmounts,
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
  encodeFunctionData,
  erc20Abi,
  Hex,
  parseAbiItem,
  PublicClient,
  zeroAddress,
} from "viem";
import { ChainProject } from "../settlement/lib";

// ── Uniswap V4 singletons (from deploy-all-v6 Deploy.s.sol) ──────────────────

const POOL_MANAGER_BY_CHAIN = UNISWAP_V4_POOL_MANAGER_ADDRESSES as Readonly<
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

type PoolKey = UniswapV4PoolKey;

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
async function projectBuybackHook(
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

interface PairToken {
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
  projectToken: Address;
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
  const projectToken = (pairIsC0 ? key.currency1 : key.currency0) as Address;
  if (projectToken === zeroAddress || projectToken.toLowerCase() === pair.addr.toLowerCase()) {
    return { hook, pool: null };
  }
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
      projectToken,
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

interface PoolComposition {
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
async function fetchPoolComposition(pool: PoolSnapshot): Promise<PoolComposition | null> {
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

// ── Add liquidity ────────────────────────────────────────────────────────────

const ACTION_MINT_POSITION = "02";
const ACTION_CLOSE_CURRENCY = "12";
const ACTION_SWEEP = "14";

export const PERMIT2_ADDRESS = UNISWAP_PERMIT2_ADDRESS;
export const PERMIT2_ABI = [
  {
    type: "function",
    name: "allowance",
    stateMutability: "view",
    inputs: [{ type: "address" }, { type: "address" }, { type: "address" }],
    outputs: [
      { name: "amount", type: "uint160" },
      { name: "expiration", type: "uint48" },
      { name: "nonce", type: "uint48" },
    ],
  },
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "token", type: "address" },
      { name: "spender", type: "address" },
      { name: "amount", type: "uint160" },
      { name: "expiration", type: "uint48" },
    ],
    outputs: [],
  },
] as const;

export interface AddLiquidityPlan {
  poolId: Hex;
  unlockData: Hex;
  tickLower: number;
  tickUpper: number;
  liquidity: bigint;
  amount0Max: bigint;
  amount1Max: bigint;
  pairMaximum: bigint;
  tokenMaximum: bigint;
  value: bigint;
  erc20Sides: Array<{ currency: Address; max: bigint }>;
  recipient: Address;
}

/**
 * Build a reviewed V4 MINT_POSITION plan. The position can be two-sided or
 * single-sided; maxima include 1% price headroom and unused native value is
 * swept back to the recipient.
 */
export function prepareAddLiquidity(
  pool: PoolSnapshot,
  amounts: { pairAmount: bigint; tokenAmount: bigint },
  range: { minimumPrice: number; maximumPrice: number },
  recipient: Address,
): AddLiquidityPlan {
  if (!(range.minimumPrice > 0) || !(range.maximumPrice > range.minimumPrice)) {
    throw new Error("Set a valid positive price range.");
  }
  const amount0 = pool.pairIsC0 ? amounts.pairAmount : amounts.tokenAmount;
  const amount1 = pool.pairIsC0 ? amounts.tokenAmount : amounts.pairAmount;
  if (amount0 <= 0n && amount1 <= 0n) throw new Error("Enter an amount.");

  const spacing = Number(pool.key.tickSpacing);
  const maxUsable = Math.trunc(UNISWAP_V4_MAX_TICK / spacing) * spacing;
  const minUsable = Math.trunc(-UNISWAP_V4_MAX_TICK / spacing) * spacing;
  const rawPrice = (price: number) =>
    pool.pairIsC0
      ? 10 ** (18 - pool.pair.decimals) / price
      : price * 10 ** (pool.pair.decimals - 18);
  const tickA = Math.log(rawPrice(range.minimumPrice)) / Math.log(1.0001);
  const tickB = Math.log(rawPrice(range.maximumPrice)) / Math.log(1.0001);
  let tickLower = Math.max(
    minUsable,
    uniswapV4AlignTickDown(Math.floor(Math.min(tickA, tickB)), spacing),
  );
  let tickUpper = Math.min(
    maxUsable,
    uniswapV4AlignTickUp(Math.ceil(Math.max(tickA, tickB)), spacing),
  );
  if (tickUpper <= tickLower) tickUpper = Math.min(maxUsable, tickLower + spacing);

  const currentTick = Math.floor((2 * Math.log(Number(pool.sqrtP) / 2 ** 96)) / Math.log(1.0001));
  if (amount1 <= 0n && amount0 > 0n && currentTick >= tickLower) {
    tickLower = Math.min(maxUsable, uniswapV4AlignTickUp(currentTick + 1, spacing));
  }
  if (amount0 <= 0n && amount1 > 0n && currentTick < tickUpper) {
    tickUpper = Math.max(minUsable, uniswapV4AlignTickDown(currentTick, spacing));
  }
  if (tickUpper <= tickLower) tickUpper = Math.min(maxUsable, tickLower + spacing);

  const sqrtA = uniswapV4SqrtPriceX96AtTick(tickLower);
  const sqrtB = uniswapV4SqrtPriceX96AtTick(tickUpper);
  const liquidity = uniswapV4LiquidityForAmounts(pool.sqrtP, sqrtA, sqrtB, amount0, amount1);
  if (liquidity <= 0n) throw new Error("Amounts are too small for this range.");
  const required = uniswapV4AmountsForLiquidity(pool.sqrtP, sqrtA, sqrtB, liquidity);
  const amount0Max = required.amount0 + required.amount0 / 100n + 1n;
  const amount1Max = required.amount1 + required.amount1 / 100n + 1n;
  const nativeIsC0 = pool.pairIsC0 && pool.pair.addr === zeroAddress;
  const nativeIsC1 = !pool.pairIsC0 && pool.pair.addr === zeroAddress;
  const value = nativeIsC0 ? amount0Max : nativeIsC1 ? amount1Max : 0n;
  const erc20Sides: Array<{ currency: Address; max: bigint }> = [];
  if (!nativeIsC0 && amount0Max > 1n) {
    erc20Sides.push({ currency: pool.key.currency0, max: amount0Max });
  }
  if (!nativeIsC1 && amount1Max > 1n) {
    erc20Sides.push({ currency: pool.key.currency1, max: amount1Max });
  }

  const mint = encodeAbiParameters(
    [
      {
        type: "tuple",
        components: [
          { type: "address" },
          { type: "address" },
          { type: "uint24" },
          { type: "int24" },
          { type: "address" },
        ],
      },
      { type: "int24" },
      { type: "int24" },
      { type: "uint256" },
      { type: "uint128" },
      { type: "uint128" },
      { type: "address" },
      { type: "bytes" },
    ],
    [
      [pool.key.currency0, pool.key.currency1, pool.key.fee, pool.key.tickSpacing, pool.key.hooks],
      tickLower,
      tickUpper,
      liquidity,
      amount0Max,
      amount1Max,
      recipient,
      "0x",
    ],
  );
  const close0 = encodeAbiParameters([{ type: "address" }], [pool.key.currency0]);
  const close1 = encodeAbiParameters([{ type: "address" }], [pool.key.currency1]);
  const parameters: Hex[] = [mint, close0, close1];
  let actions = `0x${ACTION_MINT_POSITION}${ACTION_CLOSE_CURRENCY}${ACTION_CLOSE_CURRENCY}` as Hex;
  if (value > 0n) {
    parameters.push(
      encodeAbiParameters([{ type: "address" }, { type: "address" }], [pool.pair.addr, recipient]),
    );
    actions =
      `0x${ACTION_MINT_POSITION}${ACTION_CLOSE_CURRENCY}${ACTION_CLOSE_CURRENCY}${ACTION_SWEEP}` as Hex;
  }

  return {
    poolId: pool.poolId,
    unlockData: encodeAbiParameters(
      [{ type: "bytes" }, { type: "bytes[]" }],
      [actions, parameters],
    ),
    tickLower,
    tickUpper,
    liquidity,
    amount0Max,
    amount1Max,
    pairMaximum: pool.pairIsC0 ? amount0Max : amount1Max,
    tokenMaximum: pool.pairIsC0 ? amount1Max : amount0Max,
    value,
    erc20Sides,
    recipient,
  };
}

export async function permit2AllowanceCovers(
  chainId: JBChainId,
  owner: Address,
  token: Address,
  amount: bigint,
): Promise<boolean> {
  const positionManager = POSITION_MANAGER_BY_CHAIN[Number(chainId)];
  if (!positionManager) return false;
  const [allowed, expiration] = await getViemPublicClient(chainId).readContract({
    address: PERMIT2_ADDRESS,
    abi: PERMIT2_ABI,
    functionName: "allowance",
    args: [owner, token, positionManager],
  });
  return BigInt(allowed) >= amount && Number(expiration) > Math.floor(Date.now() / 1000) + 300;
}

export function permit2ApprovalArgs(
  chainId: JBChainId,
  token: Address,
  amount: bigint,
  nowSeconds = Math.floor(Date.now() / 1000),
) {
  const positionManager = POSITION_MANAGER_BY_CHAIN[Number(chainId)];
  if (!positionManager) throw new Error("LP management is unavailable on this chain.");
  return [token, positionManager, amount, nowSeconds + 30 * 24 * 60 * 60] as const;
}

/** Abort a reviewed mint when the live price moved beyond its 1% maxima. */
export async function reverifyAddLiquidity(
  pool: PoolSnapshot,
  plan: AddLiquidityPlan,
): Promise<void> {
  const client = getViemPublicClient(pool.chainId) as PublicClient;
  const slot0 = await client.readContract({
    address: pool.poolManager,
    abi: EXTSLOAD_ABI,
    functionName: "extsload",
    args: [uniswapV4PoolStateSlot(plan.poolId)],
  });
  const sqrtP = uniswapV4SqrtPriceX96FromSlot0(slot0);
  const required = uniswapV4AmountsForLiquidity(
    sqrtP,
    uniswapV4SqrtPriceX96AtTick(plan.tickLower),
    uniswapV4SqrtPriceX96AtTick(plan.tickUpper),
    plan.liquidity,
  );
  if (required.amount0 > plan.amount0Max || required.amount1 > plan.amount1Max) {
    throw new Error("The pool price moved beyond the reviewed range. Review fresh amounts.");
  }
}

export function encodeAddLiquidityCall(
  plan: AddLiquidityPlan,
  deadline = BigInt(Math.floor(Date.now() / 1000) + 1_200),
) {
  return {
    args: [plan.unlockData, deadline] as const,
    data: encodeFunctionData({
      abi: POSITION_MANAGER_ABI,
      functionName: "modifyLiquidities",
      args: [plan.unlockData, deadline],
    }),
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
