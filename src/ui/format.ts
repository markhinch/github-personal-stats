import type { Metric } from '../core/types'

const exact = new Intl.NumberFormat('en-GB')
// en-US, not en-GB: both group with commas, but en-GB compacts to a lowercase
// "2.9m"/"1.4k", which reads as milli/kilo beside a headline figure.
const compact = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 })

/** Thousands-separated, e.g. "8,595". */
export function formatExact(n: number): string {
  return exact.format(Math.round(n))
}

/** Short form for axis ticks and cramped labels, e.g. "1.4M". */
export function formatCompact(n: number): string {
  return compact.format(n)
}

/**
 * How a value of this metric is written on a stat tile.
 *
 * Commit counts stay exact — they're small enough to read and exactness is the
 * point of this tool. Line churn runs into the millions, where an exact figure
 * is both unreadable at label size and falsely precise (it's a merged-PR
 * approximation), so it's compacted.
 */
export function formatMetric(metric: Metric, n: number): string {
  return metric === 'commits' ? formatExact(n) : formatCompact(n)
}

// Two significant figures: "160K", not "159.6K". Four characters instead of six
// is the difference between labels that clear their neighbours and labels that
// collide, and the extra digit was never real precision anyway.
const compactTight = new Intl.NumberFormat('en-US', {
  notation: 'compact',
  maximumSignificantDigits: 2,
})

/** How a value is written *on a bar*, where horizontal room is the constraint. */
export function formatMetricLabel(metric: Metric, n: number): string {
  return metric === 'commits' ? formatExact(n) : compactTight.format(n)
}

export function metricNoun(metric: Metric): string {
  return metric === 'commits' ? 'commits' : 'lines changed'
}

export function bucketNoun(bucket: 'week' | 'month', plural = false): string {
  return plural ? `${bucket}s` : bucket
}
