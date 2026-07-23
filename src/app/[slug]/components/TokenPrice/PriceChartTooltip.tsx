import type { ChartTooltipSeries } from "@/components/ui/chart";
import { formatClock, formatShortDate } from "@/lib/date";
import { formatDecimals } from "@/lib/number";
import { TimeRange } from "@/lib/timeRange";
import { JB_TOKEN_DECIMALS } from "@bananapus/nana-sdk-core";
import { formatUnits } from "viem";

type PriceTooltipDatum = {
  timestamp: number;
  totalSupply?: string;
  totalBalance?: string;
  cashOutTaxRate?: number;
};

interface Props {
  datum: PriceTooltipDatum;
  series: readonly ChartTooltipSeries<PriceTooltipDatum>[];
  baseTokenSymbol: string;
  baseTokenDecimals: number;
  range: TimeRange;
}

export function PriceChartTooltip({
  datum,
  series,
  baseTokenSymbol,
  baseTokenDecimals,
  range,
}: Props) {
  const hasFloorPrice = series.some((entry) => entry.key === "floorPrice");
  const showFloorDebug = hasFloorPrice && datum.totalSupply && datum.totalBalance;

  const formattedDate =
    range === "1d"
      ? `${formatShortDate(datum.timestamp * 1000)} ${formatClock(datum.timestamp * 1000)}`
      : formatShortDate(datum.timestamp * 1000);

  return (
    <div className="bg-zinc-900 border border-zinc-700 rounded-lg shadow-xl p-3 text-sm">
      <div className="font-medium mb-2 text-zinc-300">{formattedDate}</div>
      {series.map((entry) => (
        <div key={entry.key} className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full" style={{ backgroundColor: entry.color }} />
          <span className="text-zinc-400">{entry.label}:</span>
          <span className="font-mono text-white">
            {formatDecimals(entry.value, 6)} {baseTokenSymbol}
          </span>
        </div>
      ))}
      {showFloorDebug && (
        <div className="mt-2 pt-2 border-t border-zinc-700 text-xs text-zinc-500 space-y-1">
          <div className="flex justify-between gap-4">
            <span>Total Supply:</span>
            <span className="font-mono">
              {formatCompact(formatUnits(BigInt(datum.totalSupply!), JB_TOKEN_DECIMALS))}
            </span>
          </div>
          <div className="flex justify-between gap-4">
            <span>Total Balance:</span>
            <span className="font-mono">
              {formatCompact(formatUnits(BigInt(datum.totalBalance!), baseTokenDecimals))}{" "}
              {baseTokenSymbol}
            </span>
          </div>
          <div className="flex justify-between gap-4">
            <span>Cash Out Tax:</span>
            <span className="font-mono">{((datum.cashOutTaxRate ?? 0) / 100).toFixed(2)}%</span>
          </div>
        </div>
      )}
    </div>
  );
}

function formatCompact(value: string): string {
  const num = parseFloat(value);
  if (num >= 1_000_000_000) return (num / 1_000_000_000).toFixed(2) + "B";
  if (num >= 1_000_000) return (num / 1_000_000).toFixed(2) + "M";
  if (num >= 1_000) return (num / 1_000).toFixed(2) + "K";
  return num.toFixed(2);
}
