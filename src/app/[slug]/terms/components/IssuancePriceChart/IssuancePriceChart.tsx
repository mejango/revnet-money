"use client";

import {
  CartesianChart,
  findNearestIndex,
  type ChartBand,
  type ChartReferenceLine,
  type ChartSeries,
} from "@/components/ui/chart";
import { useProjectBaseToken } from "@/hooks/useProjectBaseToken";
import { formatShortDate, formatYear } from "@/lib/date";
import { useJBTokenContext } from "@/lib/nana/project";
import { formatDecimals } from "@/lib/number";
import { formatTokenSymbol } from "@/lib/utils";
import { useSearchParams } from "next/navigation";
import { useMemo } from "react";
import type { Ruleset } from "../../getRulesets";
import { prepareChartData, ProjectionRange } from "./prepareChartData";

const VALID_RANGES: ProjectionRange[] = ["1y", "5y", "10y", "20y", "all"];
const DEFAULT_RANGE: ProjectionRange = "1y";

interface Props {
  rulesets: Ruleset[];
}

export function IssuancePriceChart({ rulesets }: Props) {
  const searchParams = useSearchParams();
  const rangeParam = searchParams.get("range");
  const range: ProjectionRange = VALID_RANGES.includes(rangeParam as ProjectionRange)
    ? (rangeParam as ProjectionRange)
    : DEFAULT_RANGE;

  const { token } = useJBTokenContext();
  const baseToken = useProjectBaseToken();

  const { chartData, stages, stageAreas, todayVisualX, toReal } = useMemo(
    () => prepareChartData(rulesets, range),
    [rulesets, range],
  );

  if (!chartData.length) return null;

  const tokenSymbol = formatTokenSymbol(token);
  const series: ChartSeries<(typeof chartData)[number]>[] = [
    {
      key: "price",
      label: "Price",
      color: "var(--chart-2)",
      value: (point) => point.price,
      area: {
        color: "var(--chart-2)",
        opacityFrom: 0.3,
        opacityTo: 0.02,
      },
    },
  ];
  const bands: ChartBand[] = stageAreas.map((area) => ({
    key: area.name,
    x1: area.x1,
    x2: area.x2,
    fill: area.fill,
  }));
  const referenceLines: ChartReferenceLine[] = stageAreas.map((area) => ({
    key: `line-${area.name}`,
    x: area.x1,
    color: "#C6EDD5",
    dash: "3 3",
    label: area.name,
    labelColor: "#3D7955",
    labelSide: "right",
  }));
  if (todayVisualX !== null) {
    referenceLines.push({
      key: "today",
      x: todayVisualX,
      color: "var(--chart-1)",
      dash: "4 4",
      width: 1,
      label: "Now",
      labelColor: "var(--chart-1)",
    });
  }
  const firstVisualX = chartData[0].visualX;
  const lastVisualX = chartData[chartData.length - 1].visualX;
  const initialIndex =
    todayVisualX === null
      ? chartData.length - 1
      : findNearestIndex(chartData, (d) => d.visualX, todayVisualX);

  return (
    <CartesianChart
      key={range}
      data={chartData}
      xValue={(point) => point.visualX}
      series={series}
      ariaLabel={`Projected ${tokenSymbol} issuance price`}
      description={`Projected issuance price in ${baseToken?.symbol ?? "the base token"} per ${tokenSymbol}, grouped by ruleset stage.`}
      className="aspect-[4/3] sm:aspect-[2/1] lg:aspect-[5/2] w-full"
      margin={{ left: 88, right: 20, top: 24, bottom: 38 }}
      xDomain={[firstVisualX, lastVisualX]}
      formatXTick={(value) => formatYear(new Date(toReal(value) * 1000))}
      formatYTick={(value) => formatDecimals(value, 6)}
      bands={bands}
      referenceLines={referenceLines}
      initialIndex={initialIndex}
      tooltip={({ datum, series: tooltipSeries }) => {
        const stage = stages.findLast((stage) => datum.timestamp >= stage.start);
        const value = tooltipSeries[0]?.value;
        if (value === undefined) return null;
        return (
          <div className="bg-zinc-900 border border-zinc-700 rounded-lg shadow-xl p-3 text-sm whitespace-nowrap">
            <div className="font-medium mb-1 text-zinc-300">
              {formatShortDate(new Date(datum.timestamp * 1000))}
            </div>
            {stage && (
              <div className="text-xs text-zinc-500 mb-2 uppercase tracking-wider font-semibold">
                {stage.name}
              </div>
            )}
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-[--chart-2]" />
              <span className="text-zinc-400">Price:</span>
              <span className="font-mono text-white">
                {formatDecimals(value, 6)} {baseToken?.symbol} / {tokenSymbol}
              </span>
            </div>
          </div>
        );
      }}
    />
  );
}
