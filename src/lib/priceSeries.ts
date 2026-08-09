export type PriceSeriesPoint = {
  timestamp: number;
  value: number;
};

/**
 * A time-weighted display of exact post-trade pool spots. Short-lived prices
 * contribute only for the time they were actually in force, while the exact
 * opening and latest values remain pinned to the line's endpoints.
 */
export function smoothPriceSeries(points: PriceSeriesPoint[], maxBuckets = 96): PriceSeriesPoint[] {
  const sorted = points
    .filter(
      (point) =>
        Number.isFinite(point.timestamp) && Number.isFinite(point.value) && point.value > 0,
    )
    .sort((a, b) => a.timestamp - b.timestamp)
    .reduce<PriceSeriesPoint[]>((deduped, point) => {
      if (deduped.at(-1)?.timestamp === point.timestamp) {
        deduped[deduped.length - 1] = point;
      } else {
        deduped.push(point);
      }
      return deduped;
    }, []);

  if (sorted.length < 4 || maxBuckets < 1) return sorted;

  const start = sorted[0].timestamp;
  const end = sorted.at(-1)!.timestamp;
  const duration = end - start;
  if (!(duration > 0)) return sorted;

  const bucketCount = Math.min(maxBuckets, Math.max(2, (sorted.length - 1) * 2));
  const bucketWidth = duration / bucketCount;
  const smoothed: PriceSeriesPoint[] = [{ timestamp: start, value: sorted[0].value }];
  let eventIndex = 1;
  let currentValue = sorted[0].value;

  for (let bucket = 0; bucket < bucketCount; bucket += 1) {
    const bucketStart = start + bucket * bucketWidth;
    const bucketEnd = bucket === bucketCount - 1 ? end : start + (bucket + 1) * bucketWidth;

    while (eventIndex < sorted.length && sorted[eventIndex].timestamp <= bucketStart) {
      currentValue = sorted[eventIndex].value;
      eventIndex += 1;
    }

    let cursor = bucketStart;
    let weightedTotal = 0;
    let nextIndex = eventIndex;
    let bucketValue = currentValue;
    while (nextIndex < sorted.length && sorted[nextIndex].timestamp < bucketEnd) {
      const event = sorted[nextIndex];
      weightedTotal += bucketValue * (event.timestamp - cursor);
      cursor = event.timestamp;
      bucketValue = event.value;
      nextIndex += 1;
    }
    weightedTotal += bucketValue * (bucketEnd - cursor);
    currentValue = bucketValue;
    eventIndex = nextIndex;

    smoothed.push({
      timestamp: bucketStart + (bucketEnd - bucketStart) / 2,
      value: weightedTotal / (bucketEnd - bucketStart),
    });
  }

  const latest = sorted.at(-1)!;
  smoothed.push({ timestamp: end, value: latest.value });
  return smoothed;
}
