/**
 * The app's query retry rule: one more try, except for a rate limit from the Bendystraw proxy.
 * Every visitor shares the proxy's budget, so a 429 waits for the next refresh instead. The error
 * is told by its name, so the app shell does not load the indexer client for this.
 */
export function retryUnlessRateLimited(failureCount: number, error: unknown): boolean {
  const failure = error as { name?: string; status?: number } | null;
  if (failure?.name === "BendystrawRequestError" && failure.status === 429) return false;
  return failureCount < 1;
}
