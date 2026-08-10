"use client";

import { useEffect, useRef } from "react";

export function useInfiniteScroll(loadMore: () => void, enabled: boolean) {
  const markerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const marker = markerRef.current;
    if (!marker || !enabled) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) loadMore();
      },
      { rootMargin: "240px 0px" },
    );
    observer.observe(marker);
    return () => observer.disconnect();
  }, [enabled, loadMore]);

  return markerRef;
}
