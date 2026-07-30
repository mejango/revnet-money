/** Shape-preserving LTTB downsampling which always keeps first and latest. */
export function downsampleTimeSeries<T>(
  rows: readonly T[],
  maxPoints: number,
  xOf: (row: T) => number,
  yOf: (row: T) => number,
): T[] {
  if (rows.length <= maxPoints) return rows.slice();
  if (maxPoints < 3) return [rows[0], rows[rows.length - 1]].slice(0, maxPoints);
  const sampled: T[] = [rows[0]];
  const width = (rows.length - 2) / (maxPoints - 2);
  let anchor = 0;
  const y = (row: T) => {
    const value = yOf(row);
    return Number.isFinite(value) ? value : 0;
  };
  for (let bucket = 0; bucket < maxPoints - 2; bucket += 1) {
    const avgStart = Math.floor((bucket + 1) * width) + 1;
    const avgEnd = Math.min(Math.floor((bucket + 2) * width) + 1, rows.length);
    let avgX = 0;
    let avgY = 0;
    const count = Math.max(avgEnd - avgStart, 1);
    for (let i = avgStart; i < avgEnd; i += 1) {
      avgX += xOf(rows[i]);
      avgY += y(rows[i]);
    }
    avgX /= count;
    avgY /= count;
    const start = Math.floor(bucket * width) + 1;
    const end = Math.min(Math.floor((bucket + 1) * width) + 1, rows.length - 1);
    let selected = start;
    let largest = -1;
    for (let i = start; i < end; i += 1) {
      const area = Math.abs(
        (xOf(rows[anchor]) - avgX) * (y(rows[i]) - y(rows[anchor])) -
          (xOf(rows[anchor]) - xOf(rows[i])) * (avgY - y(rows[anchor])),
      );
      if (area > largest) {
        largest = area;
        selected = i;
      }
    }
    sampled.push(rows[selected]);
    anchor = selected;
  }
  sampled.push(rows[rows.length - 1]);
  return sampled;
}
