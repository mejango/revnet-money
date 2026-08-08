"use client";

import { InformationCircle } from "@/components/ui/icons";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

/**
 * A small (!) that carries a chart caveat without taking a line of the layout.
 *
 * For notes that are ALWAYS true of a given project rather than notes about something being
 * wrong — a permanent banner reads as a warning and trains the reader to ignore it. Anything
 * saying data is missing or a source is down belongs inline, where it cannot be missed.
 *
 * `title` carries the same text so it survives touch, where there is no hover.
 */
export function ChartNoteTip({ note }: { note: string }) {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label={note}
            title={note}
            className="flex items-center justify-center text-zinc-400 transition-colors hover:text-zinc-600"
          >
            <InformationCircle className="h-[18px] w-[18px]" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="left" className="max-w-xs text-xs leading-relaxed">
          {note}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
