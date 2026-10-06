/** Bound independent read checks and drain every worker before allowing a retry. */
export async function mapConcurrentChecks<T, R>(
  values: readonly T[],
  check: (value: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: PromiseSettledResult<R>[] = new Array(values.length);
  let next = 0;
  async function worker() {
    while (next < values.length) {
      const index = next++;
      try {
        results[index] = { status: "fulfilled", value: await check(values[index], index) };
      } catch (reason) {
        results[index] = { status: "rejected", reason };
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(2, values.length) }, worker));
  return results.map((result) => {
    if (result.status === "rejected") throw result.reason;
    return result.value;
  });
}
