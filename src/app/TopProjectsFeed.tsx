"use client";

import { IpfsImage } from "@/components/IpfsImage";
import { IssuanceFingerprint } from "@/components/IssuanceFingerprint";
import { ProjectLink } from "@/components/ProjectLink";
import { useInfiniteScroll } from "@/hooks/useInfiniteScroll";
import { useCallback, useState } from "react";

export type TopProject = {
  rank: number;
  projectId: number;
  chainId: number;
  chainSlug: string;
  name: string;
  tagline: string | null;
  logoUri: string | null;
  balanceUsd: number;
  issuanceFingerprint: number[];
};

export function TopProjectsFeed({
  initialProjects,
  initialHasMore,
}: {
  initialProjects: TopProject[];
  initialHasMore: boolean;
}) {
  const [projects, setProjects] = useState(initialProjects);
  const [hasMore, setHasMore] = useState(initialHasMore);
  const [loading, setLoading] = useState(false);
  const loadMore = useCallback(async () => {
    if (!hasMore || loading) return;
    setLoading(true);
    try {
      const response = await fetch(`/api/top-projects?limit=8&offset=${projects.length}`);
      if (!response.ok) throw new Error("Top revnets unavailable");
      const data = (await response.json()) as { projects: TopProject[]; hasMore: boolean };
      setProjects((current) => {
        const keys = new Set(current.map((project) => `${project.chainId}-${project.projectId}`));
        return [
          ...current,
          ...data.projects.filter(
            (project) => !keys.has(`${project.chainId}-${project.projectId}`),
          ),
        ];
      });
      setHasMore(data.hasMore);
    } finally {
      setLoading(false);
    }
  }, [hasMore, loading, projects.length]);
  const markerRef = useInfiniteScroll(loadMore, hasMore && !loading);

  return (
    <ol className="min-w-0 divide-y divide-teal-100">
      {projects.map((project) => (
        <li key={`${project.chainId}-${project.projectId}`} className="relative overflow-hidden">
          <IssuanceFingerprint values={project.issuanceFingerprint} />
          <ProjectLink
            href={`/${project.chainSlug}:${project.projectId}`}
            projectHint={{ name: project.name, logoUri: project.logoUri, tagline: project.tagline }}
            className="group relative z-10 flex h-28 min-w-0 items-center gap-3 px-4 py-3"
          >
            <span className="w-5 shrink-0 text-xs tabular-nums text-zinc-400">{project.rank}</span>
            <IpfsImage
              src={project.logoUri}
              alt={project.name}
              width={40}
              height={40}
              loading={project.rank <= 4 ? "eager" : "lazy"}
              fetchPriority={project.rank <= 4 ? "high" : "auto"}
              className="size-10 shrink-0 object-cover transition-opacity group-hover:opacity-70"
              fallback={<div className="size-10 shrink-0 bg-teal-100" />}
            />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium transition-colors group-hover:text-teal-600">
                {project.name}
              </span>
              <span className="mt-0.5 block truncate text-xs text-zinc-500">
                Balance:{" "}
                <span className="tabular-nums text-zinc-700">
                  {project.balanceUsd.toLocaleString("en-US", {
                    style: "currency",
                    currency: "USD",
                    maximumFractionDigits: 0,
                  })}
                </span>
              </span>
            </span>
          </ProjectLink>
        </li>
      ))}
      {hasMore || loading ? (
        <li className="h-12" aria-hidden>
          <div ref={markerRef} className="h-px" />
        </li>
      ) : null}
    </ol>
  );
}
