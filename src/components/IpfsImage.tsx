"use client";

import { ipfsMediaGatewayUrls, ipfsUriToAppUrl } from "@/lib/ipfs";
import { safeDataImageUrl } from "@/lib/safe-data-image";
import type { ImgHTMLAttributes, ReactNode } from "react";
import { useState } from "react";

type Props = Omit<ImgHTMLAttributes<HTMLImageElement>, "onError" | "src"> & {
  alt: string;
  fallback: ReactNode;
  src: string | null | undefined;
};

export function ImageWithFallback({ alt, fallback, src, ...props }: Props) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);

  if (!src || failedSrc === src) return fallback;

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      {...props}
      src={src}
      alt={alt}
      decoding={props.decoding ?? (props.loading === "eager" ? "sync" : "async")}
      referrerPolicy="no-referrer"
      onError={() => setFailedSrc(src)}
    />
  );
}

/**
 * Render only CID-validated IPFS media, without involving Next's image
 * optimizer. The same-origin media route bounds gateway work and response
 * bytes; a failed browser load becomes an intentional UI fallback rather than
 * a broken-image icon.
 */
export function IpfsImage({ alt, fallback, src, ...props }: Props) {
  const inlineSrc = safeDataImageUrl(src);
  const appSrc = ipfsUriToAppUrl(src);
  const mediaCacheSrc = ipfsMediaGatewayUrls(src)[0];
  // The same-origin route leads. A public gateway that HANGS rather than
  // failing never fires onError, so putting one first strands the image on a
  // blank frame forever — which is exactly what the CID subdomain cache does
  // when it is cold. The route bounds its own gateway work and answers
  // immutable, so it is both the safer and the faster first choice.
  const candidates = [
    ...new Set([inlineSrc, appSrc, mediaCacheSrc].filter((url): url is string => !!url)),
  ];
  const [failedSources, setFailedSources] = useState<string[]>([]);
  const safeSrc = candidates.find((candidate) => !failedSources.includes(candidate));

  if (!safeSrc) return fallback;

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      {...props}
      src={safeSrc}
      alt={alt}
      decoding={props.decoding ?? (props.loading === "eager" ? "sync" : "async")}
      referrerPolicy="no-referrer"
      onError={() => setFailedSources((failed) => [...failed, safeSrc])}
    />
  );
}
