import type { Bucket, Dataset, LinesPoint, Metric, SeriesPoint } from './types'
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
 * Every distinct bucket key from `firstKey`'s start through `lastKey`'s start,
 * in order.
 *
 * Walks day by day rather than bucket by bucket: day-stepping keeps this
 * correct across month lengths, leap years, and ISO week-year boundaries alike.
 */
function bucketKeysBetween(firstKey: string, lastKey: string, bucket: Bucket): string[] {
  const endDay = toDayNumber(bucketStartOf(lastKey, bucket))
  const out: string[] = []
  let seenKey: string | null = null

  for (let day = toDayNumber(bucketStartOf(firstKey, bucket)); day <= endDay; day++) {
    const key = bucketKeyOfLocalDate(fromDayNumber(day), bucket)
    if (key === seenKey) continue
    seenKey = key
    out.push(key)
  }

  return out
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

  return bucketKeysBetween(keys[0]!, keys[keys.length - 1]!, bucket).map((key) => ({
    key,
    label: bucketLabelOf(key, bucket),
    value: totals.get(key) ?? 0,
  }))
}

/**
 * Aggregates line churn while retaining its two components. The bucket extent
 * and gap filling deliberately match `buildSeries`, so changing breakdown does
 * not move or remove bars from the chart.
 */
export function buildLinesSeries(
  ds: Dataset,
  opts: Pick<SeriesOptions, 'bucket' | 'orgs'>,
): LinesPoint[] {
  const { bucket, orgs } = opts
  const totals = new Map<string, { additions: number; deletions: number }>()

  for (const pr of ds.mergedPrs) {
    if (!orgs.has(orgOf(pr.repo))) continue
    const key = bucketKeyOf(pr.mergedAt, bucket)
    const point = totals.get(key) ?? { additions: 0, deletions: 0 }
    point.additions += pr.additions
    point.deletions += pr.deletions
    totals.set(key, point)
  }

  if (totals.size === 0) return []

  const keys = [...totals.keys()].sort()
  return bucketKeysBetween(keys[0]!, keys[keys.length - 1]!, bucket).map((key) => {
    const point = totals.get(key) ?? { additions: 0, deletions: 0 }
    return {
      key,
      label: bucketLabelOf(key, bucket),
      additions: point.additions,
      deletions: point.deletions,
      total: point.additions + point.deletions,
    }
  })
}

/** One bucket of activity, split by the repositories that made it up. */
export interface RepoPoint {
  /** Sortable bucket identity, e.g. "2026-W31" or "2026-07". */
  key: string
  /** Human label, e.g. "W31 2026" or "Jul 2026". */
  label: string
  /** Sum of every value in byRepo. */
  total: number
  /** Repo id -> value. A repo with no activity in this bucket is absent. */
  byRepo: Record<string, number>
}

/**
 * The same aggregation as `buildSeries` — same filtering, same contiguous
 * gap-filled buckets — but retaining which repo each unit of work belongs to.
 *
 * Deliberately a second pass over the dataset rather than the source
 * `buildSeries` is derived from: at this dataset's size the extra scan is
 * cheap, and the two staying independent keeps the gap-fill logic that every
 * existing test covers exactly where it was.
 */
export function buildRepoSeries(ds: Dataset, opts: SeriesOptions): RepoPoint[] {
  const { bucket, metric, orgs } = opts
  const byBucket = new Map<string, Map<string, number>>()

  const record = (iso: string, repo: string, amount: number): void => {
    if (!orgs.has(orgOf(repo))) return
    const key = bucketKeyOf(iso, bucket)
    let repos = byBucket.get(key)
    if (repos === undefined) {
      repos = new Map()
      byBucket.set(key, repos)
    }
    repos.set(repo, (repos.get(repo) ?? 0) + amount)
  }

  if (metric === 'commits') {
    for (const c of ds.commits) record(c.authoredAt, c.repo, 1)
  } else {
    for (const p of ds.mergedPrs) record(p.mergedAt, p.repo, p.additions + p.deletions)
  }

  if (byBucket.size === 0) return []

  const keys = [...byBucket.keys()].sort()

  return bucketKeysBetween(keys[0]!, keys[keys.length - 1]!, bucket).map((key) => {
    const byRepo: Record<string, number> = {}
    let total = 0
    for (const [repo, value] of byBucket.get(key) ?? []) {
      byRepo[repo] = value
      total += value
    }
    return { key, label: bucketLabelOf(key, bucket), total, byRepo }
  })
}
