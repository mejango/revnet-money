import { getTopProjects } from "./getTopProjects";
import { TopProjectsFeed } from "./TopProjectsFeed";

export async function TopProjectsTable() {
  const projects = await getTopProjects(9);

  if (projects.length === 0) {
    return null;
  }

  return (
    <TopProjectsFeed initialProjects={projects.slice(0, 8)} initialHasMore={projects.length > 8} />
  );
}
