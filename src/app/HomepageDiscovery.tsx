import { AuditPromptLink } from "@/components/AuditPromptLink";
import { ChainLogo } from "@/components/ChainLogo";
import { IpfsImage } from "@/components/IpfsImage";
import { IssuanceFingerprint } from "@/components/IssuanceFingerprint";
import { ActivityFeedSkeleton } from "@/components/loading/LoadingSkeletons";
import { ProjectLink } from "@/components/ProjectLink";
import { Skeleton } from "@/components/ui/skeleton";
import { IndexedProjectsOperation } from "@/lib/bendystraw/operations";
import { queryBendystraw } from "@/lib/bendystraw/query.server";
import type { IndexedProjectSummary } from "@/lib/bendystraw/types";
import { mainnet } from "@/lib/chains";
import { getIssuanceFingerprint } from "@/lib/issuanceFingerprint.server";
import { formatCompact } from "@/lib/number";
import { fillIndexedMetadata } from "@/lib/projectMetadataFill.server";
import { JB_CHAINS, type JBChainId } from "@bananapus/nana-sdk-core";
import Image from "next/image";
import Link from "next/link";
import { Suspense, type ReactNode } from "react";
import { formatUnits, isAddress, type Address } from "viem";
import { getSuckerGroup } from "./[slug]/getSuckerGroup";
import { getHomepageActivityPage } from "./getHomepageActivity";
import { getHomepageReserves } from "./getHomepageReserves";
import { HomepageActivityFeed } from "./HomepageActivityFeed";
import { HomepageDiscoveryLayout } from "./HomepageDiscoveryLayout";
import { MarkeeAdvertisement } from "./MarkeeAdvertisement";
import { MarkeePlaceholder } from "./MarkeePlaceholder";
import { RotatingTagline } from "./RotatingTagline";
import { SecuredReserves } from "./SecuredReserves";
import { TopProjectsTable } from "./TopProjectsTable";

type HomepageProject = IndexedProjectSummary & {
  issuanceFingerprint: number[];
  chainIds?: JBChainId[];
};

async function getHomepageProjects(
  orderBy: "trendingScore" | "createdAt",
): Promise<HomepageProject[]> {
  try {
    const data = await queryBendystraw(mainnet.id, IndexedProjectsOperation, {
      where: { version: 6, isRevnet: true },
      orderBy,
      orderDirection: "desc",
      limit: 60,
      offset: 0,
    });
    const groups = new Set<string>();
    const projects = await fillIndexedMetadata(
      data.projects.items
        .filter((project) => {
          if (!project.isRevnet || groups.has(project.suckerGroupId)) return false;
          groups.add(project.suckerGroupId);
          return true;
        })
        .slice(0, 8),
    );
    return Promise.all(
      projects.map(async (project) => {
        const [issuanceFingerprint, group] = await Promise.all([
          getIssuanceFingerprint(project.projectId, project.chainId as JBChainId),
          orderBy === "trendingScore"
            ? getSuckerGroup(project.suckerGroupId, project.chainId, project.projectId)
            : undefined,
        ]);
        return {
          ...project,
          issuanceFingerprint,
          chainIds:
            orderBy === "trendingScore"
              ? [
                  ...new Set([
                    project.chainId,
                    ...(group?.projects?.items ?? [])
                      .filter(
                        (member) =>
                          member.version === project.version &&
                          member.suckerGroupId === project.suckerGroupId,
                      )
                      .map((member) => member.chainId),
                  ]),
                ]
                  .filter((chainId): chainId is JBChainId => chainId in JB_CHAINS)
                  .sort((a, b) => a - b)
              : undefined,
        };
      }),
    );
  } catch {
    return [];
  }
}

/**
 * The fold paints at once — hero, headings, panel frames — and each panel
 * streams in behind its own Suspense boundary with a ghost of its rows, so a
 * slow feed never blanks the page or holds the others back.
 */
export function HomepageDiscovery() {
  const siteHostname = new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3002")
    .hostname;
  const showMarkee = ["dev.revnet.money", "localhost", "127.0.0.1"].includes(siteHostname);
  const configuredBoard = process.env.NEXT_PUBLIC_MARKEE_RENT_BOARD_ADDRESS?.trim();
  const boardAddress =
    configuredBoard && isAddress(configuredBoard) ? (configuredBoard as Address) : undefined;
  return (
    <HomepageDiscoveryLayout
      hero={<HeroColumn />}
      summary={
        <Suspense fallback={<ReservesSkeleton />}>
          <ReservesPanel />
        </Suspense>
      }
      activity={
        <DashboardColumn
          title="Latest"
          headingClassName="hidden sm:flex"
          panelClassName="xl:h-auto xl:min-h-0 xl:flex-1"
        >
          <Suspense
            fallback={
              <div className="px-4 py-4">
                {/* Ghost rows must outrun the card, which fills the column on wide screens. */}
                <ActivityFeedSkeleton rows={14} />
              </div>
            }
          >
            <ActivityPanel />
          </Suspense>
        </DashboardColumn>
      }
      trending={
        <DashboardColumn title="Trending" headingClassName="hidden xl:flex">
          <Suspense fallback={<ProjectRowsSkeleton rows={8} />}>
            <TrendingPanel />
          </Suspense>
        </DashboardColumn>
      }
      top={
        <div className="flex min-h-0 flex-1 flex-col gap-5">
          {showMarkee ? (
            <MarkeeAdvertisement initialBoardAddress={boardAddress} />
          ) : (
            <MarkeePlaceholder />
          )}
          <DashboardColumn
            title="Top"
            headingClassName="hidden xl:flex"
            // Shares its column with the ad above, so it takes the room left, not the column's height.
            sectionClassName="xl:min-h-0 xl:flex-1"
            panelClassName="xl:h-auto xl:min-h-0 xl:flex-1"
          >
            <Suspense fallback={<ProjectRowsSkeleton rows={9} />}>
              <TopProjectsTable />
            </Suspense>
          </DashboardColumn>
        </div>
      }
      newProjects={
        <DashboardColumn
          title="New"
          headingClassName="hidden xl:flex"
          panelClassName="xl:h-auto xl:min-h-0 xl:flex-1"
        >
          <Suspense fallback={<ProjectRowsSkeleton rows={8} />}>
            <NewPanel />
          </Suspense>
        </DashboardColumn>
      }
    />
  );
}

async function ReservesPanel() {
  return <SecuredReserves data={await getHomepageReserves()} />;
}

async function ActivityPanel() {
  const activity = await getHomepageActivityPage(9);
  return (
    <HomepageActivityFeed
      initialEvents={activity.slice(0, 8)}
      initialHasMore={activity.length > 8}
    />
  );
}

async function TrendingPanel() {
  return (
    <ProjectRows
      projects={await getHomepageProjects("trendingScore")}
      detail={(project) => (
        <>
          <span className="block text-[10px] uppercase tracking-wide text-zinc-400">Recent</span>
          <span className="block">
            Payments:{" "}
            <span className="tabular-nums text-zinc-600">
              {(project.trendingPaymentsCount ?? 0).toLocaleString("en-US")}
            </span>
          </span>
          <span className="block">
            Volume:{" "}
            <span className="tabular-nums text-zinc-600">{formatRecentVolume(project)}</span>
          </span>
        </>
      )}
    />
  );
}

async function NewPanel() {
  return (
    <ProjectRows
      projects={await getHomepageProjects("createdAt")}
      detail={(project) => (
        <span className="block">
          Launched:{" "}
          <span className="tabular-nums text-zinc-600">{formatLaunched(project.createdAt)}</span>
        </span>
      )}
    />
  );
}

function ReservesSkeleton() {
  return (
    <div role="status" aria-label="Loading reserves" className="space-y-3">
      <span className="sr-only">Loading reserves</span>
      <Skeleton className="h-10 w-48 sm:h-9" />
      <Skeleton className="h-3 w-32" />
    </div>
  );
}

/** Ghost rows matching the project rows' geometry, so the fill is in place. */
function ProjectRowsSkeleton({ rows }: { rows: number }) {
  return (
    <ol className="divide-y divide-teal-100" role="status" aria-label="Loading projects">
      <span className="sr-only">Loading projects</span>
      {Array.from({ length: rows }, (_, index) => (
        <li key={index} className="flex h-28 items-center gap-3 px-4 py-3" aria-hidden="true">
          <Skeleton className="h-3 w-3 shrink-0" />
          <Skeleton className="size-10 shrink-0" />
          <div className="min-w-0 flex-1 space-y-2">
            <Skeleton className={index % 2 === 0 ? "h-3 w-36" : "h-3 w-28"} />
            <Skeleton className="h-2.5 w-24" />
            <Skeleton className="h-2.5 w-32" />
          </div>
        </li>
      ))}
    </ol>
  );
}

function DashboardColumn({
  title,
  children,
  headingClassName,
  panelClassName = "",
  sectionClassName = "xl:h-full",
}: {
  title: string;
  children: ReactNode;
  headingClassName: string;
  panelClassName?: string;
  /** How the section takes its height on wide screens: the column's (default), or the room a stack leaves it. */
  sectionClassName?: string;
}) {
  const id = `home-${title.replaceAll(" ", "-").toLowerCase()}`;
  return (
    <section className={`flex min-w-0 flex-col ${sectionClassName}`} aria-labelledby={id}>
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

function ProjectRows({
  projects,
  detail,
}: {
  projects: HomepageProject[];
  detail: (project: HomepageProject) => ReactNode;
}) {
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
                  {detail(project)}
                </span>
              </span>
              <span className="flex shrink-0 flex-col items-center gap-1 2xl:flex-row">
                {(project.chainIds ?? [chainId]).map((memberChainId) => (
                  <ChainLogo
                    key={memberChainId}
                    chainId={memberChainId}
                    width={16}
                    height={16}
                    standalone
                  />
                ))}
              </span>
            </ProjectLink>
          </li>
        );
      })}
    </ol>
  );
}

/** Compact enough for the mono column: "just now", "7m ago", "3h ago", "12d ago". */
function formatLaunched(createdAt: number): string {
  const seconds = Math.max(0, Math.floor(Date.now() / 1000) - createdAt);
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

function formatRecentVolume(project: IndexedProjectSummary) {
  const integer = String(project.trendingVolume ?? 0).split(".")[0] || "0";
  const amount = formatUnits(BigInt(integer), project.decimals ?? 18);
  const symbol = project.tokenSymbol?.replace(/^\$+/, "");
  return `${formatCompact(amount)}${symbol ? ` ${symbol}` : ""}`;
}

function HeroColumn() {
  return (
    <section className="flex min-h-[460px] min-w-0 max-w-full flex-col items-center overflow-hidden px-6 pb-6 pt-1 text-center sm:pt-6 xl:h-[calc(100svh-9rem)] xl:min-h-[570px] xl:overflow-y-auto">
      <Image
        src="/assets/img/hovercar-cutout.webp"
        alt=""
        width={1619}
        height={971}
        // Phones keep the rocket close under the header; wider screens let it
        // drop toward the wordmark.
        className="mb-3 h-auto max-h-[260px] min-w-0 max-w-full translate-y-2 object-contain sm:translate-y-12"
      />
      <div className="@container w-full min-w-0 max-w-full">
        <Image
          src="/assets/img/revnet-full-bw.svg"
          alt="Revnet"
          width={1509}
          height={140}
          className="mx-auto h-auto min-w-0 max-w-full object-contain"
        />
        <p className="mt-7 max-w-full break-words text-[min(1.25rem,8cqi)] font-medium">
          A <RotatingTagline />
          <span className="block whitespace-nowrap">for the open web.</span>
        </p>
        <Link
          href="/create"
          className="mt-7 inline-flex min-h-12 items-center bg-teal-500 px-5 text-lg hover:bg-teal-600"
        >
          Create yours
        </Link>
        <AuditPromptLink className="mt-4 text-xs text-zinc-600 sm:whitespace-nowrap 2xl:text-sm" />
      </div>
    </section>
  );
}
