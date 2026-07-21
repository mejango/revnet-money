import { parseSlug } from "@/lib/slug";
import { notFound } from "next/navigation";
import { V6TermsTab } from "../components/v6/terms/V6TermsTab";
import { getProject } from "../getProject";
import { getRulesets } from "./getRulesets";

interface Props {
  params: { slug: string };
}

export default async function Terms({ params }: Props) {
  const { chainId, projectId } = parseSlug(params.slug);

  const project = await getProject(projectId, chainId);
  if (!project) notFound();

  const rulesets = await getRulesets(projectId.toString(), chainId);

  return <V6TermsTab rulesets={rulesets} />;
}
