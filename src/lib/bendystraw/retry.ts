/**
 * The app's query retry rule: one more try, except for an answer from the Bendystraw proxy. The
 * relay behind the proxy has already retried the indexer, and every visitor shares its budget.
 * The error is told by its name, so the app shell does not load the indexer client for this.
 */
export function retryUnlessProxied(failureCount: number, error: unknown): boolean {
  return (error as { name?: string } | null)?.name !== "BendystrawRequestError" && failureCount < 1;
}
