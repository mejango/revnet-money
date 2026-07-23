import type { Project } from "@/lib/bendystraw/types";

/** The sucker-group project rows the v6 tabs receive from their server pages. */
export type ProjectItem = Pick<Project, "projectId" | "token" | "chainId">;
