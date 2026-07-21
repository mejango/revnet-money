import { parseSlug } from "@/lib/slug";
import { notFound } from "next/navigation";
import { V6OwnersTab } from "../components/v6/owners/V6OwnersTab";
import { getProject } from "../getProject";
import { getSuckerGroup } from "../getSuckerGroup";

interface Props {
  params: { slug: string };
}

export default async function Owners(props: Props) {
  const { slug } = props.params;
  const { chainId, projectId } = parseSlug(slug);

  const project = await getProject(projectId, chainId);
  if (!project) notFound();

  const suckerGroup = await getSuckerGroup(project.suckerGroupId, chainId);
  if (!suckerGroup) notFound();

  return <V6OwnersTab projects={suckerGroup.projects?.items ?? []} />;
}
