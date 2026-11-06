"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";

function messageFor(pathname: string) {
  let path = pathname;
  try {
    path = decodeURIComponent(pathname);
  } catch {
    // A malformed escape is still worth echoing as typed.
  }
  const segments = path.split("/").filter(Boolean);
  if (segments[0] === "account" && segments[1]) return `No account matches ${segments[1]}.`;
  if (segments.length !== 1) return `Nothing at ${path}.`;
  return segments[0].startsWith("@")
    ? `No revnet has the handle ${segments[0]}.`
    : `No revnet at /${segments[0]}.`;
}

export function NotFoundMessage() {
  // The metadata of the layout that threw overwrites this page's own title after hydration.
  useEffect(() => {
    document.title = "Not found | Revnet";
  }, []);
  return <p className="mb-6 max-w-full break-words text-zinc-600">{messageFor(usePathname())}</p>;
}
