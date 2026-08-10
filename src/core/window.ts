/**
 * Restricts a series to the points at or after `startKey`.
 *
 * Generic over the point type: the total series and the per-repo series are
 * windowed against the same key, and only the sortable `key` is involved. A
 * core concern — it runs ahead of any ranking, e.g. in `buildRepoStack`, so
 * segments describe what is on screen rather than the dataset as a whole.
 */
export function windowSeries<T extends { key: string }>(
  series: readonly T[],
  startKey: string | null,
): T[] {
  return startKey === null ? [...series] : series.filter((p) => p.key >= startKey)
}
