import type { Bucket, LocalDate } from './types'

const MS_PER_DAY = 86_400_000

/**
 * Matches an ISO 8601 timestamp with optional fractional seconds and either
 * "Z", "+HH:MM", or "+HHMM". The offset is deliberately captured but unused:
 * we want the date as the author experienced it, which is the date as written.
 */
const ISO_RE =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})$/

/** Reads the calendar date as written, ignoring the offset entirely. */
export function localDateOf(iso: string): LocalDate {
  const m = ISO_RE.exec(iso)
  if (!m) throw new Error(`Unparseable timestamp: ${JSON.stringify(iso)}`)
  return { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) }
}

/**
 * Days since 1970-01-01 for a timezone-free date.
 * Date.UTC is used purely as calendar arithmetic — never as a moment in time —
 * so the host timezone cannot influence the result.
 */
export function toDayNumber(d: LocalDate): number {
  return Math.round(Date.UTC(d.year, d.month - 1, d.day) / MS_PER_DAY)
}

export function fromDayNumber(n: number): LocalDate {
  const dt = new Date(n * MS_PER_DAY)
  return { year: dt.getUTCFullYear(), month: dt.getUTCMonth() + 1, day: dt.getUTCDate() }
}

/** Day of week, Monday = 1 … Sunday = 7. */
function isoDayOfWeek(d: LocalDate): number {
  const dow = new Date(toDayNumber(d) * MS_PER_DAY).getUTCDay()
  return dow === 0 ? 7 : dow
}

/**
 * ISO 8601 week number and week-numbering year. Week 1 is the week containing
 * the first Thursday, so early-January dates can belong to the previous year.
 */
export function isoWeek(d: LocalDate): { year: number; week: number } {
  // Step to the Thursday of this week; its calendar year is the ISO week year.
  const thursday = fromDayNumber(toDayNumber(d) + (4 - isoDayOfWeek(d)))
  const jan1 = toDayNumber({ year: thursday.year, month: 1, day: 1 })
  const week = Math.floor((toDayNumber(thursday) - jan1) / 7) + 1
  return { year: thursday.year, week }
}

/** The Monday of the ISO week containing `d`. */
export function isoWeekStart(d: LocalDate): LocalDate {
  return fromDayNumber(toDayNumber(d) - (isoDayOfWeek(d) - 1))
}

const pad2 = (n: number): string => String(n).padStart(2, '0')

export function bucketKeyOfLocalDate(d: LocalDate, bucket: Bucket): string {
  if (bucket === 'month') return `${d.year}-${pad2(d.month)}`
  const { year, week } = isoWeek(d)
  return `${year}-W${pad2(week)}`
}

export function bucketKeyOf(iso: string, bucket: Bucket): string {
  return bucketKeyOfLocalDate(localDateOf(iso), bucket)
}

const MONTH_KEY_RE = /^(\d{4})-(\d{2})$/
const WEEK_KEY_RE = /^(\d{4})-W(\d{2})$/

/** The first day of the bucket a key names. Inverse of bucketKeyOfLocalDate. */
export function bucketStartOf(key: string, bucket: Bucket): LocalDate {
  if (bucket === 'month') {
    const m = MONTH_KEY_RE.exec(key)
    if (!m) throw new Error(`Malformed month key: ${JSON.stringify(key)}`)
    return { year: Number(m[1]), month: Number(m[2]), day: 1 }
  }
  const m = WEEK_KEY_RE.exec(key)
  if (!m) throw new Error(`Malformed week key: ${JSON.stringify(key)}`)
  const isoYear = Number(m[1])
  const week = Number(m[2])
  // 4 January is always in ISO week 1; walk forward from that week's Monday.
  const week1Monday = isoWeekStart({ year: isoYear, month: 1, day: 4 })
  return fromDayNumber(toDayNumber(week1Monday) + (week - 1) * 7)
}

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export function bucketLabelOf(key: string, bucket: Bucket): string {
  if (bucket === 'month') {
    const start = bucketStartOf(key, 'month')
    return `${MONTH_NAMES[start.month - 1]} ${start.year}`
  }
  const m = WEEK_KEY_RE.exec(key)
  if (!m) throw new Error(`Malformed week key: ${JSON.stringify(key)}`)
  return `W${m[2]} ${m[1]}`
}
