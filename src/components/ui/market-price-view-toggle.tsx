"use client";

import { cn } from "@/lib/utils";

export type MarketPriceView = "smooth" | "trades";

export function MarketPriceViewToggle({
  value,
  onChange,
}: {
  value: MarketPriceView;
  onChange: (value: MarketPriceView) => void;
}) {
  return (
    <div
      role="group"
      aria-label="Pool price detail"
      className="flex shrink-0 items-center gap-3"
    >
      {(
        [
          ["smooth", "Smooth", "Show time-weighted averages of the pool price"],
          ["trades", "Every trade", "Show every exact post-trade pool price"],
        ] as const
      ).map(([option, label, title]) => (
        <button
          key={option}
          type="button"
          title={title}
          aria-pressed={value === option}
          onClick={() => onChange(option)}
          className={cn(
            "inline-flex items-center py-1 text-xs font-medium transition-colors focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500",
            value === option
              ? "text-teal-700 underline decoration-teal-400 underline-offset-4"
              : "text-zinc-500 hover:text-zinc-900",
          )}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
