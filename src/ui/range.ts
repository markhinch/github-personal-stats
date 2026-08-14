import type { Bucket, SeriesPoint } from '../core/types'

export type RangeId = '1w' | '1m' | '3m' | '6m' | '1y' | '2y' | 'all'

/** Shortest first, so the row reads as one axis from recent to everything. */
export const RANGE_OPTIONS: ReadonlyArray<{ value: RangeId; label: string }> = [
  { value: '1w', label: '1 week' },
  { value: '1m', label: '1 month' },
  { value: '3m', label: '3 months' },
  { value: '6m', label: '6 months' },
  { value: '1y', label: '1 year' },
  { value: '2y', label: '2 years' },
  { value: 'all', label: 'All time' },
]

const DAYS_PER_MONTH = 365.25 / 12

/** Days spanned by each range; null is unbounded. */
const DAYS: Record<RangeId, number | null> = {
  '1w': 7,
  '1m': DAYS_PER_MONTH,
  '3m': 3 * DAYS_PER_MONTH,
  '6m': 6 * DAYS_PER_MONTH,
  '1y': 12 * DAYS_PER_MONTH,
  '2y': 24 * DAYS_PER_MONTH,
  all: null,
}

/**
 * How many buckets of the given size the range spans — 12 months, the 52
 * weeks, or the ~365 days that cover the same ground.
 *
 * Never rounds down to 0: a range shorter than one bucket (e.g. 1 week
 * bucketed by month) still spans that single, partial bucket. 0 would be
 * indistinguishable from unbounded to windowStartKey, which reads a null
 * count as "show everything" — the opposite of what a short range asks for.
 */
export function bucketsInRange(range: RangeId, bucket: Bucket): number | null {
  const days = DAYS[range]
  if (days === null) return null
  if (bucket === 'day') return Math.max(1, Math.round(days))
  if (bucket === 'week') return Math.max(1, Math.round(days / 7))
  return Math.max(1, Math.round(days / DAYS_PER_MONTH))
}

/** Ranges short enough that a day-by-day breakdown is still legible. */
export function supportsDayBucket(range: RangeId): boolean {
  return range === '1w' || range === '1m'
}

/**
 * The bucket to land on after switching to `range`: forced to day entering a
 * day-capable range, and off day again — back to week — when leaving one,
 * since the day option disappears from the control along with it.
 */
export function nextBucket(range: RangeId, currentBucket: Bucket): Bucket {
  if (supportsDayBucket(range)) return 'day'
  return currentBucket === 'day' ? 'week' : currentBucket
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
