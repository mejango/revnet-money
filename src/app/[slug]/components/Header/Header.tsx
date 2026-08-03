"use client";

import { ChainLogo } from "@/components/ChainLogo";
import EtherscanLink from "@/components/EtherscanLink";
import { ImageWithFallback, IpfsImage } from "@/components/IpfsImage";
import { FastForward as ForwardIcon } from "@/components/ui/icons";
import { useCompleteParticipants } from "@/hooks/useCompleteBendystrawLists";
import type { Project } from "@/lib/bendystraw/types";
import { formatShortDate } from "@/lib/date";
import {
  useJBChainId,
  useJBProject,
  useJBProjectMetadataContext,
  useJBTokenContext,
} from "@/lib/nana/project";
import { useSuckers } from "@/lib/nana/suckers";
import type { JBChainId } from "@/lib/nana/types";
import { Profile } from "@/lib/profile";
import { getProjectLinks } from "@/lib/projectLinks";
import { formatTokenSymbol } from "@/lib/utils";
import { JB_CHAINS } from "@bananapus/nana-sdk-core";
import Link from "next/link";
import { Suspense, use, useLayoutEffect, useMemo, useRef, useState } from "react";
import { participantCountSummary } from "../v6/owners/accounts/participantsAggregate";
import { TvlDatum } from "./TvlDatum";
import { Revalidating } from "@/components/ui/Revalidating";

interface Props {
  isRevnet: boolean;
  createdAt: number;
  operatorPromise: Promise<Profile | null>;
  projects: Array<
    Pick<
      Project,
      "chainId" | "projectId" | "token" | "decimals" | "balance" | "suckerGroupId" | "tokenSymbol"
    >
  >;
}

export function Header(props: Props) {
  const { isRevnet, operatorPromise, projects, createdAt } = props;
  const operator = use(operatorPromise);
  const chainId = useJBChainId();
  const project = useJBProject();
  const { metadata } = useJBProjectMetadataContext();
  const { token: tokenContext } = useJBTokenContext();

  const participantsQuery = useCompleteParticipants(
    {
      suckerGroupId: projects[0].suckerGroupId,
      balance_gt: "0",
    },
    Number(chainId),
    Boolean(projects[0].suckerGroupId),
  );

  const holderSummary = useMemo(
    () => participantCountSummary(participantsQuery.data, participantsQuery.data?.length),
    [participantsQuery.data],
  );
  const holderValue = participantsQuery.isError
    ? "—"
    : participantsQuery.isLoading
      ? "…"
      : `${holderSummary.count}${holderSummary.exact ? "" : "+"}`;
  // Restored from the last session: show the count now, mark it unconfirmed
  // until the 15s poll answers.
  const holdersPending =
    participantsQuery.isFetching && !participantsQuery.isLoading;
  const { data: suckers } = useSuckers();
  const { name: projectName, logoUri } = metadata?.data ?? {};
  const tokenSymbol = tokenContext?.data ? formatTokenSymbol(tokenContext) : undefined;
  const showProjectName =
    Boolean(projectName) &&
    (!tokenSymbol ||
      projectName?.normalize("NFKC").trim().toLocaleLowerCase() !==
        tokenSymbol.normalize("NFKC").trim().toLocaleLowerCase());

  // const totalSupply = useTotalOutstandingTokens();
  // const totalSupplyFormatted =
  //   totalSupply && token?.data
  //     ? formatUnits(totalSupply, token.data.decimals)
  //     : null;

  const links = getProjectLinks(metadata?.data);
  const website = links.find((link) => link.type === "infoUri");
  const metadataRef = useRef<HTMLDivElement>(null);
  const operatorRef = useRef<HTMLSpanElement>(null);
  const websiteRef = useRef<HTMLSpanElement>(null);
  const createdRef = useRef<HTMLSpanElement>(null);
  const chainsRef = useRef<HTMLSpanElement>(null);
  const [joinedMetadata, setJoinedMetadata] = useState({
    website: false,
    created: false,
    chains: false,
  });
  const hasOperator = operator != null;
  const hasWebsite = website != null;
  const hasCreated = Number(createdAt) > 0;
  const hasSuckers = Boolean(suckers?.length);

  useLayoutEffect(() => {
    const updateSeparators = () => {
      const operatorElement = operatorRef.current;
      const websiteElement = websiteRef.current;
      const createdElement = createdRef.current;
      const chainsElement = chainsRef.current;
      const previousCreatedElement = websiteElement ?? operatorElement;
      const previousChainsElement = createdElement ?? previousCreatedElement;
      const nextJoinedMetadata = {
        website:
          operatorElement != null &&
          websiteElement != null &&
          operatorElement.offsetTop === websiteElement.offsetTop,
        created:
          previousCreatedElement != null &&
          createdElement != null &&
          previousCreatedElement.offsetTop === createdElement.offsetTop,
        chains:
          previousChainsElement != null &&
          chainsElement != null &&
          previousChainsElement.offsetTop === chainsElement.offsetTop,
      };

      setJoinedMetadata((current) =>
        current.website === nextJoinedMetadata.website &&
        current.created === nextJoinedMetadata.created &&
        current.chains === nextJoinedMetadata.chains
          ? current
          : nextJoinedMetadata,
      );
    };

    updateSeparators();
    const metadataElement = metadataRef.current;
    if (!metadataElement) return;
    const observer = new ResizeObserver(updateSeparators);
    observer.observe(metadataElement);
    return () => observer.disconnect();
  }, [hasOperator, hasWebsite, hasCreated, hasSuckers]);

  return (
    <header>
      <div className="flex flex-col items-start gap-4 sm:mb-6 sm:flex-row sm:items-center sm:gap-6 mb-4">
        <IpfsImage
          src={logoUri}
          className="block size-[120px] overflow-hidden border border-zinc-200 object-cover sm:size-36"
          alt={`${projectName || "Project"} logo`}
          width={144}
          height={144}
          fallback={
            <ImageWithFallback
              src={chainId && project ? `/api/project-image/${chainId}/${project.projectId}` : null}
              className="block size-[120px] overflow-hidden border border-zinc-200 object-cover sm:size-36"
              alt={`${projectName || "Project"} logo`}
              width={144}
              height={144}
              fallback={
                <div className="flex h-[120px] w-[120px] items-center justify-center rounded bg-zinc-100 sm:size-36">
                  <ForwardIcon className="h-5 w-5 text-black" />
                </div>
              }
            />
          }
        />

        <div className="min-w-0 flex-1">
          <h1 className="mb-2 flex flex-row flex-wrap items-baseline gap-x-[1ch] gap-y-1 font-mono text-3xl">
            <span className="font-bold">
              {tokenContext?.data ? (
                <EtherscanLink
                  value={tokenContext.data.address}
                  type="token"
                  chain={chainId ? JB_CHAINS[chainId].chain : undefined}
                  className="inline-flex min-h-11 items-center sm:min-h-0"
                >
                  {tokenSymbol}
                </EtherscanLink>
              ) : null}
            </span>
            {showProjectName ? <span className="font-medium">{projectName}</span> : null}
          </h1>
          {!isRevnet ? (
            <p className="text-base leading-relaxed text-zinc-700">
              This project isn&apos;t a revnet. Try looking for it on{" "}
              <Link className="underline underline-offset-4" href="https://juicebox.money">
                https://juicebox.money
              </Link>
              .
            </p>
          ) : null}
          {isRevnet ? (
            <>
              <div className="flex flex-row flex-wrap items-center gap-x-4 gap-y-1">
                <TvlDatum projects={projects} />
                <span aria-hidden className="text-lg text-zinc-300 sm:text-xl">
                  |
                </span>
                <div className="sm:text-xl text-lg">
                  <span
                    className="font-medium text-black-500"
                    title={
                      participantsQuery.isError
                        ? "Owner data is unavailable."
                        : holderSummary.exact
                          ? undefined
                          : "At least this many unique owners were found before the indexer result cap."
                    }
                  >
                    <Revalidating pending={holdersPending}>{holderValue}</Revalidating>
                  </span>{" "}
                  <span className="text-zinc-500">
                    {holderSummary.exact && holderSummary.count === 1 ? "owner" : "owners"}
                  </span>
                </div>
                {/* <div className="sm:text-xl text-lg">
              <span className="font-medium text-black-500">
                {`${prettyNumber(totalSupplyFormatted ?? 0)}`}
              </span>{" "}
              <span className="text-zinc-500">{formatTokenSymbol(token)} outstanding</span>
            </div> */}
                {/* <div className="sm:text-xl text-lg">
              <span className="font-medium text-black-500">
                {!cashOutLoading
                  ? `$${Number(cashOutValue).toFixed(4)}`
                  : "..."}
              </span>{" "}
              <span className="text-zinc-500">cash out value</span>
            </div> */}
              </div>
              <Suspense>
                {(operator || website || hasCreated || suckers?.length) && (
                  <div
                    ref={metadataRef}
                    className="mt-1.5 flex flex-wrap items-center gap-x-5 text-[15px] text-zinc-700"
                  >
                    {operator && (
                      <span ref={operatorRef} className="inline-flex items-center">
                        <span className="text-zinc-500">Operator:</span>
                        <EtherscanLink
                          value={operator.address}
                          className="ml-1 inline-flex min-h-11 items-center font-medium text-zinc-900 sm:min-h-0"
                        >
                          {operator.displayName}
                        </EtherscanLink>
                      </span>
                    )}
                    {website && (
                      <span ref={websiteRef} className="relative inline-flex items-center">
                        {joinedMetadata.website ? (
                          <span
                            aria-hidden
                            className="absolute -left-2.5 top-1/2 h-4 w-px -translate-y-1/2 bg-zinc-300"
                          />
                        ) : null}
                        <span className="text-zinc-500">Site:</span>
                        <a
                          href={website.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="ml-1 inline-flex min-h-11 items-center font-medium text-zinc-900 hover:underline sm:min-h-0"
                        >
                          {website.url.replace(/^https?:\/\//, "")}
                        </a>
                      </span>
                    )}
                    {hasCreated ? (
                      <span ref={createdRef} className="relative inline-flex items-center">
                        {joinedMetadata.created ? (
                          <span
                            aria-hidden
                            className="absolute -left-2.5 top-1/2 h-4 w-px -translate-y-1/2 bg-zinc-300"
                          />
                        ) : null}
                        <span className="text-zinc-500">Created:</span>
                        <span className="ml-1 font-medium text-zinc-900">
                          {formatShortDate(new Date(createdAt * 1000))}
                        </span>
                      </span>
                    ) : null}
                    {suckers?.length ? (
                      <span ref={chainsRef} className="relative inline-flex items-center">
                        {joinedMetadata.chains ? (
                          <span
                            aria-hidden
                            className="absolute -left-2.5 top-1/2 h-4 w-px -translate-y-1/2 bg-zinc-300"
                          />
                        ) : null}
                        <span className="text-zinc-500">On:</span>
                        <span className="ml-0.5 inline-flex items-center">
                          {suckers.map((pair) => {
                            const networkSlug = JB_CHAINS[pair.peerChainId].slug;
                            return (
                              <Link
                                key={networkSlug}
                                href={`/${networkSlug}:${pair.projectId}`}
                                className="inline-flex min-h-11 items-center justify-center px-1 transition-opacity hover:opacity-70 sm:min-h-0"
                              >
                                <ChainLogo
                                  chainId={pair.peerChainId as JBChainId}
                                  width={18}
                                  height={18}
                                  standalone
                                />
                              </Link>
                            );
                          })}
                        </span>
                      </span>
                    ) : null}
                  </div>
                )}
              </Suspense>
            </>
          ) : null}
        </div>
      </div>
    </header>
  );
}
