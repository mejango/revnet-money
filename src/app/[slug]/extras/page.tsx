import { parseSlug } from "@/lib/slug";
import { notFound } from "next/navigation";
import { V6ExtrasTab } from "../components/v6/extras/V6ExtrasTab";
import { getProject } from "../getProject";
import { getSuckerGroup } from "../getSuckerGroup";

interface Props {
  params: Promise<{ slug: string }>;
}

export default async function ExtrasPage(props: Props) {
  const { slug } = await props.params;
  const { chainId, projectId } = parseSlug(slug);

  const project = await getProject(projectId, chainId);
  if (!project) notFound();

  const suckerGroup = await getSuckerGroup(project.suckerGroupId, chainId);
  if (!suckerGroup) notFound();

  return <V6ExtrasTab projects={suckerGroup.projects?.items ?? []} />;
}
