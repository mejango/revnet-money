import { AuditPromptLink } from "@/components/AuditPromptLink";
import { ChainLogo } from "@/components/ChainLogo";
import { DateRelative } from "@/components/DateRelative";
import { IpfsImage } from "@/components/IpfsImage";
import { ProjectLink } from "@/components/ProjectLink";
import { ActivityEventsOperation, IndexedProjectsOperation } from "@/lib/bendystraw/operations";
import { queryBendystraw } from "@/lib/bendystraw/query.server";
import type { ActivityEventsQuery, IndexedProjectSummary } from "@/lib/bendystraw/types";
import { mainnet } from "@/lib/chains";
import { JB_CHAINS, type JBChainId } from "@bananapus/nana-sdk-core";
import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";
import { HomepageDiscoveryLayout } from "./HomepageDiscoveryLayout";
import { TopProjectsTable } from "./TopProjectsTable";

type RawActivity = ActivityEventsQuery["activityEvents"]["items"][number];

async function getHomepageProjects() {
  try {
    const data = await queryBendystraw(mainnet.id, IndexedProjectsOperation, {
      where: { version: 6, isRevnet: true },
      orderBy: "volume",
      orderDirection: "desc",
      limit: 60,
      offset: 0,
    });
    const groups = new Set<string>();
    return data.projects.items
      .filter((project) => {
        if (!project.isRevnet || groups.has(project.suckerGroupId)) return false;
        groups.add(project.suckerGroupId);
        return true;
      })
      .slice(0, 8);
  } catch {
    return [];
  }
}

function isHomepageEvent(event: RawActivity) {
  return !!(
    event.payEvent ||
    event.cashOutTokensEvent ||
    event.swapEvent ||
    event.sendPayoutsEvent ||
    event.rulesetQueuedEvent ||
    event.projectCreateEvent ||
    event.addToBalanceEvent
  );
}

async function getHomepageActivity() {
  try {
    const data = await queryBendystraw(mainnet.id, ActivityEventsOperation, {
      where: { version: 6 },
      orderBy: "timestamp",
      orderDirection: "desc",
      limit: 120,
      offset: 0,
    });
    return data.activityEvents.items
      .filter((event) => event.project?.isRevnet && isHomepageEvent(event))
      .slice(0, 8);
  } catch {
    return [];
  }
}

export async function HomepageDiscovery() {
  const [activity, trending] = await Promise.all([getHomepageActivity(), getHomepageProjects()]);
  return (
    <HomepageDiscoveryLayout
      hero={<HeroColumn />}
      activity={
        <DashboardColumn title="Fresh activity">
          <ActivityRows events={activity} />
        </DashboardColumn>
      }
      trending={
        <DashboardColumn title="Trending projects">
          <ProjectRows projects={trending} />
        </DashboardColumn>
      }
      top={
        <DashboardColumn title="Top projects">
          <TopProjectsTable />
        </DashboardColumn>
      }
    />
  );
}

function DashboardColumn({ title, children }: { title: string; children: ReactNode }) {
  const id = `home-${title.replaceAll(" ", "-").toLowerCase()}`;
  return (
    <section className="min-w-0" aria-labelledby={id}>
      <h2 id={id} className="mb-4 hidden text-xl font-semibold md:text-2xl xl:block">
        {title}
      </h2>
      <div className="min-h-[420px] overflow-hidden border border-zinc-200 bg-white">
        {children}
      </div>
    </section>
  );
}

function EmptyRows() {
  return (
    <p className="flex min-h-[420px] items-center justify-center px-6 text-center text-sm text-zinc-500">
      Projects are temporarily unavailable.
    </p>
  );
}

function ProjectRows({ projects }: { projects: IndexedProjectSummary[] }) {
  if (!projects.length) return <EmptyRows />;
  return (
    <ol className="divide-y divide-zinc-100">
      {projects.map((project, index) => {
        const chainId = project.chainId as JBChainId;
        const href = `/${JB_CHAINS[chainId]?.slug ?? "eth"}:${project.projectId}`;
        const name = project.name ?? `Project #${project.projectId}`;
        return (
          <li key={`${project.chainId}-${project.projectId}`}>
            <ProjectLink
              href={href}
              projectHint={{ name, logoUri: project.logoUri, tagline: project.projectTagline }}
              className="group flex items-center gap-3 px-4 py-4"
            >
              <span className="w-5 shrink-0 text-xs tabular-nums text-zinc-400">{index + 1}</span>
              <IpfsImage
                src={project.logoUri}
                alt=""
                width={40}
                height={40}
                className="size-10 shrink-0 rounded-full object-cover"
                fallback={<div className="size-10 shrink-0 rounded-full bg-teal-100" />}
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium group-hover:text-teal-600">
                  {name}
                </span>
                <span className="mt-0.5 block truncate text-xs text-zinc-500">
                  {project.projectTagline ?? "Revnet"}
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

function activityDescription(event: RawActivity) {
  if (event.payEvent) return "paid in";
  if (event.cashOutTokensEvent) return "cashed out";
  if (event.swapEvent)
    return event.swapEvent.direction.toLowerCase() === "sell"
      ? "sold through the market"
      : "bought through the market";
  if (event.sendPayoutsEvent) return "sent payouts";
  if (event.rulesetQueuedEvent) return "reconfigured the revnet";
  if (event.projectCreateEvent) return "created the revnet";
  return "added to balance";
}

function ActivityRows({ events }: { events: RawActivity[] }) {
  if (!events.length)
    return (
      <p className="flex min-h-[420px] items-center justify-center px-6 text-center text-sm text-zinc-500">
        No recent activity yet.
      </p>
    );
  return (
    <ol className="divide-y divide-zinc-100">
      {events.map((event) => {
        const project = event.project!;
        const chainId = event.chainId as JBChainId;
        const name = project.name ?? `Project #${project.projectId}`;
        const href = `/${JB_CHAINS[chainId]?.slug ?? "eth"}:${project.projectId}`;
        return (
          <li key={event.id} className="px-4 py-4">
            <div className="flex items-start gap-3">
              <ProjectLink
                href={href}
                projectHint={{
                  name,
                  logoUri: project.logoUri ?? null,
                  tagline: project.projectTagline ?? null,
                }}
                className="shrink-0"
              >
                <IpfsImage
                  src={project.logoUri ?? null}
                  alt=""
                  width={40}
                  height={40}
                  className="size-10 rounded-full object-cover"
                  fallback={<div className="size-10 rounded-full bg-teal-100" />}
                />
              </ProjectLink>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2 text-xs text-zinc-500">
                  <DateRelative timestamp={event.timestamp} />
                  <ChainLogo chainId={chainId} width={14} height={14} />
                </div>
                <ProjectLink
                  href={href}
                  projectHint={{
                    name,
                    logoUri: project.logoUri ?? null,
                    tagline: project.projectTagline ?? null,
                  }}
                  className="mt-1 block truncate text-sm font-medium hover:text-teal-600"
                >
                  {name}
                </ProjectLink>
                <p className="mt-1 text-sm text-zinc-600">{activityDescription(event)}</p>
              </div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function HeroColumn() {
  return (
    <section className="flex min-h-[460px] min-w-0 max-w-full flex-col items-center justify-between overflow-hidden bg-teal-50 p-6 text-center">
      <div className="min-w-0 max-w-full">
        <Image
          src="/assets/img/revnet-full-bw.svg"
          alt="Revnet"
          width={1509}
          height={140}
          className="mx-auto h-auto min-w-0 max-w-full object-contain"
        />
        <p className="mt-7 max-w-full break-words text-xl font-medium">
          An investible business model for the open web.
        </p>
        <Link
          href="/create"
          className="mt-7 inline-flex min-h-12 items-center bg-teal-500 px-5 text-lg hover:bg-teal-600"
        >
          Create yours
        </Link>
        <AuditPromptLink className="mt-5 block text-sm text-zinc-600" />
      </div>
      <Image
        src="/assets/img/hovercar-cutout.webp"
        alt=""
        width={1619}
        height={971}
        className="mt-8 h-auto min-w-0 max-w-full object-contain"
      />
    </section>
  );
}
