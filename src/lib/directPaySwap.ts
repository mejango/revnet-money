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
import { zeroAddress, type Address, type PublicClient } from "viem";

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

export interface DirectSwapQuote {
  kind: "direct-swap";
  poolKey: UniswapV4PoolKey;
  zeroForOne: boolean;
  quotedTokenCount: bigint;
  beneficiaryTokenCount: bigint;
  reservedTokenCount: 0n;
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
  if (currencyIn.toLowerCase() !== normalizedPayment) return null;

  const quotedTokenCount = await quoteUniswapV4ExactInputSingle(client, {
    chainId,
    poolKey,
    zeroForOne: pairIsCurrency0,
    amountIn: amount,
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
  };
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
