import { fromDayNumber, localDateOf, toDayNumber } from '../core/buckets'
import type { LocalDate } from '../core/types'

/** An inclusive date range, both bounds `YYYY-MM-DD`. */
export interface DateWindow {
  start: string
  end: string
}

/** The GitHub Search API returns at most this many results per query. */
export const SEARCH_RESULT_CAP = 1000
/** With per_page=100, page * per_page must stay <= SEARCH_RESULT_CAP. */
export const PER_PAGE = 100

const pad2 = (n: number): string => String(n).padStart(2, '0')

const fmt = (d: LocalDate): string => `${d.year}-${pad2(d.month)}-${pad2(d.day)}`

const dayOf = (date: string): number => toDayNumber(localDateOf(`${date}T00:00:00Z`))

export function windowKey(w: DateWindow): string {
  return `${w.start}..${w.end}`
}

/** Halves a window. Returns null for a single day — the bisection floor. */
export function splitWindow(w: DateWindow): [DateWindow, DateWindow] | null {
  const start = dayOf(w.start)
  const end = dayOf(w.end)
  if (end <= start) return null
  const mid = start + Math.floor((end - start) / 2)
  return [
    { start: w.start, end: fmt(fromDayNumber(mid)) },
    { start: fmt(fromDayNumber(mid + 1)), end: w.end },
  ]
}

/**
 * Seeds bisection with one window per calendar year.
 *
 * Yearly seeds keep the probe count low (~17 for this account's history) while
 * letting bisection adapt to the fact that recent years are far denser than old
 * ones. An empty year costs exactly one request.
 */
export function yearWindows(startDate: string, endDate: string): DateWindow[] {
  const first = localDateOf(`${startDate}T00:00:00Z`)
  const last = localDateOf(`${endDate}T00:00:00Z`)
  const out: DateWindow[] = []
  for (let y = first.year; y <= last.year; y++) {
    out.push({
      start: y === first.year ? startDate : `${y}-01-01`,
      end: y === last.year ? endDate : `${y}-12-31`,
    })
  }
  return out
}

export type PageFetcher<T> = (
  w: DateWindow,
  page: number,
) => Promise<{ totalCount: number; items: T[] }>

export interface CollectOptions<T> {
  /** Receives every batch of items as it arrives. */
  onItems: (items: T[], w: DateWindow) => Promise<void>
  /** Called once a window (and all its children) is fully collected. */
  onDone?: (w: DateWindow) => Promise<void>
  /** Resume hook: return true to skip a window entirely. */
  isDone?: (w: DateWindow) => boolean
  /** Called when a single day exceeds the cap and cannot be split further. */
  onUnsplittable?: (w: DateWindow, totalCount: number) => void
  /** Progress reporting. */
  onProgress?: (w: DateWindow, totalCount: number) => void
}

/**
 * Collects every result in `window`, bisecting whenever the API reports more
 * than it will actually serve.
 *
 * The size probe is free: page 1's response carries both `total_count` and the
 * first 100 results, so an under-cap window costs no extra request.
 */
export async function collectWindow<T>(
  window: DateWindow,
  fetchPage: PageFetcher<T>,
  opts: CollectOptions<T>,
): Promise<void> {
  if (opts.isDone?.(window)) return

  const first = await fetchPage(window, 1)
  opts.onProgress?.(window, first.totalCount)

  if (first.totalCount > SEARCH_RESULT_CAP) {
    const halves = splitWindow(window)
    if (!halves) {
      // A single day over the cap. Take what we can reach and report loudly:
      // silently truncating here is exactly the failure this module prevents.
      opts.onUnsplittable?.(window, first.totalCount)
      await opts.onItems(first.items, window)
      for (let page = 2; page <= SEARCH_RESULT_CAP / PER_PAGE; page++) {
        const res = await fetchPage(window, page)
        if (res.items.length === 0) break
        await opts.onItems(res.items, window)
      }
      await opts.onDone?.(window)
      return
    }
    for (const half of halves) await collectWindow(half, fetchPage, opts)
    await opts.onDone?.(window)
    return
  }

  await opts.onItems(first.items, window)
  const pages = Math.ceil(first.totalCount / PER_PAGE)
  for (let page = 2; page <= pages; page++) {
    const res = await fetchPage(window, page)
    await opts.onItems(res.items, window)
  }
  await opts.onDone?.(window)
}
