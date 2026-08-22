import { AuditPromptLink } from "@/components/AuditPromptLink";
import { ChainLogo } from "@/components/ChainLogo";
import { IpfsImage } from "@/components/IpfsImage";
import { IssuanceFingerprint } from "@/components/IssuanceFingerprint";
import { ProjectLink } from "@/components/ProjectLink";
import { IndexedProjectsOperation } from "@/lib/bendystraw/operations";
import { queryBendystraw } from "@/lib/bendystraw/query.server";
import type { IndexedProjectSummary } from "@/lib/bendystraw/types";
import { mainnet } from "@/lib/chains";
import { getIssuanceFingerprint } from "@/lib/issuanceFingerprint.server";
import { formatCompact } from "@/lib/number";
import { JB_CHAINS, type JBChainId } from "@bananapus/nana-sdk-core";
import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";
import { formatUnits } from "viem";
import { getHomepageActivityPage } from "./getHomepageActivity";
import { getHomepageReserves } from "./getHomepageReserves";
import { HomepageActivityFeed } from "./HomepageActivityFeed";
import { HomepageDiscoveryLayout } from "./HomepageDiscoveryLayout";
import { SecuredReserves } from "./SecuredReserves";
import { TopProjectsTable } from "./TopProjectsTable";

type HomepageProject = IndexedProjectSummary & { issuanceFingerprint: number[] };

async function getHomepageProjects(): Promise<HomepageProject[]> {
  try {
    const data = await queryBendystraw(mainnet.id, IndexedProjectsOperation, {
      where: { version: 6, isRevnet: true },
      orderBy: "trendingScore",
      orderDirection: "desc",
      limit: 60,
      offset: 0,
    });
    const groups = new Set<string>();
    const projects = data.projects.items
      .filter((project) => {
        if (!project.isRevnet || groups.has(project.suckerGroupId)) return false;
        groups.add(project.suckerGroupId);
        return true;
      })
      .slice(0, 8);
    return Promise.all(
      projects.map(async (project) => ({
        ...project,
        issuanceFingerprint: await getIssuanceFingerprint(
          project.projectId,
          project.chainId as JBChainId,
        ),
      })),
    );
  } catch {
    return [];
  }
}

export async function HomepageDiscovery() {
  const [activity, trending, reserves] = await Promise.all([
    getHomepageActivityPage(9),
    getHomepageProjects(),
    getHomepageReserves(),
  ]);
  return (
    <HomepageDiscoveryLayout
      hero={<HeroColumn />}
      summary={<SecuredReserves data={reserves} />}
      activity={
        <DashboardColumn title="Latest" headingClassName="hidden sm:flex">
          <HomepageActivityFeed
            initialEvents={activity.slice(0, 8)}
            initialHasMore={activity.length > 8}
          />
        </DashboardColumn>
      }
      trending={
        <DashboardColumn
          title="Trending"
          headingClassName="hidden xl:flex"
          panelClassName="xl:h-auto xl:flex-1"
        >
          <ProjectRows projects={trending} />
        </DashboardColumn>
      }
      top={
        <DashboardColumn title="Top" headingClassName="hidden xl:flex">
          <TopProjectsTable />
        </DashboardColumn>
      }
    />
  );
}

function DashboardColumn({
  title,
  children,
  headingClassName,
  panelClassName = "",
}: {
  title: string;
  children: ReactNode;
  headingClassName: string;
  panelClassName?: string;
}) {
  const id = `home-${title.replaceAll(" ", "-").toLowerCase()}`;
  return (
    <section className="flex min-w-0 flex-col xl:h-full" aria-labelledby={id}>
      <h2
        id={id}
        className={`mb-4 min-h-11 items-center text-xl font-semibold md:text-2xl ${headingClassName}`}
      >
        {title}
      </h2>
      <div
        data-scroll-container
        className={`max-h-[70svh] min-h-[420px] overflow-y-auto border border-teal-100 bg-teal-50 md:h-[calc(100svh-12rem)] md:max-h-none md:min-h-[520px] ${panelClassName}`}
      >
        {children}
      </div>
    </section>
  );
}

function ProjectRows({ projects }: { projects: HomepageProject[] }) {
  if (!projects.length)
    return (
      <p className="flex min-h-[420px] items-center justify-center px-6 text-center text-sm text-zinc-500">
        Projects are temporarily unavailable.
      </p>
    );
  return (
    <ol className="divide-y divide-teal-100">
      {projects.map((project, index) => {
        const chainId = project.chainId as JBChainId;
        const href = `/${JB_CHAINS[chainId]?.slug ?? "eth"}:${project.projectId}`;
        const name = project.name ?? `Project #${project.projectId}`;
        return (
          <li key={`${project.chainId}-${project.projectId}`} className="relative overflow-hidden">
            <IssuanceFingerprint values={project.issuanceFingerprint} />
            <ProjectLink
              href={href}
              projectHint={{ name, logoUri: project.logoUri, tagline: project.projectTagline }}
              className="group relative z-10 flex h-28 items-center gap-3 px-4 py-3"
            >
              <span className="w-5 shrink-0 text-xs tabular-nums text-zinc-400">{index + 1}</span>
              <IpfsImage
                src={project.logoUri}
                alt=""
                width={40}
                height={40}
                loading={index < 4 ? "eager" : "lazy"}
                fetchPriority={index < 4 ? "high" : "auto"}
                className="size-10 shrink-0 object-cover"
                fallback={<div className="size-10 shrink-0 bg-teal-100" />}
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium group-hover:text-teal-600">
                  {name}
                </span>
                <span className="mt-0.5 block text-xs leading-snug text-zinc-500">
                  <span className="block text-[10px] uppercase tracking-wide text-zinc-400">
                    Recent
                  </span>
                  <span className="block">
                    Payments:{" "}
                    <span className="tabular-nums text-zinc-600">
                      {(project.trendingPaymentsCount ?? 0).toLocaleString("en-US")}
                    </span>
                  </span>
                  <span className="block">
                    Volume:{" "}
                    <span className="tabular-nums text-zinc-600">
                      {formatRecentVolume(project)}
                    </span>
                  </span>
                </span>
              </span>
              <ChainLogo chainId={chainId} width={16} height={16} />
            </ProjectLink>
          </li>
        );
      })}
    </ol>
  );
}

function formatRecentVolume(project: IndexedProjectSummary) {
  const integer = String(project.trendingVolume ?? 0).split(".")[0] || "0";
  const amount = formatUnits(BigInt(integer), project.decimals ?? 18);
  const symbol = project.tokenSymbol?.replace(/^\$+/, "");
  return `${formatCompact(amount)}${symbol ? ` ${symbol}` : ""}`;
}

function HeroColumn() {
  return (
    <section className="flex min-h-[460px] min-w-0 max-w-full flex-col items-center overflow-hidden p-6 text-center xl:h-[calc(100svh-9rem)] xl:min-h-[570px] xl:overflow-y-auto">
      <Image
        src="/assets/img/hovercar-cutout.webp"
        alt=""
        width={1619}
        height={971}
        className="mb-3 h-auto max-h-[260px] min-w-0 max-w-full translate-y-12 object-contain"
      />
      <div className="w-full min-w-0 max-w-full">
        <Image
          src="/assets/img/revnet-full-bw.svg"
          alt="Revnet"
          width={1509}
          height={140}
          className="mx-auto h-auto min-w-0 max-w-full object-contain"
        />
        <p className="mt-7 max-w-full break-words text-xl font-medium">
          An investible business model <span className="whitespace-nowrap">for the open web.</span>
        </p>
        <Link
          href="/create"
          className="mt-7 inline-flex min-h-12 items-center bg-teal-500 px-5 text-lg hover:bg-teal-600"
        >
          Create yours
        </Link>
        <AuditPromptLink className="mt-4 whitespace-nowrap text-xs text-zinc-600 2xl:text-sm" />
      </div>
    </section>
  );
}
