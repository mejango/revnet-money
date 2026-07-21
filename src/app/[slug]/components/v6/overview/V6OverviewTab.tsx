"use client";

import { DescriptionSection } from "../../../about/components/DescriptionSection";
import { ProjectItem } from "../shared";

// ponytail: temporary shell — replaced by the full website/-parity Overview
// (about card + other-info panel) in the v6 re-outfit waves.
export function V6OverviewTab({ projects }: { projects: ProjectItem[] }) {
  return <DescriptionSection projects={projects} />;
}
