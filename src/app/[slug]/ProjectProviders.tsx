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
    };
    projects: readonly {
      chainId: number;
      projectId: number;
    }[];
  }>,
) {
  const initialProject: InitialProjectData = {
    metadata: {
      name: props.project.name ?? "",
      ...(props.project.logoUri ? { logoUri: props.project.logoUri } : {}),
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
