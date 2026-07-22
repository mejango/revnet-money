import { parseSlug } from "@/lib/slug";
import { notFound } from "next/navigation";
import { V6TermsTab } from "../components/v6/terms/V6TermsTab";
import { getProject } from "../getProject";
import { getRulesets } from "./getRulesets";

interface Props {
  params: Promise<{ slug: string }>;
}

export default async function Terms({ params }: Props) {
  const { slug } = await params;
  const { chainId, projectId } = parseSlug(slug);

  const project = await getProject(projectId, chainId);
  if (!project) notFound();

  const rulesets = await getRulesets(projectId.toString(), chainId);

  return <V6TermsTab rulesets={rulesets} />;
}
