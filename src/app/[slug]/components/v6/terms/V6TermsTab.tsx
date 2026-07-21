"use client";

import { useTokenA } from "@/hooks/useTokenA";
import { formatTokenSymbol } from "@/lib/utils";
import { useJBTokenContext } from "@bananapus/nana-sdk-react";
import { useMemo } from "react";
import { CurrentIssuanceSection } from "../../../terms/components/CurrentIssuanceSection";
import { StagesTable } from "../../../terms/components/StagesTable";
import type { Ruleset } from "../../../terms/getRulesets";
import { IssuanceLadder } from "./IssuanceLadder";
import type { ChartStage } from "./chartUtils";

/**
 * website/-parity Terms tab for V6 projects (renderStagesSection):
 * a "Token issuance" card — current rate, next scheduled cut with live
 * countdown, % to splits, and the stepped issuance-price schedule — then the
 * per-stage terms table (period, issuance + cut cadence, split limit,
 * auto-issuance totals, cash out tax; current stage highlighted).
 */
export function V6TermsTab({ rulesets }: { rulesets: Ruleset[] }) {
  const { token } = useJBTokenContext();
  const tokenA = useTokenA();

  const symbol = formatTokenSymbol(token);
  const baseSymbol = tokenA?.symbol ?? "ETH";

  // getRulesets stores weightCutPercent as a fraction (WeightCutPercent.toFloat,
  // 0.38 = 38%); the chart math runs on the protocol's raw 1e9 scale.
  const stages: ChartStage[] = useMemo(
    () =>
      rulesets.map((r) => ({
        start: r.start,
        duration: r.duration,
        weight: BigInt(r.weight),
        weightCutPercent: Math.round(r.weightCutPercent * 1e9),
      })),
    [rulesets],
  );

  return (
    <div className="flex flex-col min-w-0">
      <div>
        <h3 className="text-sm font-medium text-zinc-500 mb-1">Token issuance</h3>
        <CurrentIssuanceSection />
        {stages.length > 0 && (
          <IssuanceLadder stages={stages} symbol={symbol} baseSymbol={baseSymbol} />
        )}
      </div>

      <div className="mt-8">
        <h3 className="text-sm font-medium text-zinc-500">Stages</h3>
        {/* StagesTable carries its own top margin; tuck it under the heading. */}
        <div className="[&>div]:mt-2">
          <StagesTable rulesets={rulesets} />
        </div>
      </div>
    </div>
  );
}
