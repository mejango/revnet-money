import { IpfsImage } from "@/components/IpfsImage";
import { ProjectLink } from "@/components/ProjectLink";
import { getTopProjects } from "./getTopProjects";

export async function TopProjectsTable() {
  const projects = await getTopProjects();

  if (projects.length === 0) {
    return null;
  }

  return (
    <ol className="min-w-0 divide-y divide-teal-100">
      {projects.map((project) => (
        <li key={`${project.chainId}-${project.projectId}`}>
          <ProjectLink
            href={`/${project.chainSlug}:${project.projectId}`}
            projectHint={{
              name: project.name,
              logoUri: project.logoUri,
              tagline: project.tagline,
            }}
            className="group flex min-w-0 items-center gap-3 px-4 py-4"
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
    </ol>
  );
}
