"use client";

import { ChartSkeleton } from "@/components/loading/LoadingSkeletons";
import { CartesianChart, type ChartReferenceLine, type ChartSeries } from "@/components/ui/chart";
import { RangeOption, RangeSelector } from "@/components/ui/range-selector";
import { formatDecimals } from "@/lib/number";
import { parseTimeRange, TimeRange } from "@/lib/timeRange";
import { JBChainId } from "@bananapus/nana-sdk-core";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { ChartToggleButton } from "./ChartToggleButton";
import { getTokenPriceChartData } from "./getTokenPriceChartData";
import { PriceChartTooltip } from "./PriceChartTooltip";

const TIME_RANGES: RangeOption<TimeRange>[] = [
  { value: "1d", label: "1D" },
  { value: "7d", label: "7D" },
  { value: "30d", label: "30D" },
  { value: "3m", label: "3M" },
  { value: "1y", label: "1Y" },
  { value: "all", label: "All" },
];

const NOW_COLOR = "#EE6F3A"; // peel-400

interface Props {
  projectId: string;
  chainId: JBChainId;
  suckerGroupId: string;
  token: string;
  tokenSymbol: string;
  tokenDecimals: number;
}

export function TokenPriceChart({
  projectId,
  chainId,
  suckerGroupId,
  token,
  tokenSymbol,
  tokenDecimals,
}: Props) {
  const searchParams = useSearchParams();
  const range = parseTimeRange(searchParams.get("range"));

  const { data, isLoading } = useQuery({
    queryKey: ["chartData", projectId, chainId, suckerGroupId, range],
    queryFn: () =>
      getTokenPriceChartData({
        projectId,
        chainId,
        range,
        suckerGroupId,
        baseToken: { address: token, symbol: tokenSymbol, decimals: tokenDecimals },
      }),
    placeholderData: keepPreviousData,
  });

  const [showIssuance, setShowIssuance] = useState(true);
  const [showAmm, setShowAmm] = useState(true);
  const [showFloor, setShowFloor] = useState(true);

  const chartData = data?.chartData ?? [];
  const hasData = chartData.length > 0;

  const hasPool = data?.hasPool ?? false;
  const hasAmmData = chartData.some((d) => d.ammPrice !== undefined);
  const hasFloorData = chartData.some((d) => d.floorPrice !== undefined);
  const firstTimestamp = chartData[0]?.timestamp;
  const lastTimestamp = chartData[chartData.length - 1]?.timestamp;
  const visibleStages =
    firstTimestamp === undefined || lastTimestamp === undefined
      ? []
      : (data?.stages ?? []).filter(
          (stage) => stage.timestamp > firstTimestamp && stage.timestamp < lastTimestamp,
        );
  const todayTimestamp = data?.todayTimestamp;
  const showToday =
    todayTimestamp !== undefined &&
    firstTimestamp !== undefined &&
    lastTimestamp !== undefined &&
    todayTimestamp >= firstTimestamp &&
    todayTimestamp <= lastTimestamp;

  const filteredData = chartData.map((point) => ({
    timestamp: point.timestamp,
    issuancePrice: showIssuance ? point.issuancePrice : undefined,
    ammPrice: showAmm ? point.ammPrice : undefined,
    floorPrice: showFloor ? point.floorPrice : undefined,
    totalSupply: showFloor ? point.totalSupply : undefined,
    totalBalance: showFloor ? point.totalBalance : undefined,
    cashOutTaxRate: showFloor ? point.cashOutTaxRate : undefined,
  }));
  const visibleSeries: ChartSeries<(typeof filteredData)[number]>[] = [];
  if (showIssuance) {
    visibleSeries.push({
      key: "issuancePrice",
      label: "Issuance",
      color: "var(--chart-2)",
      value: (point) => point.issuancePrice,
    });
  }
  if (showAmm && hasAmmData) {
    visibleSeries.push({
      key: "ammPrice",
      label: "Pool",
      color: "var(--chart-4)",
      value: (point) => point.ammPrice,
    });
  }
  if (showFloor && hasFloorData) {
    visibleSeries.push({
      key: "floorPrice",
      label: "Floor",
      color: "var(--chart-3)",
      value: (point) => point.floorPrice,
    });
  }
  const referenceLines: ChartReferenceLine[] = visibleStages.map((stage) => ({
    key: `${stage.name}-${stage.timestamp}`,
    x: stage.timestamp,
    color: "#C6EDD5",
    dash: "3 3",
    width: 2,
    label: stage.name,
    labelColor: "#3D7955",
    labelSide: "right",
  }));
  if (showToday && todayTimestamp !== undefined) {
    referenceLines.push({
      key: "now",
      x: todayTimestamp,
      color: NOW_COLOR,
      dash: "4 4",
      width: 2,
      label: "Now",
      labelColor: NOW_COLOR,
    });
  }
  const maxVisiblePrice = filteredData.reduce(
    (max, point) =>
      Math.max(
        max,
        ...visibleSeries.map((series) => {
          const value = series.value(point);
          return value !== undefined && Number.isFinite(value) ? value : 0;
        }),
      ),
    0,
  );

  return (
    <div className="w-full">
      <div className="flex flex-col items-start gap-2.5 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap gap-1.5 lg:gap-4">
          <ChartToggleButton
            label="Issuance Price"
            active={showIssuance}
            colorVar="--chart-2"
            onClick={() => setShowIssuance(!showIssuance)}
          />
          {hasPool && (
            <ChartToggleButton
              label="Pool Price"
              active={showAmm}
              disabled={!hasAmmData}
              colorVar="--chart-4"
              onClick={() => setShowAmm(!showAmm)}
            />
          )}
          <ChartToggleButton
            label="Cash out Price"
            active={showFloor}
            disabled={!hasFloorData}
            colorVar="--chart-3"
            onClick={() => setShowFloor(!showFloor)}
          />
        </div>
        <RangeSelector ranges={TIME_RANGES} defaultValue="1y" />
      </div>

      {hasData ? (
        <CartesianChart
          data={filteredData}
          xValue={(point) => point.timestamp}
          series={visibleSeries}
          ariaLabel={`${tokenSymbol} price history`}
          description={`Issuance, pool, and cash out prices for ${tokenSymbol} over the selected ${range} range.`}
          className="mt-6 aspect-[4/3] sm:aspect-[2/1] lg:aspect-[5/2] w-full"
          margin={{ left: 84, right: 20, top: 24, bottom: 36 }}
          xDomain={[firstTimestamp ?? 0, lastTimestamp ?? 1]}
          yDomain={[0, maxVisiblePrice > 0 ? maxVisiblePrice * 1.1 : 1]}
          formatXTick={(timestamp) => formatXAxis(timestamp, range)}
          formatYTick={(value) => formatDecimals(value, 6)}
          referenceLines={referenceLines}
          tooltip={({ datum, series }) => (
            <PriceChartTooltip
              datum={datum}
              series={series}
              baseTokenSymbol={tokenSymbol}
              baseTokenDecimals={tokenDecimals}
              range={range}
            />
          )}
        />
      ) : isLoading ? (
        <ChartSkeleton className="mt-6 aspect-[4/3] w-full sm:aspect-[2/1] lg:aspect-[5/2]" />
      ) : (
        <div className="aspect-[4/3] sm:aspect-[2/1] lg:aspect-[5/2] w-full flex items-center justify-center text-zinc-500">
          No price data available
        </div>
      )}
    </div>
  );
}

const formatXAxis = (timestamp: number, range: TimeRange) => {
  const date = new Date(timestamp * 1000);
  if (range === "1d" || range === "7d") {
    return format(date, "HH:mm");
  }
  if (range === "30d" || range === "3m") {
    return format(date, "MMM d");
  }
  return format(date, "MMM yyyy");
};
