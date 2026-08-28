import { IndexedProjectsOperation } from "@/lib/bendystraw/operations";
import { queryBendystraw } from "@/lib/bendystraw/query.server";
import type { IndexedProjectSummary } from "@/lib/bendystraw/types";

export type DiscoverProject = IndexedProjectSummary & { chainIds: number[] };

/**
 * Every indexed V6 revnet, one entry per sucker group.
 *
 * Shared by /api/discover-projects and the /discover page itself so the page can render
 * its grid on the server. It used to fetch the API from the browser, which left the
 * sitemap-listed discovery hub showing "Loading projects" to every crawler.
 */
export async function getDiscoverProjects(): Promise<DiscoverProject[]> {
  const projects: IndexedProjectSummary[] = [];
  let totalCount = 0;
  do {
    const data = await queryBendystraw(1, IndexedProjectsOperation, {
      where: { AND: [{ version: 6 }, { isRevnet: true }] },
      orderBy: "createdAt",
      orderDirection: "desc",
      limit: 250,
      offset: projects.length,
    });
    const page = data.projects.items;
    totalCount = data.projects.totalCount;
    projects.push(...page);
    if (!page.length) break;
  } while (projects.length < totalCount);

  const groups = new Map<
    string,
    { representative: IndexedProjectSummary; members: IndexedProjectSummary[] }
  >();

  for (const project of projects) {
    const key = project.suckerGroupId ?? `${project.chainId}:${project.projectId}`;
    const group = groups.get(key);
    if (!group) {
      groups.set(key, { representative: project, members: [project] });
      continue;
    }
    group.members.push(project);
    if (BigInt(project.volume || "0") > BigInt(group.representative.volume || "0")) {
      group.representative = project;
    }
  }

  return Array.from(groups.values())
    .map(({ representative, members }) => ({
      ...representative,
      chainIds: Array.from(new Set(members.map((member) => member.chainId))),
    }))
    .filter((project) => project.name || project.projectTagline);
}
