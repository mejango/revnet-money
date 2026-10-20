"use client";

/** Presets and a custom percent for how far a quote may move before a transaction reverts. */
export function MaxQuoteChange({
  bps,
  onChange,
  maxBps = Infinity,
  className = "mt-4",
}: {
  bps: number;
  onChange: (bps: number) => void;
  /** The largest custom value accepted, in basis points. */
  maxBps?: number;
  className?: string;
}) {
  return (
    <div className={`${className} flex flex-wrap items-center gap-2`}>
      <span className="shrink-0 text-sm text-zinc-700">Max quote change</span>
      <div className="flex flex-wrap items-center gap-1">
        {[50, 100, 300].map((preset) => (
          <button
            key={preset}
            type="button"
            onClick={() => onChange(preset)}
            className={
              bps === preset
                ? "h-7 px-2 text-sm rounded-md border border-teal-500 bg-teal-500 text-melon-950"
                : "h-7 px-2 text-sm rounded-md border border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-100"
            }
          >
            {preset / 100}%
          </button>
        ))}
        <label className="flex h-7 w-[4.75rem] shrink-0 items-center border border-melon-300 bg-melon-25 px-2 text-sm text-zinc-700 focus-within:border-teal-600">
          <span className="sr-only">Custom maximum quote change, percent</span>
          <input
            type="number"
            min="0"
            max={Number.isFinite(maxBps) ? maxBps / 100 : 99.99}
            step="0.1"
            inputMode="decimal"
            value={bps / 100}
            onChange={(event) => {
              const percent = Number(event.target.value);
              const next = Math.round(percent * 100);
              if (Number.isFinite(percent) && percent >= 0 && percent < 100 && next <= maxBps) {
                onChange(next);
              }
            }}
            className="min-w-0 flex-1 !border-0 !bg-transparent !p-0 text-right !shadow-none outline-none !ring-0 focus:!border-0 focus:!shadow-none focus:!ring-0"
          />
          <span>%</span>
        </label>
      </div>
    </div>
  );
}
