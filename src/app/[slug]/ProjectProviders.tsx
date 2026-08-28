"use client";

import { isSupportedChainId } from "@/app/constants";
import { OPEN_IPFS_GATEWAY_HOSTNAME } from "@/lib/ipfs";
import { ProjectProvider } from "@/lib/nana/project";
import type { InitialProjectData, SuckerPair } from "@/lib/nana/types";
import type { JBChainId } from "@bananapus/nana-sdk-core";
import { PropsWithChildren } from "react";

export function ProjectProviders(
  props: PropsWithChildren<{
    projectId: bigint;
    chainId: JBChainId;
    project: {
      name: string | null;
      logoUri: string | null;
      description?: string | null;
    };
    projects: readonly {
      chainId: number;
      projectId: number;
    }[];
  }>,
) {
  // Seed the description too, not just the name: without it the About section renders
  // nothing until the browser has fetched metadata from IPFS, so every crawler that
  // does not run JS sees a project page with no description on it.
  const initialProject: InitialProjectData = {
    metadata: {
      name: props.project.name ?? "",
      ...(props.project.logoUri ? { logoUri: props.project.logoUri } : {}),
      ...(props.project.description ? { description: props.project.description } : {}),
    },
  };
  const initialSuckers = props.projects
    .filter(
      (project): project is { chainId: JBChainId; projectId: number } =>
        isSupportedChainId(project.chainId) &&
        Number.isSafeInteger(project.projectId) &&
        project.projectId >= 0,
    )
    .map((project): SuckerPair => ({
      peerChainId: project.chainId,
      projectId: BigInt(project.projectId),
    }));

  return (
    <ProjectProvider
      projectId={props.projectId}
      chainId={props.chainId}
      initialProject={initialProject}
      initialSuckers={initialSuckers}
      ipfsGatewayHostname={OPEN_IPFS_GATEWAY_HOSTNAME}
    >
      {props.children}
    </ProjectProvider>
  );
}
