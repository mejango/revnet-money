"use client";

import { Button } from "@/components/ui/button";
import { useUserPermissions } from "@/hooks/useUserPermissions";
import type { Project } from "@/lib/bendystraw/types";
import { useJBProjectMetadataContext } from "@/lib/nana/project";
import { getProjectLinks } from "@/lib/projectLinks";
import dynamic from "next/dynamic";
import { ProjectLinks } from "./ProjectLinks";
import { RichPreview } from "./RichPreview";

// Only an account that can edit the metadata sees the editor, so it loads for that account.
const EditMetadataDialog = dynamic(
  () => import("./EditMetadataDialog").then((module) => module.EditMetadataDialog),
  {
    loading: () => (
      <Button variant="outline" size="sm" disabled>
        Edit metadata
      </Button>
    ),
  },
);

interface Props {
  projects: Array<Pick<Project, "projectId" | "token" | "chainId">>;
}

export function DescriptionSection({ projects }: Props) {
  const { metadata } = useJBProjectMetadataContext();
  const { hasPermission } = useUserPermissions();

  const { description } = metadata?.data ?? {};
  const canEditMetadata = hasPermission("SET_PROJECT_URI");

  const links = getProjectLinks(metadata?.data);

  return (
    <div className="max-w-screen-sm space-y-4">
      <div className="text-gray-600 text-base">
        <RichPreview source={description || ""} />
      </div>
      {links.length > 0 && <ProjectLinks links={links} />}
      {canEditMetadata && <EditMetadataDialog projects={projects} />}
    </div>
  );
}
