import "server-only";

import type { IndexedReadResult } from "@/lib/projectIndexStatus";
import { QueryClient } from "@tanstack/react-query";

// Public indexed display data only. A stale fetch waits for its replacement;
// Next's stale-while-revalidate cache could keep an old success through an outage.
const displayCache = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, gcTime: 5 * 60_000, retry: false },
  },
});

type DisplayKey = readonly ["project", number, number] | readonly ["group", number, string];

class IncompleteIndexedRead extends Error {
  constructor(readonly result: IndexedReadResult<unknown>) {
    super("Indexed display data is incomplete");
  }
}

/** Missing, incomplete and failed reads must remain retryable on the next request. */
export async function cachedIndexedDisplay<T>(
  key: DisplayKey,
  read: () => Promise<IndexedReadResult<T>>,
): Promise<IndexedReadResult<T>> {
  try {
    return await displayCache.fetchQuery({
      queryKey: key,
      queryFn: async () => {
        const result = await read();
        if (result.status !== "available") throw new IncompleteIndexedRead(result);
        return result;
      },
    });
  } catch (error) {
    if (error instanceof IncompleteIndexedRead) return error.result as IndexedReadResult<T>;
    throw error;
  }
}

export type ProjectDisplayRef = { chainId: number; projectId: number; groupId?: string };

/**
 * Cancel old fills as well as evicting successes, so a pre-update read cannot
 * repopulate the entry after refresh. Other server processes expire within 30s.
 */
export function invalidateProjectDisplay(refs: readonly ProjectDisplayRef[]): void {
  const groupIds = new Set(refs.flatMap((ref) => (ref.groupId ? [ref.groupId] : [])));
  for (const ref of refs) {
    const cached = displayCache.getQueryData<IndexedReadResult<{ suckerGroupId: string }>>([
      "project",
      ref.chainId,
      ref.projectId,
    ]);
    if (cached?.data?.suckerGroupId) groupIds.add(cached.data.suckerGroupId);
  }

  displayCache.removeQueries({
    predicate: (query) => {
      const [family, chainId, id] = query.queryKey;
      if (family === "project") {
        return refs.some((ref) => ref.chainId === chainId && ref.projectId === id);
      }
      if (family !== "group") return false;
      // Pending groups have no membership evidence yet. Drop these as well,
      // rather than allowing an older in-flight group to win after invalidation.
      if (query.state.fetchStatus === "fetching" || groupIds.has(String(id))) return true;
      const result = query.state.data as
        IndexedReadResult<{ projects?: { items?: ProjectDisplayRef[] } }> | undefined;
      return Boolean(
        result?.data?.projects?.items?.some((project) =>
          refs.some(
            (ref) => ref.chainId === project.chainId && ref.projectId === project.projectId,
          ),
        ),
      );
    },
  });
}
