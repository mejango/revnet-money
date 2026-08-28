"use client";

import { DiscoverGridSkeleton } from "@/components/loading/LoadingSkeletons";
import { ProjectLink } from "@/components/ProjectLink";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import MiniHeaderCard from "./MiniHeaderCard";

export type RevnetProject = {
  projectId: number;
  chainId?: number;
  chainIds?: number[];
  suckerGroupId?: string | null;
  ticker?: string | null;
  handle?: string | null;
  logoUri?: string | null;
  name?: string | null;
  projectTagline?: string | null;
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

async function fetchDiscoverProjects(): Promise<RevnetProject[]> {
  const response = await fetch("/api/discover-projects", {
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok || !response.headers.get("content-type")?.toLowerCase().includes("json")) {
    throw new Error("Project index is unavailable");
  }
  const body = (await response.json()) as { projects?: RevnetProject[] };
  if (!Array.isArray(body.projects)) {
    throw new Error("Project index returned an invalid response");
  }
  return body.projects;
}

/**
 * The grid renders from `initialProjects`, which the server already resolved, so the
 * first HTML response carries the whole catalogue instead of a loading skeleton.
 */
export function DiscoverList({ initialProjects }: { initialProjects: RevnetProject[] }) {
  const [search, setSearch] = useState("");
  const [searchResults, setSearchResults] = useState<RevnetProject[]>([]);
  const [searching, setSearching] = useState(false);
  const {
    data: projects = initialProjects,
    isLoading: projectsLoading,
    isError: projectsError,
  } = useQuery({
    queryKey: ["discover-projects", 1],
    queryFn: fetchDiscoverProjects,
    staleTime: 5 * 60_000,
    ...(initialProjects.length ? { initialData: initialProjects } : {}),
  });
  const trimmedSearch = search.trim();

  useEffect(() => {
    if (!trimmedSearch) {
      setSearchResults([]);
      setSearching(false);
      return;
    }
    if (trimmedSearch.length < 2 && !/^\d+$/u.test(trimmedSearch)) {
      setSearchResults([]);
      setSearching(false);
      return;
    }

    const controller = new AbortController();
    const timeout = setTimeout(async () => {
      setSearching(true);
      try {
        const response = await fetch(
          `/api/search-projects?q=${encodeURIComponent(trimmedSearch)}`,
          { signal: controller.signal },
        );
        if (!response.ok) return;
        const body = (await response.json()) as {
          projects?: RevnetProject[];
        };
        setSearchResults(body.projects ?? []);
      } catch {
        if (!controller.signal.aborted) setSearchResults([]);
      } finally {
        if (!controller.signal.aborted) setSearching(false);
      }
    }, 250);

    return () => {
      clearTimeout(timeout);
      controller.abort();
    };
  }, [trimmedSearch]);

  const displayedProjects = trimmedSearch ? searchResults : projects;

  return (
    <div className="mt-6">
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="text-2xl font-semibold">Funding opportunities</h2>
        <label className="relative block w-full sm:max-w-sm">
          <span className="sr-only">Search revnets</span>
          <span
            aria-hidden
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500"
          >
            ⌕
          </span>
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search name, ticker, or project ID"
            className="min-h-12 w-full rounded-lg border border-zinc-300 bg-white py-2 pl-10 pr-3 text-sm text-zinc-900 placeholder:text-zinc-400 outline-none focus:border-teal-500"
          />
        </label>
      </div>
      {projectsLoading && !trimmedSearch ? (
        <DiscoverGridSkeleton />
      ) : projectsError && !projects.length ? (
        <div className="border border-zinc-200 bg-melon-50 p-5 text-sm text-zinc-600">
          Projects are temporarily unavailable. Try again in a moment.
        </div>
      ) : searching ? (
        <DiscoverGridSkeleton cards={3} />
      ) : displayedProjects.length === 0 ? (
        <div className="border border-zinc-200 bg-melon-50 p-5 text-sm text-zinc-600">
          No matching revnets found.
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-6">
          {displayedProjects.map((p) => (
            <ProjectLink
              key={p.suckerGroupId ?? `${p.chainId ?? 1}:${p.projectId}`}
              href={`/${CHAIN_SLUGS[p.chainId ?? 1] ?? "eth"}:${p.projectId}`}
              projectHint={{
                name: p.name ?? p.handle ?? `Project ${p.projectId}`,
                logoUri: p.logoUri ?? null,
                tagline: p.projectTagline,
                ticker: p.ticker,
              }}
              className="border border-zinc-200 rounded-lg p-4 shadow hover:shadow-md transition block"
            >
              <MiniHeaderCard
                logoUri={p.logoUri}
                name={p.name}
                projectId={p.projectId}
                handle={p.handle}
              />
              <p className="text-zinc-600 text-sm line-clamp-2">
                {p.projectTagline || "No description available."}
              </p>
              {trimmedSearch && (
                <p className="mt-2 text-xs text-zinc-500">
                  {p.ticker ? `$${p.ticker} | ` : ""}
                  {(p.chainIds ?? [p.chainId ?? 1])
                    .map((chainId) => CHAIN_NAMES[chainId] ?? `Chain ${chainId}`)
                    .join(", ")}
                </p>
              )}
            </ProjectLink>
          ))}
        </div>
      )}
    </div>
  );
}
