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
      className="flex shrink-0 gap-1 rounded-lg bg-teal-50 p-1"
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
            "inline-flex min-h-11 items-center rounded-md px-3 py-1.5 text-sm font-medium transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500",
            value === option
              ? "bg-teal-100 text-zinc-900"
              : "text-zinc-600 hover:bg-teal-100/60 hover:text-zinc-900",
          )}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
