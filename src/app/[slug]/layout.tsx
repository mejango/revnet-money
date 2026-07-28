import { Nav } from "@/components/layout/Nav";
import { parseSlug } from "@/lib/slug";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PropsWithChildren } from "react";
import { ActivityFeed } from "./components/ActivityFeed/ActivityFeed";
import { Header } from "./components/Header/Header";
import { NewProjectNotice } from "./components/NewProjectNotice";
import { PayCard } from "./components/PayCard/PayCard";
import { ResponsiveProjectLayout } from "./components/ResponsiveProjectLayout";
import { ShopCartProvider } from "./components/v6/ShopCartContext";
import { getProject } from "./getProject";
import { getProjectWithFallback } from "./getProjectFallback";
import { getProjectOperator } from "./getProjectOperator";
import { getSuckerGroup } from "./getSuckerGroup";
import { ProjectProviders } from "./ProjectProviders";
import { getRulesets } from "./terms/getRulesets";

export const revalidate = 300;

interface Props {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const origin = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3002";
  const { slug: encodedSlug } = await params;
  const slug = decodeURIComponent(encodedSlug ?? "");

  const url = new URL(`/${slug}`, origin);

  if (!slug.includes(":")) {
    const title = "Revnet";
    const description = "Explore onchain revenue networks";
    const imageUrl = `${origin}/assets/img/rev-og-191-1.png`;
    return buildMetadata({
      title,
      description,
      imageUrl,
      url: url.href,
    });
  }

  const { projectId, chainId } = parseSlug(slug);
  const project = projectId ? await getProject(projectId, chainId) : null;
  const imageUrl =
    project && projectId
      ? new URL(`/api/project-og/${chainId}/${projectId}`, origin).href
      : `${origin}/assets/img/revnet-social.png`;

  return buildMetadata({
    title: project?.name ? `${project.name} | REVNET` : "Revnet",
    description: "Explore onchain revenue networks",
    imageUrl,
    url: url.href,
  });
}

export default async function SlugLayout({ children, params }: PropsWithChildren<Props>) {
  const { slug } = await params;
  const { chainId, projectId } = parseSlug(slug);

  const resolved = await getProjectWithFallback(projectId, chainId);
  if (!resolved) notFound();
  const { project } = resolved;

  const operatorPromise = getProjectOperator(Number(projectId), chainId);
  const suckerGroupPromise = project.suckerGroupId
    ? getSuckerGroup(project.suckerGroupId, chainId)
    : Promise.resolve(null);
  const isRevnet = project.isRevnet !== false;
  const rulesetsPromise = isRevnet
    ? getRulesets(projectId.toString(), chainId)
    : Promise.resolve([]);

  const [indexedSuckerGroup, rulesets] = await Promise.all([suckerGroupPromise, rulesetsPromise]);

  // A missing sucker group means the indexer hasn't caught up (or is down),
  // not that the project is gone: render a degraded page from what the chain
  // provides instead of a false 404.
  const degraded = resolved.degraded || !indexedSuckerGroup;
  const suckerGroup = indexedSuckerGroup ?? {
    id: project.suckerGroupId,
    tokenSupply: "0",
    projects: {
      items: [
        {
          balance: "0",
          chainId,
          currency: project.currency,
          decimals: project.decimals,
          projectId: Number(projectId),
          suckerGroupId: project.suckerGroupId,
          token: project.token,
          tokenSymbol: project.tokenSymbol,
          tokenSupply: "0",
          version: project.version,
        },
      ],
    },
  };

  const projects = suckerGroup.projects?.items ?? [];
  const startDate = rulesets[0]?.start;

  return (
    <ProjectProviders chainId={chainId} projectId={projectId} project={project} projects={projects}>
      <ShopCartProvider>
        <div id="project-top">
          <Nav />
        </div>

        {degraded && (
          <div className="w-full px-4 sm:container pt-4">
            <p className="border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              This project was found onchain but hasn't finished indexing. Some stats may be missing
              or out of date.
            </p>
          </div>
        )}
        <div className="w-full px-4 sm:container pt-6">
          <Header isRevnet={isRevnet} operatorPromise={operatorPromise} projects={projects} />
        </div>
        {isRevnet ? (
          <ResponsiveProjectLayout
            sidebar={
              <>
                {startDate && <NewProjectNotice startDate={startDate} />}
                <div className="mt-1 mb-4">
                  <PayCard />
                </div>
              </>
            }
            activity={<ActivityFeed suckerGroupId={suckerGroup.id} projects={projects} />}
          >
            {children}
          </ResponsiveProjectLayout>
        ) : null}
      </ShopCartProvider>
    </ProjectProviders>
  );
}

function buildMetadata({
  title,
  description,
  imageUrl,
  url,
}: {
  title: string;
  description: string;
  imageUrl: string;
  url: string;
}): Metadata {
  return {
    title,
    openGraph: {
      title,
      description,
      url,
      images: [
        {
          url: imageUrl,
          width: 1200,
          height: 630,
          alt: `${title} preview image`,
        },
      ],
      type: "website",
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [imageUrl],
    },
  };
}
