import { getTopProjects } from "./getTopProjects";
import { TopProjectsFeed } from "./TopProjectsFeed";

export async function TopProjectsTable() {
  const projects = await getTopProjects(9);

  if (projects.length === 0) {
    return (
      <p className="flex min-h-[420px] items-center justify-center px-6 text-center text-sm text-zinc-500">
        Projects are temporarily unavailable.
      </p>
    );
  }

  return (
    <TopProjectsFeed initialProjects={projects.slice(0, 8)} initialHasMore={projects.length > 8} />
  );
}
