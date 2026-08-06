import { parseSlug } from "@/lib/slug";
import { notFound } from "next/navigation";
import { V6ExtrasTab } from "../components/v6/extras/V6ExtrasTab";
import { getProjectWithFallback } from "../getProjectFallback";
import { getSuckerGroup } from "../getSuckerGroup";

interface Props {
  params: Promise<{ slug: string }>;
}

export default async function ExtrasPage(props: Props) {
  const { slug } = await props.params;
  const { chainId, projectId } = parseSlug(slug);

  // Resolve through the on-chain fallback, exactly as the layout does. Bendystraw being
  // down returns null from the indexed read, which is indistinguishable from a project that
  // doesn't exist — 404-ing on it tells the owner of a live project that it was deleted.
  const resolved = await getProjectWithFallback(projectId, chainId);
  if (!resolved) notFound();
  const { project } = resolved;

  const suckerGroup = await getSuckerGroup(project.suckerGroupId, chainId);
  if (!suckerGroup) notFound();

  return <V6ExtrasTab projects={suckerGroup.projects?.items ?? []} />;
}
