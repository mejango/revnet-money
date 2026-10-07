import { decodeProjectRouteSlug } from "./slug";

export function projectSubtabNavigation(slug: string, currentHref: string, key: string) {
  const url = new URL(currentHref);
  url.searchParams.set("subtab", key);
  return {
    href: url.href,
    mode: decodeProjectRouteSlug(slug)?.startsWith("@") ? "document" : "client",
  } as const;
}
