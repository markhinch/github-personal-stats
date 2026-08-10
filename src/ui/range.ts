import type { Bucket, SeriesPoint } from '../core/types'

export type RangeId = '1y' | '2y' | 'all'

export const RANGE_OPTIONS: ReadonlyArray<{ value: RangeId; label: string }> = [
  { value: '1y', label: '1 year' },
  { value: '2y', label: '2 years' },
  { value: 'all', label: 'All time' },
]

/** Months spanned by each range; null is unbounded. */
const MONTHS: Record<RangeId, number | null> = { '1y': 12, '2y': 24, all: null }

const WEEKS_PER_MONTH = 365.25 / 12 / 7

/**
 * How many buckets of the given size the range spans — 12 months, or the 52
 * weeks that cover the same ground.
 */
export function bucketsInRange(range: RangeId, bucket: Bucket): number | null {
  const months = MONTHS[range]
  if (months === null) return null
  return bucket === 'month' ? months : Math.round(months * WEEKS_PER_MONTH)
}

/**
 * The first bucket key of the trailing window of `count` buckets, or null when
 * the window covers everything there is.
 *
 * Both metric series are windowed against this one key rather than each having
 * its own tail sliced off, because they don't span the same buckets — the first
 * merged PR postdates the first commit — and a chart and a stat tile describing
 * two different periods would be worse than either alone. Bucket keys sort
 * lexicographically by construction ("2026-07", "2026-W31"), so a string
 * comparison is a chronological one.
 */
export function windowStartKey(
  seriesList: ReadonlyArray<readonly SeriesPoint[]>,
  count: number | null,
): string | null {
  if (count === null) return null
  const keys = [...new Set(seriesList.flatMap((s) => s.map((p) => p.key)))].sort()
  if (keys.length <= count) return null
  return keys[keys.length - count] ?? null
}

/**
 * Generic over the point type: the total series and the per-repo series are
 * windowed against the same key, and only the sortable `key` is involved.
 */
export function windowSeries<T extends { key: string }>(
  series: readonly T[],
  startKey: string | null,
): T[] {
  return startKey === null ? [...series] : series.filter((p) => p.key >= startKey)
}
