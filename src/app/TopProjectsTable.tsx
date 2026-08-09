import { IpfsImage } from "@/components/IpfsImage";
import { ProjectLink } from "@/components/ProjectLink";
import { getTopProjects } from "./getTopProjects";

export async function TopProjectsTable() {
  const projects = await getTopProjects();

  if (projects.length === 0) {
    return null;
  }

  return (
    <div className="min-w-0">
      <table className="w-full table-fixed text-left">
        <colgroup>
          <col className="w-9" />
          <col />
          <col className="w-20" />
        </colgroup>
        <thead>
          <tr className="h-12 border-b border-zinc-100 text-sm text-zinc-500">
            <th className="py-0 pl-3 pr-1 align-middle font-normal" />
            <th className="px-1 align-middle font-normal">Project</th>
            <th className="py-0 pl-1 pr-3 text-right align-middle font-normal">Balance</th>
          </tr>
        </thead>
        <tbody>
          {projects.map((project) => (
            <tr
              key={`${project.chainId}-${project.projectId}`}
              className="border-b border-zinc-100 last:border-b-0"
            >
              <td className="py-3 pl-3 pr-1 text-xs text-zinc-400 tabular-nums">{project.rank}</td>
              <td className="min-w-0 px-1 py-3">
                <ProjectLink
                  href={`/${project.chainSlug}:${project.projectId}`}
                  projectHint={{
                    name: project.name,
                    logoUri: project.logoUri,
                    tagline: project.tagline,
                  }}
                  className="group flex min-h-10 min-w-0 items-center gap-2"
                >
                  <IpfsImage
                    src={project.logoUri}
                    alt={project.name}
                    width={40}
                    height={40}
                    className="size-10 shrink-0 rounded-full object-cover transition-opacity group-hover:opacity-70"
                    fallback={<div className="size-10 shrink-0 rounded-full bg-zinc-100" />}
                  />
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium transition-colors group-hover:text-teal-600">
                      {project.name}
                    </div>
                  </div>
                </ProjectLink>
              </td>
              <td className="whitespace-nowrap py-3 pl-1 pr-3 text-right text-xs tabular-nums">
                {project.balanceUsd.toLocaleString("en-US", {
                  style: "currency",
                  currency: "USD",
                  maximumFractionDigits: 0,
                })}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
