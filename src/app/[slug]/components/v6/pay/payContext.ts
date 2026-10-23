import { formatPayAmount, type V6PayMode } from "@/lib/v6/pay";
import { JB_CHAINS, type JBChainId } from "@bananapus/nana-sdk-core";
import { PAY_QUOTE_FAILED_MESSAGE } from "@bananapus/nana-sdk-core/v6";

/** What a payment sends and gets, as its progress and its one review show it. */
export function payContext(
  prepared: {
    mode: V6PayMode;
    amount: bigint;
    token: { symbol: string; decimals: number };
    chainId: number;
    minReturned: bigint;
    quoteFailed: boolean;
    cartRows: { quantity: number; name: string }[];
    memo: string;
  },
  projectTokenSymbol: string,
): { label: string; value: string; strong?: boolean; note?: string }[] {
  return [
    {
      label: "Send",
      value: `${formatPayAmount(prepared.amount, prepared.token.decimals)} ${prepared.token.symbol}`,
      strong: true,
    },
    {
      label: "On",
      value: JB_CHAINS[prepared.chainId as JBChainId]?.name ?? String(prepared.chainId),
    },
    prepared.mode === "pay"
      ? {
          label: "You get at least",
          value: `${formatPayAmount(prepared.minReturned, 18)} ${projectTokenSymbol}`,
          ...(prepared.quoteFailed ? { note: PAY_QUOTE_FAILED_MESSAGE } : {}),
        }
      : { label: "Effect", value: "Adds money to the project without giving you tokens." },
    ...(prepared.cartRows.length
      ? [
          {
            label: "Items",
            value: prepared.cartRows.map((row) => `${row.quantity}× ${row.name}`).join(", "),
          },
        ]
      : []),
    ...(prepared.memo ? [{ label: "Note", value: prepared.memo }] : []),
  ];
}
