"use client";

import { cn } from "@/lib/utils";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";

export type RangeOption<T extends string> = {
  value: T;
  label: string;
};

interface Props<T extends string> {
  ranges: RangeOption<T>[];
  defaultValue: T;
}

export function RangeSelector<T extends string>({ ranges, defaultValue }: Props<T>) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const rangeParam = searchParams.get("range");

  const validValues = ranges.map((r) => r.value);
  const currentValue = validValues.includes(rangeParam as T) ? (rangeParam as T) : defaultValue;

  return (
    <div className="flex gap-1 p-1 bg-teal-50 rounded-lg shrink-0">
      {ranges.map(({ value, label }) => (
        <Link
          key={value}
          href={`${pathname}?range=${value}`}
          scroll={false}
          className={cn(
            "inline-flex min-h-11 items-center px-3 py-1.5 text-sm font-medium rounded-md transition-all",
            // A darker fill of the track's own green reads as selected; white
            // read as a hole punched in the control.
            currentValue === value
              ? "bg-teal-100 text-zinc-900"
              : "text-zinc-600 hover:bg-teal-100/60 hover:text-zinc-900",
          )}
        >
          {label}
        </Link>
      ))}
    </div>
  );
}
