"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

type SearchResult = {
  projectId: number;
  chainId: number;
  chainIds: number[];
  suckerGroupId: string | null;
  name: string | null;
  ticker: string | null;
};

const CHAIN_SLUGS: Record<number, string> = {
  1: "eth",
  10: "op",
  8453: "base",
  42161: "arb",
};

const CHAIN_NAMES: Record<number, string> = {
  1: "Ethereum",
  10: "Optimism",
  8453: "Base",
  42161: "Arbitrum",
};

function resultHref(result: SearchResult) {
  return `/${CHAIN_SLUGS[result.chainId] ?? "eth"}:${result.projectId}`;
}

function Magnifier() {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      className="h-5 w-5"
      aria-hidden
    >
      <circle cx="9" cy="9" r="5.5" />
      <path d="m13.5 13.5 3.5 3.5" />
    </svg>
  );
}

export function RevnetSearch() {
  const router = useRouter();
  const containerRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [open, setOpen] = useState(false);
  const [searching, setSearching] = useState(false);
  const trimmedQuery = query.trim();

  useEffect(() => {
    const normalizedQuery = trimmedQuery.replace(/^\$/u, "");
    if (!normalizedQuery || (normalizedQuery.length < 2 && !/^\d+$/u.test(normalizedQuery))) {
      setResults([]);
      setOpen(false);
      setSearching(false);
      return;
    }

    const controller = new AbortController();
    const timeout = window.setTimeout(async () => {
      setSearching(true);
      try {
        const response = await fetch(`/api/search-projects?q=${encodeURIComponent(trimmedQuery)}`, {
          signal: controller.signal,
        });
        if (!response.ok) throw new Error("Search unavailable");
        const body = (await response.json()) as {
          projects?: SearchResult[];
        };
        setResults(body.projects ?? []);
        setOpen(true);
      } catch {
        if (!controller.signal.aborted) {
          setResults([]);
          setOpen(true);
        }
      } finally {
        if (!controller.signal.aborted) setSearching(false);
      }
    }, 250);

    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [trimmedQuery]);

  useEffect(() => {
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    return () => document.removeEventListener("pointerdown", closeOnOutsidePointer);
  }, []);

  const goToResult = (result: SearchResult) => {
    setOpen(false);
    setQuery("");
    setResults([]);
    router.push(resultHref(result));
  };

  return (
    <div ref={containerRef} className="relative min-w-0 w-full">
      <form
        role="search"
        onSubmit={(event) => {
          event.preventDefault();
          if (results[0]) goToResult(results[0]);
        }}
      >
        <label className="relative block">
          <span className="sr-only">Search revnets by name, ticker, or project ID</span>
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500">
            <Magnifier />
          </span>
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onFocus={() => {
              if (results.length > 0 || searching) setOpen(true);
            }}
            onKeyDown={(event) => {
              if (event.key === "Escape") setOpen(false);
            }}
            placeholder="Search revnets"
            className="min-h-12 w-full border border-zinc-200 bg-white py-2 pl-11 pr-3 text-base text-zinc-900 placeholder:text-zinc-400 outline-none transition focus:border-teal-500 focus:ring-1 focus:ring-teal-500"
          />
        </label>
      </form>

      {open ? (
        <div className="absolute left-0 right-0 top-full z-50 mt-2 max-h-96 overflow-y-auto border border-zinc-200 bg-white py-1 shadow-lg">
          {searching ? (
            <p className="px-4 py-3 text-sm text-zinc-600">Searching…</p>
          ) : results.length === 0 ? (
            <p className="px-4 py-3 text-sm text-zinc-600">No matching revnets.</p>
          ) : (
            <ul>
              {results.map((result) => (
                <li key={result.suckerGroupId ?? `${result.chainId}:${result.projectId}`}>
                  <button
                    type="button"
                    onClick={() => goToResult(result)}
                    className="block w-full px-4 py-3 text-left hover:bg-zinc-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-teal-500"
                  >
                    <span className="block truncate font-medium">
                      {result.name ?? `Project ${result.projectId}`}
                    </span>
                    <span className="block truncate text-xs text-zinc-600">
                      {result.ticker ? `$${result.ticker} · ` : ""}
                      {(result.chainIds.length ? result.chainIds : [result.chainId])
                        .map((chainId) => CHAIN_NAMES[chainId] ?? `Chain ${chainId}`)
                        .join(", ")}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}
