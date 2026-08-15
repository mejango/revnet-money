import { IndexedProjectsOperation } from "@/lib/bendystraw/operations";
import { queryBendystraw } from "@/lib/bendystraw/query.server";
import type { IndexedProjectSummary } from "@/lib/bendystraw/types";
import { slugFor } from "@/lib/slug";
import type { MetadataRoute } from "next";

// Revnet pages are reached through search and client-side discovery, so a crawler has
// no path to them. The sitemap is that path.
export const revalidate = 3600;

const siteOrigin = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3002";
const STATIC_PATHS = ["/", "/discover", "/learn", "/build", "/create", "/audit"];
const PAGE_LIMIT = 250;
// ponytail: 2,000 revnets is far past today's count; raise it when that stops being true.
const MAX_PAGES = 8;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const entries: MetadataRoute.Sitemap = STATIC_PATHS.map((path) => ({
    url: new URL(path, siteOrigin).href,
    changeFrequency: path === "/" ? "daily" : "monthly",
    priority: path === "/" ? 1 : 0.6,
  }));

  // An indexer outage must not 500 the sitemap — the static routes still index.
  try {
    const seen = new Set<string>();
    for (let page = 0; page < MAX_PAGES; page++) {
      const data = await queryBendystraw(1, IndexedProjectsOperation, {
        where: { AND: [{ version: 6 }, { isRevnet: true }] },
        orderBy: "createdAt",
        orderDirection: "desc",
        limit: PAGE_LIMIT,
        offset: page * PAGE_LIMIT,
      });
      const items: IndexedProjectSummary[] = data.projects.items;
      if (!items.length) break;
      for (const project of items) {
        // One entry per sucker group: the same revnet on four chains renders four
        // near-identical pages, and listing them all invites a duplicate-content penalty.
        const key = project.suckerGroupId ?? `${project.chainId}:${project.projectId}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const slug = slugFor(project.chainId, project.projectId);
        if (!slug) continue;
        entries.push({
          url: new URL(`/${slug}`, siteOrigin).href,
          changeFrequency: "daily",
          priority: 0.8,
        });
      }
      if (items.length < PAGE_LIMIT) break;
    }
  } catch {
    // Fall through with the static routes.
  }

  return entries;
}
