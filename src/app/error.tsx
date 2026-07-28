"use client";

import { useEffect } from "react";

/** True for the failure modes a fresh page load reliably fixes: a stale or
    cold-start-interrupted chunk/RSC fetch. */
function isStaleDeploymentError(error: Error) {
  return (
    error.name === "ChunkLoadError" ||
    /Loading chunk .* failed|Failed to fetch dynamically imported module|import\(\) failed/i.test(
      error.message,
    )
  );
}

export default function AppError({ error, reset }: { error: Error; reset: () => void }) {
  useEffect(() => {
    if (isStaleDeploymentError(error)) window.location.reload();
  }, [error]);

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-8 text-center">
      <h1 className="text-lg font-semibold">Something went wrong loading this page.</h1>
      <p className="max-w-md text-sm text-zinc-600">
        This is usually a hiccup while the app wakes up. Trying again almost always fixes it.
      </p>
      <button
        type="button"
        onClick={() => {
          reset();
          window.location.reload();
        }}
        className="bg-teal-500 px-4 py-2 text-sm font-medium text-melon-950 hover:bg-teal-600"
      >
        Reload
      </button>
    </main>
  );
}
