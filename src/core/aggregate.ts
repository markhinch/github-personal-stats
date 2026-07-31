import type { Bucket, Dataset, Metric, SeriesPoint } from './types'
import { orgOf } from './orgs'
import {
  bucketKeyOf, bucketKeyOfLocalDate, bucketLabelOf, bucketStartOf,
  fromDayNumber, toDayNumber,
} from './buckets'

export interface SeriesOptions {
  bucket: Bucket
  metric: Metric
  /** Orgs to include. An empty set yields an empty series. */
  orgs: Set<string>
}

/**
 * Aggregates the dataset into one contiguous, gap-filled series.
 *
 * Empty buckets are emitted with value 0 rather than omitted, so a quiet
 * stretch reads as quiet instead of being visually interpolated away.
 */
export function buildSeries(ds: Dataset, opts: SeriesOptions): SeriesPoint[] {
  const { bucket, metric, orgs } = opts
  const totals = new Map<string, number>()

  const record = (iso: string, repo: string, amount: number): void => {
    if (!orgs.has(orgOf(repo))) return
    const key = bucketKeyOf(iso, bucket)
    totals.set(key, (totals.get(key) ?? 0) + amount)
  }

  if (metric === 'commits') {
    for (const c of ds.commits) record(c.authoredAt, c.repo, 1)
  } else {
    for (const p of ds.mergedPrs) record(p.mergedAt, p.repo, p.additions + p.deletions)
  }

  if (totals.size === 0) return []

  const keys = [...totals.keys()].sort()
  const firstKey = keys[0]!
  const lastKey = keys[keys.length - 1]!

  // Walk day by day from the first bucket's start to the last bucket's start,
  // emitting each distinct bucket key in order. Day-stepping keeps this correct
  // across month lengths, leap years, and ISO week-year boundaries alike.
  const endDay = toDayNumber(bucketStartOf(lastKey, bucket))
  const out: SeriesPoint[] = []
  let seenKey: string | null = null

  for (let day = toDayNumber(bucketStartOf(firstKey, bucket)); day <= endDay; day++) {
    const key = bucketKeyOfLocalDate(fromDayNumber(day), bucket)
    if (key === seenKey) continue
    seenKey = key
    out.push({ key, label: bucketLabelOf(key, bucket), value: totals.get(key) ?? 0 })
  }

  return out
}
