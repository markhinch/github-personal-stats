import { describe, it, expect } from 'vitest'
import type { SeriesPoint } from '../core/types'
import { RANGE_OPTIONS, bucketsInRange, nextBucket, supportsDayBucket, windowStartKey } from './range'

const months = (keys: string[]): SeriesPoint[] =>
  keys.map((key) => ({ key, label: key, value: 1 }))

describe('bucketsInRange', () => {
  it('counts months directly', () => {
    expect(bucketsInRange('3m', 'month')).toBe(3)
    expect(bucketsInRange('6m', 'month')).toBe(6)
    expect(bucketsInRange('1y', 'month')).toBe(12)
    expect(bucketsInRange('2y', 'month')).toBe(24)
  })

  it('converts months to the weeks covering the same ground', () => {
    expect(bucketsInRange('3m', 'week')).toBe(13)
    expect(bucketsInRange('6m', 'week')).toBe(26)
    expect(bucketsInRange('1y', 'week')).toBe(52)
    expect(bucketsInRange('2y', 'week')).toBe(104)
  })

  it('counts the days covering the same ground', () => {
    expect(bucketsInRange('1w', 'day')).toBe(7)
    expect(bucketsInRange('1m', 'day')).toBe(30)
    expect(bucketsInRange('3m', 'day')).toBe(91)
  })

  it('covers the 1-week and 1-month ranges in every bucket size', () => {
    expect(bucketsInRange('1w', 'week')).toBe(1)
    expect(bucketsInRange('1m', 'month')).toBe(1)
  })

  // A range shorter than one bucket rounds to zero buckets, and
  // windowStartKey treats a count of 0 the same as the null "unbounded"
  // sentinel (`keys[keys.length - 0]` is out of range) — so a 1-week range
  // bucketed by month would silently show the entire dataset instead of
  // nothing. Rounding up to 1 keeps the count meaningfully bounded.
  it('never rounds down to zero buckets, even for a range shorter than the bucket', () => {
    expect(bucketsInRange('1w', 'month')).toBe(1)
  })

  it('is unbounded for all time', () => {
    expect(bucketsInRange('all', 'day')).toBeNull()
    expect(bucketsInRange('all', 'month')).toBeNull()
    expect(bucketsInRange('all', 'week')).toBeNull()
  })
})

describe('RANGE_OPTIONS', () => {
  it('offers every range the type allows, shortest first', () => {
    expect(RANGE_OPTIONS.map((o) => o.value)).toEqual(['1w', '1m', '3m', '6m', '1y', '2y', 'all'])
  })

  // The control renders straight from this list, so a range with no entry is
  // unreachable in the UI even though the type says it exists.
  it('gives every option a bucket count rule', () => {
    for (const option of RANGE_OPTIONS) {
      expect(bucketsInRange(option.value, 'month')).not.toBeUndefined()
    }
  })
})

describe('supportsDayBucket', () => {
  it('offers the day bucket only for the two shortest ranges', () => {
    expect(supportsDayBucket('1w')).toBe(true)
    expect(supportsDayBucket('1m')).toBe(true)
    expect(supportsDayBucket('3m')).toBe(false)
    expect(supportsDayBucket('6m')).toBe(false)
    expect(supportsDayBucket('1y')).toBe(false)
    expect(supportsDayBucket('2y')).toBe(false)
    expect(supportsDayBucket('all')).toBe(false)
  })
})

describe('nextBucket', () => {
  it('switches to day when entering a range that supports it', () => {
    expect(nextBucket('1w', 'week')).toBe('day')
    expect(nextBucket('1m', 'month')).toBe('day')
  })

  it('leaves the current bucket alone if it already is day', () => {
    expect(nextBucket('1w', 'day')).toBe('day')
  })

  it('falls back to week when leaving a day-capable range with day selected', () => {
    expect(nextBucket('3m', 'day')).toBe('week')
  })

  it('leaves a non-day bucket alone when leaving a day-capable range', () => {
    expect(nextBucket('3m', 'month')).toBe('month')
    expect(nextBucket('3m', 'week')).toBe('week')
  })
})

describe('windowStartKey', () => {
  it('returns the first key of the trailing window', () => {
    const s = months(['2026-01', '2026-02', '2026-03', '2026-04'])
    expect(windowStartKey([s], 2)).toBe('2026-03')
  })

  it('spans the union of the series so both metrics share one window', () => {
    // The lines series starts later than the commits series, as it does in the
    // real dataset: the first merged PR postdates the first commit.
    const commits = months(['2026-01', '2026-02', '2026-03'])
    const lines = months(['2026-02', '2026-03'])
    expect(windowStartKey([commits, lines], 2)).toBe('2026-02')
  })

  it('returns null when the window covers everything', () => {
    const s = months(['2026-01', '2026-02'])
    expect(windowStartKey([s], 2)).toBeNull()
    expect(windowStartKey([s], 5)).toBeNull()
    expect(windowStartKey([], 12)).toBeNull()
  })

  it('is unbounded for a null count', () => {
    expect(windowStartKey([months(['2026-01', '2026-02'])], null)).toBeNull()
  })
})
