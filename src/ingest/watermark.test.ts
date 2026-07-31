import { describe, it, expect } from 'vitest'
import { nextWatermark, shiftDays } from './watermark'

describe('shiftDays', () => {
  it('moves forward and backward by whole days', () => {
    expect(shiftDays('2026-07-31', -3)).toBe('2026-07-28')
    expect(shiftDays('2026-07-28', 3)).toBe('2026-07-31')
  })

  it('crosses month and year boundaries', () => {
    expect(shiftDays('2026-03-01', -1)).toBe('2026-02-28')
    expect(shiftDays('2026-01-01', -1)).toBe('2025-12-31')
  })

  it('handles a leap day', () => {
    expect(shiftDays('2024-03-01', -1)).toBe('2024-02-29')
  })
})

describe('nextWatermark', () => {
  it('advances to rangeEnd when nothing read short', () => {
    // The property that stops the clamp from making every healthy run
    // re-collect a year of history.
    expect(nextWatermark('2026-07-31', [])).toBe('2026-07-31')
  })

  it('rewinds to just before a short-read window so the next run re-reads it', () => {
    expect(nextWatermark('2026-07-31', ['2025-03-01'])).toBe('2025-02-28')
  })

  it('rewinds to the EARLIEST short read, not the last one seen', () => {
    // Windows finish in bisection order, not chronological order, so the run
    // may report a later window first.
    expect(nextWatermark('2026-07-31', ['2026-05-14', '2025-03-01', '2026-01-01']))
      .toBe('2025-02-28')
  })

  it('rewinds by exactly one day, so the short window is inside the next range', () => {
    const start = '2025-04-26'
    const watermark = nextWatermark('2026-07-31', [start])
    expect(watermark).toBe('2025-04-25')
    expect(watermark < start).toBe(true)
  })

  it('still clamps when the short read is inside the overlap', () => {
    // No special-casing for recent windows: the rule is the same everywhere.
    expect(nextWatermark('2026-07-31', ['2026-07-30'])).toBe('2026-07-29')
  })
})
