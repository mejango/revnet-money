"use client";

import { ResponsiveImage } from "@/components/ResponsiveImage";
import { ipfsUriToAppUrl } from "@/lib/ipfs";
import { safeDataImageUrl } from "@/lib/safe-data-image";
import type { ImgHTMLAttributes, ReactNode } from "react";
import { useState } from "react";

type Props = Omit<ImgHTMLAttributes<HTMLImageElement>, "onError" | "src" | "srcSet"> & {
  alt: string;
  fallback: ReactNode;
  src: string | null | undefined;
};

export function ImageWithFallback({ alt, fallback, src, ...props }: Props) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);

  if (!src || failedSrc === src) return fallback;

  return (
    <ResponsiveImage
      {...props}
      sizes={props.sizes ?? "100vw"}
      src={src}
      alt={alt}
      decoding={props.decoding ?? (props.loading === "eager" ? "sync" : "async")}
      referrerPolicy="no-referrer"
      onError={() => setFailedSrc(src)}
    />
  );
}

/**
 * Render only CID-validated IPFS or safe inline media. Delivery may use a
 * disposable derivative; failures retry the accepted original once before
 * displaying the intentional UI fallback.
 */
export function IpfsImage({ alt, fallback, src, ...props }: Props) {
  const inlineSrc = safeDataImageUrl(src);
  const centerSrc = ipfsUriToAppUrl(src);
  const candidates = [inlineSrc, centerSrc].filter((url): url is string => !!url);
  const [failedSources, setFailedSources] = useState<string[]>([]);
  const safeSrc = candidates.find((candidate) => !failedSources.includes(candidate));

  if (!safeSrc) return fallback;

  return (
    <ResponsiveImage
      {...props}
      sizes={props.sizes ?? "100vw"}
      src={safeSrc}
      alt={alt}
      decoding={props.decoding ?? (props.loading === "eager" ? "sync" : "async")}
      referrerPolicy="no-referrer"
      onError={() => setFailedSources((failed) => [...failed, safeSrc])}
    />
  );
}
