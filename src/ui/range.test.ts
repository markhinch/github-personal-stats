import { describe, it, expect } from 'vitest'
import type { SeriesPoint } from '../core/types'
import { bucketsInRange, windowStartKey } from './range'

const months = (keys: string[]): SeriesPoint[] =>
  keys.map((key) => ({ key, label: key, value: 1 }))

describe('bucketsInRange', () => {
  it('counts months directly', () => {
    expect(bucketsInRange('1y', 'month')).toBe(12)
    expect(bucketsInRange('2y', 'month')).toBe(24)
  })

  it('converts months to the weeks covering the same ground', () => {
    expect(bucketsInRange('1y', 'week')).toBe(52)
    expect(bucketsInRange('2y', 'week')).toBe(104)
  })

  it('is unbounded for all time', () => {
    expect(bucketsInRange('all', 'month')).toBeNull()
    expect(bucketsInRange('all', 'week')).toBeNull()
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
