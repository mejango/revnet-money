import { isNativePayToken } from "@/lib/v6/pay";
import { JBChainId } from "@bananapus/nana-sdk-core";
import {
  buildUniswapV4ExactInputSwapTx,
  chooseBestCashOutRoute,
  chooseBestPayRoute,
  quoteUniswapV4ExactInputSingle,
  uniswapV4Deployment,
  uniswapV4SwapDirection,
  type CashOutRoute,
  type PayPreview,
  type UniswapV4PoolKey,
} from "@bananapus/nana-sdk-core/v6";
import {
  decodeFunctionResult,
  encodeAbiParameters,
  encodeFunctionData,
  encodePacked,
  zeroAddress,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";

export const PERMIT2_ADDRESS: Address = "0x000000000022D473030F116dDEE9F6B43aC78BA3";

const SUPPORTED_CHAINS: readonly JBChainId[] = [1, 10, 8453, 42161, 84532, 421614, 11155111];

export const UNIVERSAL_ROUTER_BY_CHAIN: Readonly<Partial<Record<JBChainId, Address>>> =
  Object.fromEntries(
    SUPPORTED_CHAINS.flatMap((chainId) => {
      const router = uniswapV4Deployment(chainId)?.universalRouter;
      return router ? [[chainId, router]] : [];
    }),
  );

export const permit2Abi = [
  {
    type: "function",
    name: "allowance",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "token", type: "address" },
      { name: "spender", type: "address" },
    ],
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

export const PERMIT2_TYPES = {
  PermitDetails: [
    { name: "token", type: "address" },
    { name: "amount", type: "uint160" },
    { name: "expiration", type: "uint48" },
    { name: "nonce", type: "uint48" },
  ],
  PermitSingle: [
    { name: "details", type: "PermitDetails" },
    { name: "spender", type: "address" },
    { name: "sigDeadline", type: "uint256" },
  ],
} as const;

export type Permit2SignatureAuthorization = {
  chainId: JBChainId;
  token: Address;
  spender: Address;
  amount: bigint;
  expiration: number;
  nonce: number;
  sigDeadline: bigint;
};

export function permit2TypedData(authorization: Permit2SignatureAuthorization) {
  return {
    domain: {
      name: "Permit2" as const,
      chainId: authorization.chainId,
      verifyingContract: PERMIT2_ADDRESS,
    },
    types: PERMIT2_TYPES,
    primaryType: "PermitSingle" as const,
    message: {
      details: {
        token: authorization.token,
        amount: authorization.amount,
        expiration: authorization.expiration,
        nonce: authorization.nonce,
      },
      spender: authorization.spender,
      sigDeadline: authorization.sigDeadline,
    },
  };
}

export interface DirectSwapQuote {
  kind: "direct-swap";
  poolKey: UniswapV4PoolKey;
  zeroForOne: boolean;
  quotedTokenCount: bigint;
  beneficiaryTokenCount: bigint;
  reservedTokenCount: 0n;
  inputRoute:
    | { kind: "single-v4" }
    | {
        kind: "native-v3-v4";
        wrappedNative: Address;
        bridgeToken: Address;
        bridgeTokenSymbol: "USDC";
        bridgeTokenDecimals: 6;
        v3Fee: number;
        quotedBridgeAmount: bigint;
      }
    | {
        kind: "erc20-v3-native-v4";
        inputToken: Address;
        wrappedNative: Address;
        bridgeTokenSymbol: "ETH";
        bridgeTokenDecimals: 18;
        v3Fee: number;
        quotedBridgeAmount: bigint;
      };
}

type NativeSwapConfig = {
  wrappedNative: Address;
  bridgeToken: Address;
  v3Quoter: Address;
};

export const NATIVE_SWAP_BY_CHAIN: Readonly<
  Partial<Record<JBChainId, NativeSwapConfig>>
> = {
  1: {
    wrappedNative: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
    bridgeToken: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
    v3Quoter: "0x61fFE014bA17989E743c5F6cB21bF9697530B21e",
  },
  10: {
    wrappedNative: "0x4200000000000000000000000000000000000006",
    bridgeToken: "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85",
    v3Quoter: "0x61fFE014bA17989E743c5F6cB21bF9697530B21e",
  },
  8453: {
    wrappedNative: "0x4200000000000000000000000000000000000006",
    bridgeToken: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    v3Quoter: "0x3d4e44Eb1374240CE5F1B871ab261CD16335B76a",
  },
  42161: {
    wrappedNative: "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1",
    bridgeToken: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
    v3Quoter: "0x61fFE014bA17989E743c5F6cB21bF9697530B21e",
  },
};
const V3_FEES = [100, 500, 3_000, 10_000] as const;
const ADDRESS_THIS = "0x0000000000000000000000000000000000000002" as Address;
const CONTRACT_BALANCE = 1n << 255n;
const UINT128_MAX = (1n << 128n) - 1n;

const v3QuoterAbi = [
  {
    type: "function",
    name: "quoteExactInputSingle",
    stateMutability: "nonpayable",
    inputs: [
      {
        name: "params",
        type: "tuple",
        components: [
          { name: "tokenIn", type: "address" },
          { name: "tokenOut", type: "address" },
          { name: "amountIn", type: "uint256" },
          { name: "fee", type: "uint24" },
          { name: "sqrtPriceLimitX96", type: "uint160" },
        ],
      },
    ],
    outputs: [
      { name: "amountOut", type: "uint256" },
      { name: "sqrtPriceX96After", type: "uint160" },
      { name: "initializedTicksCrossed", type: "uint32" },
      { name: "gasEstimate", type: "uint256" },
    ],
  },
] as const;

const universalRouterAbi = [
  {
    type: "function",
    name: "execute",
    stateMutability: "payable",
    inputs: [
      { name: "commands", type: "bytes" },
      { name: "inputs", type: "bytes[]" },
      { name: "deadline", type: "uint256" },
    ],
    outputs: [],
  },
] as const;

async function quoteV3ExactInput({
  client,
  config,
  tokenIn,
  tokenOut,
  amountIn,
}: {
  client: PublicClient;
  config: NativeSwapConfig;
  tokenIn: Address;
  tokenOut: Address;
  amountIn: bigint;
}) {
  const quotes = await Promise.all(
    V3_FEES.map(async (fee) => {
      try {
        const call = await client.call({
          to: config.v3Quoter,
          data: encodeFunctionData({
            abi: v3QuoterAbi,
            functionName: "quoteExactInputSingle",
            args: [
              {
                tokenIn,
                tokenOut,
                amountIn,
                fee,
                sqrtPriceLimitX96: 0n,
              },
            ],
          }),
        });
        if (!call.data) return null;
        const [amountOut] = decodeFunctionResult({
          abi: v3QuoterAbi,
          functionName: "quoteExactInputSingle",
          data: call.data,
        });
        return amountOut > 0n ? { fee, amountOut } : null;
      } catch {
        return null;
      }
    }),
  );
  return quotes.reduce<NonNullable<(typeof quotes)[number]> | null>(
    (best, quote) => (!quote || (best && best.amountOut >= quote.amountOut) ? best : quote),
    null,
  );
}

export interface DirectSellQuote {
  poolKey: UniswapV4PoolKey;
  zeroForOne: boolean;
  quotedOutput: bigint;
  minimumOutput: bigint;
}

/** Select a claimed-token pool sale only when its protected minimum beats
 * the hook-aware terminal cash-out output. Internal credits stay on the
 * terminal route because the Universal Router cannot pull them. */
export async function quoteDirectSellSwap({
  client,
  chainId,
  poolKey,
  projectToken,
  tokenToReclaim,
  amount,
  cashOutRoute,
  slippageBps,
}: {
  client: PublicClient;
  chainId: JBChainId;
  poolKey: UniswapV4PoolKey;
  projectToken: Address;
  tokenToReclaim: Address;
  amount: bigint;
  cashOutRoute: CashOutRoute;
  slippageBps: number;
}): Promise<DirectSellQuote | null> {
  if (
    !uniswapV4Deployment(chainId)?.universalRouter ||
    amount <= 0n ||
    slippageBps < 0 ||
    slippageBps > 10_000
  )
    return null;
  const zeroForOne = uniswapV4SwapDirection({
    poolKey,
    tokenIn: projectToken,
    tokenOut: tokenToReclaim,
  });
  if (zeroForOne === null) return null;
  const quotedOutput = await quoteUniswapV4ExactInputSingle(client, {
    chainId,
    poolKey,
    zeroForOne,
    amountIn: amount,
  });
  const best = chooseBestCashOutRoute({
    cashOut: cashOutRoute,
    directSwapQuote: quotedOutput,
    directSwapPoolKey: poolKey,
    directSwapZeroForOne: zeroForOne,
    spendableProjectTokenCount: amount,
    cashOutCount: amount,
    slippageBps: BigInt(slippageBps),
  });
  if (best.kind !== "direct-swap") return null;
  return {
    poolKey: best.poolKey,
    zeroForOne: best.zeroForOne,
    quotedOutput: best.expectedReturn,
    minimumOutput: best.minimumReturn,
  };
}

export function buildDirectSellSwapTx({
  chainId,
  quote,
  amount,
  recipient,
  deadline,
}: {
  chainId: JBChainId;
  quote: DirectSellQuote;
  amount: bigint;
  recipient: Address;
  deadline: bigint;
}) {
  return buildUniswapV4ExactInputSwapTx({
    chainId,
    poolKey: quote.poolKey,
    zeroForOne: quote.zeroForOne,
    amountIn: amount,
    minimumAmountOut: quote.minimumOutput,
    recipient,
    deadline,
  });
}

export async function quoteDirectPaySwap({
  client,
  chainId,
  poolKey,
  pairIsCurrency0,
  paymentToken,
  amount,
  payPreview,
}: {
  client: PublicClient;
  chainId: JBChainId;
  poolKey: UniswapV4PoolKey;
  pairIsCurrency0: boolean;
  paymentToken: Address;
  amount: bigint;
  payPreview: PayPreview;
}): Promise<DirectSwapQuote | null> {
  if (!uniswapV4Deployment(chainId)?.universalRouter || amount <= 0n) return null;
  const currencyIn = pairIsCurrency0 ? poolKey.currency0 : poolKey.currency1;
  const normalizedPayment = isNativePayToken(paymentToken)
    ? zeroAddress
    : paymentToken.toLowerCase();
  let v4AmountIn = amount;
  let inputRoute: DirectSwapQuote["inputRoute"] = { kind: "single-v4" };

  if (currencyIn.toLowerCase() !== normalizedPayment) {
    const config = NATIVE_SWAP_BY_CHAIN[chainId];
    const canBridgeNative =
      !!config &&
      isNativePayToken(paymentToken) &&
      currencyIn.toLowerCase() === config.bridgeToken.toLowerCase();
    const canBridgeUsdcToNative =
      !!config &&
      paymentToken.toLowerCase() === config.bridgeToken.toLowerCase() &&
      currencyIn.toLowerCase() === zeroAddress;
    if (!config || (!canBridgeNative && !canBridgeUsdcToNative)) return null;
    const bridgeQuote = await quoteV3ExactInput({
      client,
      config,
      tokenIn: canBridgeNative ? config.wrappedNative : config.bridgeToken,
      tokenOut: canBridgeNative ? config.bridgeToken : config.wrappedNative,
      amountIn: amount,
    });
    if (!bridgeQuote) return null;
    v4AmountIn = bridgeQuote.amountOut;
    inputRoute = canBridgeNative
      ? {
          kind: "native-v3-v4",
          wrappedNative: config.wrappedNative,
          bridgeToken: config.bridgeToken,
          bridgeTokenSymbol: "USDC",
          bridgeTokenDecimals: 6,
          v3Fee: bridgeQuote.fee,
          quotedBridgeAmount: bridgeQuote.amountOut,
        }
      : {
          kind: "erc20-v3-native-v4",
          inputToken: config.bridgeToken,
          wrappedNative: config.wrappedNative,
          bridgeTokenSymbol: "ETH",
          bridgeTokenDecimals: 18,
          v3Fee: bridgeQuote.fee,
          quotedBridgeAmount: bridgeQuote.amountOut,
        };
  }

  const quotedTokenCount = await quoteUniswapV4ExactInputSingle(client, {
    chainId,
    poolKey,
    zeroForOne: pairIsCurrency0,
    amountIn: v4AmountIn,
  });
  const route = chooseBestPayRoute({
    pay: payPreview,
    paySettlement: "issuance",
    directSwapQuote: quotedTokenCount,
  });
  if (route.kind !== "direct-swap") return null;
  return {
    kind: "direct-swap",
    poolKey,
    zeroForOne: pairIsCurrency0,
    quotedTokenCount,
    beneficiaryTokenCount: route.beneficiaryTokenCount,
    reservedTokenCount: 0n,
    inputRoute,
  };
}

function encodeV4SwapFromRouterBalance({
  quote,
  recipient,
  currencyIn,
}: {
  quote: DirectSwapQuote;
  recipient: Address;
  currencyIn: Address;
}) {
  const swap = encodeAbiParameters(
    [
      {
        type: "tuple",
        components: [
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
          { type: "bool" },
          { type: "uint128" },
          { type: "uint128" },
          { type: "bytes" },
        ],
      },
    ],
    [
      [
        [
          quote.poolKey.currency0,
          quote.poolKey.currency1,
          quote.poolKey.fee,
          quote.poolKey.tickSpacing,
          quote.poolKey.hooks,
        ],
        quote.zeroForOne,
        0n,
        quote.beneficiaryTokenCount,
        "0x",
      ],
    ],
  );
  const settle = encodeAbiParameters(
    [{ type: "address" }, { type: "uint256" }, { type: "bool" }],
    [currencyIn, CONTRACT_BALANCE, false],
  );
  const currencyOut = quote.zeroForOne ? quote.poolKey.currency1 : quote.poolKey.currency0;
  const take = encodeAbiParameters(
    [{ type: "address" }, { type: "address" }, { type: "uint256" }],
    [currencyOut, recipient, 0n],
  );
  return encodeAbiParameters(
    [{ type: "bytes" }, { type: "bytes[]" }],
    ["0x0b060e", [settle, swap, take]],
  );
}

export function buildDirectPaySwapTx({
  chainId,
  quote,
  amount,
  recipient,
  deadline,
}: {
  chainId: JBChainId;
  quote: DirectSwapQuote;
  amount: bigint;
  recipient: Address;
  deadline: bigint;
}) {
  if (quote.inputRoute.kind === "erc20-v3-native-v4") {
    const config = NATIVE_SWAP_BY_CHAIN[chainId];
    if (
      !config ||
      quote.inputRoute.inputToken.toLowerCase() !== config.bridgeToken.toLowerCase() ||
      quote.inputRoute.wrappedNative.toLowerCase() !== config.wrappedNative.toLowerCase()
    ) {
      throw new Error("This ERC-20 bridge route is not supported on this chain.");
    }
    if (amount <= 0n || amount > UINT128_MAX || quote.beneficiaryTokenCount <= 0n) {
      throw new Error("Swap amounts are outside the supported range.");
    }
    const router = UNIVERSAL_ROUTER_BY_CHAIN[chainId];
    if (!router) throw new Error("No supported Uniswap Universal Router on this chain.");
    const v3Input = encodeAbiParameters(
      [
        { type: "address" },
        { type: "uint256" },
        { type: "uint256" },
        { type: "bytes" },
        { type: "bool" },
      ],
      [
        ADDRESS_THIS,
        amount,
        0n,
        encodePacked(
          ["address", "uint24", "address"],
          [quote.inputRoute.inputToken, quote.inputRoute.v3Fee, quote.inputRoute.wrappedNative],
        ),
        true,
      ],
    );
    const unwrapInput = encodeAbiParameters(
      [{ type: "address" }, { type: "uint256" }],
      [ADDRESS_THIS, 0n],
    );
    const v4Input = encodeV4SwapFromRouterBalance({
      quote,
      recipient,
      currencyIn: zeroAddress,
    });
    return {
      chainId,
      address: router,
      abi: universalRouterAbi,
      functionName: "execute" as const,
      args: ["0x000c10" as Hex, [v3Input, unwrapInput, v4Input], deadline] as const,
      value: 0n,
    };
  }
  if (quote.inputRoute.kind === "native-v3-v4") {
    const config = NATIVE_SWAP_BY_CHAIN[chainId];
    if (
      !config ||
      quote.inputRoute.bridgeToken.toLowerCase() !== config.bridgeToken.toLowerCase() ||
      quote.inputRoute.wrappedNative.toLowerCase() !== config.wrappedNative.toLowerCase()
    ) {
      throw new Error("This native bridge route is not supported on this chain.");
    }
    if (amount <= 0n || amount > UINT128_MAX || quote.beneficiaryTokenCount <= 0n) {
      throw new Error("Swap amounts are outside the supported range.");
    }
    const router = UNIVERSAL_ROUTER_BY_CHAIN[chainId];
    if (!router) throw new Error("No supported Uniswap Universal Router on this chain.");

    const wrapInput = encodeAbiParameters(
      [{ type: "address" }, { type: "uint256" }],
      [ADDRESS_THIS, amount],
    );
    const v3Input = encodeAbiParameters(
      [
        { type: "address" },
        { type: "uint256" },
        { type: "uint256" },
        { type: "bytes" },
        { type: "bool" },
      ],
      [
        ADDRESS_THIS,
        amount,
        0n,
        encodePacked(
          ["address", "uint24", "address"],
          [quote.inputRoute.wrappedNative, quote.inputRoute.v3Fee, quote.inputRoute.bridgeToken],
        ),
        false,
      ],
    );
    // Pre-fund PoolManager with every USDC produced by the V3 hop, consume that
    // full open credit in the hooked pool, then take all project tokens.
    const v4Input = encodeV4SwapFromRouterBalance({
      quote,
      recipient,
      currencyIn: quote.inputRoute.bridgeToken,
    });
    return {
      chainId,
      address: router,
      abi: universalRouterAbi,
      functionName: "execute" as const,
      args: ["0x0b0010" as Hex, [wrapInput, v3Input, v4Input], deadline] as const,
      value: amount,
    };
  }
  return buildUniswapV4ExactInputSwapTx({
    chainId,
    poolKey: quote.poolKey,
    zeroForOne: quote.zeroForOne,
    amountIn: amount,
    minimumAmountOut: quote.beneficiaryTokenCount,
    recipient,
    deadline,
  });
}

/** Prepend Universal Router's PERMIT2_PERMIT command to an exact V4 swap. */
export function addPermit2SignatureToDirectPaySwap(
  request: ReturnType<typeof buildDirectPaySwapTx>,
  authorization: Permit2SignatureAuthorization,
  signature: Hex,
): ReturnType<typeof buildDirectPaySwapTx> {
  if (request.address.toLowerCase() !== authorization.spender.toLowerCase()) {
    throw new Error("The reviewed Permit2 authorization does not match the swap.");
  }
  const [commands, inputs, deadline] = request.args;
  const commandShape = commands.toLowerCase();
  const supportedShape =
    (commandShape === "0x10" && inputs.length === 1) ||
    (commandShape === "0x000c10" && inputs.length === 3);
  if (!supportedShape) {
    throw new Error("The reviewed swap has an unsupported Universal Router shape.");
  }
  const permitInput = encodeAbiParameters(
    [
      {
        type: "tuple",
        components: [
          {
            type: "tuple",
            components: [
              { type: "address" },
              { type: "uint160" },
              { type: "uint48" },
              { type: "uint48" },
            ],
          },
          { type: "address" },
          { type: "uint256" },
        ],
      },
      { type: "bytes" },
    ],
    [
      [
        [authorization.token, authorization.amount, authorization.expiration, authorization.nonce],
        authorization.spender,
        authorization.sigDeadline,
      ],
      signature,
    ],
  );
  return {
    ...request,
    args: [`0x0a${commands.slice(2)}` as Hex, [permitInput, ...inputs], deadline],
  };
}

/** Fall back only for wallets that cannot sign Permit2 typed data, never rejection. */
export function permit2SignatureNeedsOnchainFallback(error: unknown): boolean {
  const messages: string[] = [];
  let current: unknown = error;
  for (let depth = 0; current && depth < 5; depth += 1) {
    if (typeof current !== "object") break;
    const value = current as Record<string, unknown>;
    for (const key of ["code", "shortMessage", "message", "details"]) {
      if (value[key] !== undefined) messages.push(String(value[key]));
    }
    current = value.cause;
  }
  const text = messages.join(" ").toLowerCase();
  if (/user rejected|rejected the request|denied|4001/.test(text)) return false;
  return /(^|\s)-32602(\s|$)|(^|\s)-32601(\s|$)|(^|\s)4200(\s|$)|invalid parameters|method .*not supported|unsupported method|typed data.*not supported/.test(
    text,
  );
}

export async function needsPermit2Approval({
  client,
  chainId,
  owner,
  token,
  amount,
}: {
  client: PublicClient;
  chainId: JBChainId;
  owner: Address;
  token: Address;
  amount: bigint;
}): Promise<boolean> {
  if (isNativePayToken(token)) return false;
  const router = uniswapV4Deployment(chainId)?.universalRouter;
  if (!router) return false;
  const [allowance, expiration] = await client.readContract({
    address: PERMIT2_ADDRESS,
    abi: permit2Abi,
    functionName: "allowance",
    args: [owner, token, router],
  });
  return allowance < amount || expiration <= Math.floor(Date.now() / 1000) + 1_800;
}
