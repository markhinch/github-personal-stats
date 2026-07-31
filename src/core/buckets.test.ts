import { describe, it, expect } from 'vitest'
import {
  localDateOf, toDayNumber, fromDayNumber, isoWeek, isoWeekStart,
  bucketKeyOf, bucketStartOf, bucketLabelOf,
} from './buckets'

describe('localDateOf', () => {
  it('reads the date as written in the commit\'s own offset', () => {
    // 23:30 on 15 July at +02:00 is 21:30 UTC the same day.
    expect(localDateOf('2026-07-15T23:30:00.000+02:00')).toEqual({ year: 2026, month: 7, day: 15 })
  })

  it('does not shift a late-evening local commit into the next UTC day', () => {
    // 01:30 on 16 July at +02:00 is 23:30 UTC on the 15th. The user worked on the 16th.
    expect(localDateOf('2026-07-16T01:30:00.000+02:00')).toEqual({ year: 2026, month: 7, day: 16 })
  })

  it('handles a negative offset', () => {
    expect(localDateOf('2026-07-15T22:00:00.000-07:00')).toEqual({ year: 2026, month: 7, day: 15 })
  })

  it('handles UTC "Z" and offsets without a colon', () => {
    expect(localDateOf('2026-07-15T10:00:00Z')).toEqual({ year: 2026, month: 7, day: 15 })
    expect(localDateOf('2026-07-15T10:00:00.000+0200')).toEqual({ year: 2026, month: 7, day: 15 })
  })

  it('throws on an unparseable timestamp rather than silently returning a wrong date', () => {
    expect(() => localDateOf('yesterday')).toThrow(/unparseable/i)
    expect(() => localDateOf('')).toThrow(/unparseable/i)
  })
})

describe('day number round-trip', () => {
  it('round-trips dates', () => {
    for (const d of [
      { year: 2026, month: 7, day: 31 },
      { year: 2024, month: 2, day: 29 },
      { year: 2010, month: 12, day: 7 },
      { year: 2026, month: 1, day: 1 },
    ]) {
      expect(fromDayNumber(toDayNumber(d))).toEqual(d)
    }
  })

  it('advances across a month boundary', () => {
    expect(fromDayNumber(toDayNumber({ year: 2026, month: 7, day: 31 }) + 1))
      .toEqual({ year: 2026, month: 8, day: 1 })
  })
})

describe('isoWeek', () => {
  it('assigns a mid-year date correctly', () => {
    // Wed 22 Jul 2026 falls in ISO week 30.
    expect(isoWeek({ year: 2026, month: 7, day: 22 })).toEqual({ year: 2026, week: 30 })
  })

  it('assigns 1 Jan 2026 (a Thursday) to week 1 of 2026', () => {
    expect(isoWeek({ year: 2026, month: 1, day: 1 })).toEqual({ year: 2026, week: 1 })
  })

  it('assigns 1 Jan 2023 (a Sunday) to week 52 of 2022', () => {
    expect(isoWeek({ year: 2023, month: 1, day: 1 })).toEqual({ year: 2022, week: 52 })
  })

  it('assigns 31 Dec 2024 (a Tuesday) to week 1 of 2025', () => {
    expect(isoWeek({ year: 2024, month: 12, day: 31 })).toEqual({ year: 2025, week: 1 })
  })

  it('recognises 2020 as a 53-week ISO year', () => {
    expect(isoWeek({ year: 2020, month: 12, day: 31 })).toEqual({ year: 2020, week: 53 })
  })
})

describe('isoWeekStart', () => {
  it('returns the Monday of the containing week', () => {
    // Wed 22 Jul 2026 -> Mon 20 Jul 2026
    expect(isoWeekStart({ year: 2026, month: 7, day: 22 })).toEqual({ year: 2026, month: 7, day: 20 })
  })

  it('returns the same date when given a Monday', () => {
    expect(isoWeekStart({ year: 2026, month: 7, day: 20 })).toEqual({ year: 2026, month: 7, day: 20 })
  })

  it('crosses a year boundary backwards', () => {
    // Fri 1 Jan 2027 -> Mon 28 Dec 2026
    expect(isoWeekStart({ year: 2027, month: 1, day: 1 })).toEqual({ year: 2026, month: 12, day: 28 })
  })
})

describe('bucketKeyOf', () => {
  it('builds zero-padded, sortable month keys', () => {
    expect(bucketKeyOf('2026-07-22T16:05:11.000+02:00', 'month')).toBe('2026-07')
    expect(bucketKeyOf('2026-01-05T10:00:00.000+01:00', 'month')).toBe('2026-01')
  })

  it('builds zero-padded, sortable week keys using the ISO week year', () => {
    expect(bucketKeyOf('2026-07-22T16:05:11.000+02:00', 'week')).toBe('2026-W30')
    expect(bucketKeyOf('2023-01-01T10:00:00.000+01:00', 'week')).toBe('2022-W52')
  })

  it('zero-pads a single-digit ISO week', () => {
    // Mon 5 Jan 2026 opens ISO week 2 — the key must be "2026-W02", not "2026-W2".
    expect(bucketKeyOf('2026-01-05T10:00:00.000+01:00', 'week')).toBe('2026-W02')
  })

  it('assigns a date in the leading edge of a 53-week ISO year to the previous year', () => {
    // Fri 1 Jan 2027 belongs to ISO week 53 of 2026, a 53-week year.
    expect(bucketKeyOf('2027-01-01T10:00:00.000+01:00', 'week')).toBe('2026-W53')
  })

  it('sorts derived keys chronologically as plain strings', () => {
    // The keys must come from the module, not from the keyboard: single-digit
    // week padding is what makes plain string sort match chronological order.
    const keys = [
      bucketKeyOf('2026-03-02T09:00:00.000+01:00', 'week'), // W10
      bucketKeyOf('2026-01-05T10:00:00.000+01:00', 'week'), // W02
      bucketKeyOf('2026-02-23T12:00:00.000+01:00', 'week'), // W09
    ]
    expect([...keys].sort()).toEqual(['2026-W02', '2026-W09', '2026-W10'])
  })
})

describe('bucketStartOf', () => {
  it('round-trips a month key', () => {
    expect(bucketStartOf('2026-07', 'month')).toEqual({ year: 2026, month: 7, day: 1 })
  })

  it('round-trips a week key to its Monday', () => {
    expect(bucketStartOf('2026-W30', 'week')).toEqual({ year: 2026, month: 7, day: 20 })
  })

  it('round-trips a week key belonging to the previous calendar year', () => {
    expect(bucketStartOf('2022-W52', 'week')).toEqual({ year: 2022, month: 12, day: 26 })
  })

  it('round-trips week 53 of a 53-week ISO year', () => {
    // Pairs with the bucketKeyOf('2027-01-01…') case above: 1 Jan 2027 maps to
    // 2026-W53, and 2026-W53 maps back to its Monday, Mon 28 Dec 2026.
    expect(bucketStartOf('2026-W53', 'week')).toEqual({ year: 2026, month: 12, day: 28 })
  })

  it('throws on a malformed key', () => {
    expect(() => bucketStartOf('nope', 'month')).toThrow(/malformed/i)
  })
})

describe('bucketLabelOf', () => {
  it('labels months and weeks readably', () => {
    expect(bucketLabelOf('2026-07', 'month')).toBe('Jul 2026')
    expect(bucketLabelOf('2026-W30', 'week')).toBe('W30 2026')
  })
})
