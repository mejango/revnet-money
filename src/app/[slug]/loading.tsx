"use client";

import { ProjectContentSkeleton } from "@/components/loading/LoadingSkeletons";
import { useSelectedLayoutSegment } from "next/navigation";

export default function Loading() {
  return <ProjectContentSkeleton segment={useSelectedLayoutSegment()} />;
}
