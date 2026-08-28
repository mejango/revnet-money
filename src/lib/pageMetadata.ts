import type { Metadata } from "next";

const siteOrigin = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3002";
// Preview deployments have no canonical domain, so they fall back to the Railway host
// that actually serves them.
const railwayDomain = process.env.RAILWAY_PUBLIC_DOMAIN?.trim();
const assetOrigin =
  process.env.NEXT_PUBLIC_SITE_URL ??
  (railwayDomain && /^[a-z0-9.-]+$/iu.test(railwayDomain)
    ? `https://${railwayDomain}`
    : siteOrigin);

const socialImage = {
  url: new URL("/assets/img/revnet-social.png", assetOrigin).href,
  width: 1428,
  height: 804,
  alt: "Revnet — an autonomous business model for the open web",
  type: "image/png",
};

/**
 * Title, description and a complete link-preview card for a static page.
 *
 * Next replaces the whole `openGraph` object rather than merging it, so a page that
 * sets only a title silently drops the root layout's image and downgrades the Twitter
 * card to `summary`. Every page that wants its own title has to restate the image.
 */
export function pageMetadata({
  title,
  description,
}: {
  title: string;
  description: string;
}): Metadata {
  return {
    title,
    description,
    openGraph: { title, description, type: "website", images: [socialImage] },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [socialImage.url],
    },
  };
}
