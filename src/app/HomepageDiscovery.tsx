import {
  mapActivityEvents,
  type ActivityEventItem,
} from "@/app/[slug]/components/ActivityFeed/mapActivityEvents";
import { AuditPromptLink } from "@/components/AuditPromptLink";
import { ChainLogo } from "@/components/ChainLogo";
import { DateRelative } from "@/components/DateRelative";
import { IpfsImage } from "@/components/IpfsImage";
import { ProjectLink } from "@/components/ProjectLink";
import { ActivityEventsOperation, IndexedProjectsOperation } from "@/lib/bendystraw/operations";
import { queryBendystraw } from "@/lib/bendystraw/query.server";
import type { ActivityEventsQuery, IndexedProjectSummary } from "@/lib/bendystraw/types";
import { mainnet } from "@/lib/chains";
import { formatCompact } from "@/lib/number";
import { formatEthAddress } from "@/lib/utils";
import { JB_CHAINS, type JBChainId } from "@bananapus/nana-sdk-core";
import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";
import { formatUnits } from "viem";
import { HomepageDiscoveryLayout } from "./HomepageDiscoveryLayout";
import { TopProjectsTable } from "./TopProjectsTable";

type RawActivity = ActivityEventsQuery["activityEvents"]["items"][number];

async function getHomepageProjects() {
  try {
    const data = await queryBendystraw(mainnet.id, IndexedProjectsOperation, {
      where: { version: 6, isRevnet: true },
      orderBy: "trendingScore",
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
      <div className="min-h-[420px] overflow-hidden border border-teal-100 bg-teal-50 xl:h-[calc(100svh-12rem)] xl:min-h-[520px] xl:overflow-y-auto">
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
    <ol className="divide-y divide-teal-100">
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
                loading={index < 4 ? "eager" : "lazy"}
                fetchPriority={index < 4 ? "high" : "auto"}
                className="size-10 shrink-0 object-cover"
                fallback={<div className="size-10 shrink-0 bg-teal-100" />}
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium group-hover:text-teal-600">
                  {name}
                </span>
                <span
                  className="mt-0.5 block truncate text-xs text-zinc-500"
                  title={`${project.trendingPaymentsCount ?? 0} recent payments; ${formatRecentVolume(project)} recent volume`}
                >
                  {(project.trendingPaymentsCount ?? 0).toLocaleString("en-US")} recent payments
                  {" · "}
                  {formatRecentVolume(project)} recent volume
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

type HomepageActivity = ReturnType<typeof mapActivityEvents>[number];

function activityDescription(event: HomepageActivity, projectTokenSymbol: string) {
  switch (event.type) {
    case "in":
      return `got ${event.tokenCount} ${projectTokenSymbol}`;
    case "out":
      return `cashed out ${event.tokenCount} ${projectTokenSymbol}`;
    case "addToBalance":
      return "added to balance";
    case "swapBuy":
      return `bought ${event.tokenCount} ${projectTokenSymbol} through the market`;
    case "swapSell":
      return `sold ${event.tokenCount} ${projectTokenSymbol} through the market`;
    case "payout":
      return "sent payouts";
    case "rulesetQueued":
      return "reconfigured the revnet";
    case "projectCreate":
      return "created the revnet";
    case "buybackPool":
      return "set the buyback pool";
    default:
      return event.type === "autoIssue"
        ? `auto-issued ${event.tokenCount} ${projectTokenSymbol}`
        : "updated the revnet";
  }
}

function ActivityRows({ events }: { events: RawActivity[] }) {
  if (!events.length)
    return (
      <p className="flex min-h-[420px] items-center justify-center px-6 text-center text-sm text-zinc-500">
        No recent activity yet.
      </p>
    );
  const mappedById = new Map(
    mapActivityEvents(events as ActivityEventItem[], (event) => ({
      tokenSymbol: event.project?.tokenSymbol,
      decimals: event.project?.decimals,
      denominateInUsd: false,
    })).map((event) => [event.id, event]),
  );

  return (
    <ol className="divide-y divide-teal-100">
      {events.map((event, index) => {
        const project = event.project!;
        const chainId = event.chainId as JBChainId;
        const name = project.name ?? `Project #${project.projectId}`;
        const href = `/${JB_CHAINS[chainId]?.slug ?? "eth"}:${project.projectId}`;
        const activity = mappedById.get(event.id);
        if (!activity) return null;
        const explorerUrl = JB_CHAINS[chainId]?.chain.blockExplorers?.default.url;
        const isInflow =
          activity.type === "in" || activity.type === "addToBalance" || activity.type === "swapBuy";
        const isOutflow = activity.type === "out" || activity.type === "swapSell";
        const tokenSymbol = project.tokenSymbol?.replace(/^\$+/, "") ?? "tokens";
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
                  width={46}
                  height={46}
                  loading={index < 4 ? "eager" : "lazy"}
                  fetchPriority={index < 4 ? "high" : "auto"}
                  className="size-[46px] object-cover"
                  fallback={<div className="size-[46px] bg-teal-100" />}
                />
              </ProjectLink>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2 text-xs text-zinc-500">
                  <DateRelative timestamp={event.timestamp} />
                  <div className="flex items-center gap-2">
                    {activity.baseAmount && (
                      <span title={activity.exactAmount}>
                        {activity.baseAmount}
                        {activity.baseTokenSymbol ? ` ${activity.baseTokenSymbol}` : ""}
                      </span>
                    )}
                    {isInflow && (
                      <span className="border border-teal-600 px-1 py-0.5 text-[10px] text-teal-600">
                        in
                      </span>
                    )}
                    {isOutflow && (
                      <span className="border border-orange-500 px-1 py-0.5 text-[10px] text-orange-500">
                        out
                      </span>
                    )}
                    <ChainLogo chainId={chainId} width={14} height={14} />
                  </div>
                </div>
                <ProjectLink
                  href={href}
                  projectHint={{
                    name,
                    logoUri: project.logoUri ?? null,
                    tagline: project.projectTagline ?? null,
                  }}
                  className="mt-1 block truncate text-sm font-medium text-teal-700 hover:underline"
                >
                  {name}
                </ProjectLink>
                <div className="mt-1 text-sm">
                  {explorerUrl ? (
                    <a
                      href={`${explorerUrl}/address/${activity.beneficiary}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline decoration-zinc-400 underline-offset-2 hover:text-teal-700"
                    >
                      {formatEthAddress(activity.beneficiary)}
                    </a>
                  ) : (
                    <span>{formatEthAddress(activity.beneficiary)}</span>
                  )}
                  <span className="text-zinc-700">
                    {" "}
                    {activityDescription(activity, tokenSymbol)}
                  </span>
                </div>
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
    <section className="flex min-h-[460px] min-w-0 max-w-full flex-col items-center overflow-hidden p-6 text-center xl:h-[calc(100svh-9rem)] xl:min-h-[570px] xl:overflow-y-auto">
      <Image
        src="/assets/img/hovercar-cutout.webp"
        alt=""
        width={1619}
        height={971}
        className="mb-10 h-auto max-h-[260px] min-w-0 max-w-full object-contain"
      />
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
    </section>
  );
}
