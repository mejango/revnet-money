"use client";

import { ChainLogo } from "@/components/ChainLogo";
import EtherscanLink from "@/components/EtherscanLink";
import { ImageWithFallback } from "@/components/IpfsImage";
import { FastForward as ForwardIcon } from "@/components/ui/icons";
import { ParticipantsOperation, useBendystrawQuery } from "@/lib/bendystraw";
import type { Project } from "@/lib/bendystraw/types";
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
import { TvlDatum } from "./TvlDatum";

interface Props {
  isRevnet: boolean;
  operatorPromise: Promise<Profile | null>;
  projects: Array<
    Pick<
      Project,
      "chainId" | "projectId" | "token" | "decimals" | "balance" | "suckerGroupId" | "tokenSymbol"
    >
  >;
}

export function Header(props: Props) {
  const { isRevnet, operatorPromise, projects } = props;
  const operator = use(operatorPromise);
  const chainId = useJBChainId();
  const project = useJBProject();
  const { metadata } = useJBProjectMetadataContext();
  const { token: tokenContext } = useJBTokenContext();

  const { data: participants } = useBendystrawQuery(
    ParticipantsOperation,
    {
      where: {
        suckerGroupId: projects[0].suckerGroupId,
        balance_gt: 0,
      },
      limit: 1000, // TODO will break once more than 1000 participants exist
    },
    { chainId: Number(chainId) },
  );

  const contributorsCount = useMemo(() => {
    // de-dupe participants who are on multiple chains
    const participantWallets = participants?.participants.items.reduce(
      (acc, curr) => (acc.includes(curr.address) ? acc : [...acc, curr.address]),
      [] as string[],
    );

    return participantWallets?.length;
  }, [participants?.participants]);

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
  const chainsRef = useRef<HTMLSpanElement>(null);
  const [joinedMetadata, setJoinedMetadata] = useState({ website: false, chains: false });
  const hasOperator = operator != null;
  const hasWebsite = website != null;
  const hasSuckers = Boolean(suckers?.length);

  useLayoutEffect(() => {
    const updateSeparators = () => {
      const operatorElement = operatorRef.current;
      const websiteElement = websiteRef.current;
      const chainsElement = chainsRef.current;
      const previousChainsElement = websiteElement ?? operatorElement;
      const nextJoinedMetadata = {
        website:
          operatorElement != null &&
          websiteElement != null &&
          operatorElement.offsetTop === websiteElement.offsetTop,
        chains:
          previousChainsElement != null &&
          chainsElement != null &&
          previousChainsElement.offsetTop === chainsElement.offsetTop,
      };

      setJoinedMetadata((current) =>
        current.website === nextJoinedMetadata.website &&
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
  }, [hasOperator, hasWebsite, hasSuckers]);

  return (
    <header>
      <div className="flex flex-col sm:flex-row sm:items-center items-start gap-4 sm:mb-6 mb-4">
        <ImageWithFallback
          src={
            chainId && project
              ? `/api/project-image/${chainId}/${project.projectId}`
              : logoUri
          }
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
                <div className="sm:text-xl text-lg">
                  <span className="font-medium text-black-500">{contributorsCount ?? 0}</span>{" "}
                  <span className="text-zinc-500">
                    {contributorsCount === 1 ? "owner" : "owners"}
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
                {(operator || website || suckers?.length) && (
                  <div
                    ref={metadataRef}
                    className="mt-1.5 flex flex-wrap items-center gap-x-5 text-[15px] text-zinc-700"
                  >
                    {operator && (
                      <span ref={operatorRef} className="inline-flex items-center">
                        <span className="text-zinc-500">Operator:</span>{" "}
                        <EtherscanLink
                          value={operator.address}
                          className="inline-flex min-h-11 items-center font-medium text-zinc-900 sm:min-h-0"
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
                        <span className="text-zinc-500">Site:</span>{" "}
                        <a
                          href={website.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex min-h-11 items-center font-medium text-zinc-900 hover:underline sm:min-h-0"
                        >
                          {website.url.replace(/^https?:\/\//, "")}
                        </a>
                      </span>
                    )}
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
