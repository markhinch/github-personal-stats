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
/** `page * per_page <= SEARCH_RESULT_CAP`, so page 11 is an error, not an empty page. */
export const MAX_PAGE = SEARCH_RESULT_CAP / PER_PAGE

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

/** The outcome of reading a window: was everything in it actually reachable? */
export interface WindowResult {
  /**
   * False when the window — or any window nested inside it — reported more
   * results than the API will serve. An incomplete window has provably lost
   * items, so a resume cache must not record it as finished.
   */
  complete: boolean
}

export interface CollectOptions<T> {
  /** Receives every batch of items as it arrives. */
  onItems: (items: T[], w: DateWindow) => Promise<void>
  /**
   * Called once a window and all its children have been read.
   *
   * `result.complete` is false when the window contained a single day whose
   * result count exceeded what the API will serve. Only cache a window for
   * resume when `result.complete` is true: an incomplete window must be
   * re-probed on every future sync so it keeps reporting through
   * `onUnsplittable` instead of quietly rendering short forever.
   */
  onDone?: (w: DateWindow, result: WindowResult) => Promise<void>
  /** Resume hook: return true to skip a window entirely. */
  isDone?: (w: DateWindow) => boolean
  /** Called when a single day exceeds the cap and cannot be split further. */
  onUnsplittable?: (w: DateWindow, totalCount: number) => void
  /** Progress reporting. */
  onProgress?: (w: DateWindow, totalCount: number) => void
}

/**
 * Emits page 1 and then pages until the window is exhausted or the pagination
 * limit is reached.
 *
 * Termination is derived from the data as well as from `total_count`: the count
 * drives the common case, but a page that comes back completely full means the
 * fetcher may still be holding results the count did not admit to — a count
 * read before the window grew, or a fetcher paging at fewer than `PER_PAGE`.
 * Only a short page proves the window is exhausted. Trusting the count alone
 * under-collects silently, which is the whole failure mode of this module.
 */
async function pageThrough<T>(
  w: DateWindow,
  first: { totalCount: number; items: T[] },
  fetchPage: PageFetcher<T>,
  opts: CollectOptions<T>,
): Promise<void> {
  await opts.onItems(first.items, w)

  const expected = Math.min(first.totalCount, SEARCH_RESULT_CAP)
  let collected = first.items.length
  let lastPageSize = first.items.length

  for (let page = 2; page <= MAX_PAGE; page++) {
    if (collected >= expected && lastPageSize < PER_PAGE) break
    const res = await fetchPage(w, page)
    await opts.onItems(res.items, w)
    collected += res.items.length
    lastPageSize = res.items.length
    // An empty page ends the window regardless of what the count claimed.
    if (res.items.length === 0) break
  }
}

/**
 * Collects every result in `window`, bisecting whenever the API reports more
 * than it will actually serve.
 *
 * The size probe is free: page 1's response carries both `total_count` and the
 * first 100 results, so an under-cap window costs no extra request.
 *
 * Returns whether the window was fully reachable. Incompleteness propagates
 * upward: a month containing one over-cap day is itself incomplete.
 */
export async function collectWindow<T>(
  window: DateWindow,
  fetchPage: PageFetcher<T>,
  opts: CollectOptions<T>,
): Promise<WindowResult> {
  if (opts.isDone?.(window)) return { complete: true }

  const first = await fetchPage(window, 1)
  if (!Number.isFinite(first.totalCount)) {
    // Left unchecked, NaN fails the cap test, yields NaN pages, and collapses
    // the window to its first 100 items without a word.
    throw new Error(
      `Search returned a non-finite total_count (${String(first.totalCount)}) for window ` +
        `${windowKey(window)}; refusing to guess how many results exist.`,
    )
  }
  opts.onProgress?.(window, first.totalCount)

  if (first.totalCount > SEARCH_RESULT_CAP) {
    const halves = splitWindow(window)
    if (!halves) {
      // A single day over the cap. Take what we can reach and report loudly:
      // silently truncating here is exactly the failure this module prevents.
      // It is emphatically NOT complete — saying otherwise would let a resume
      // cache skip the probe next run and drop the warning along with it.
      opts.onUnsplittable?.(window, first.totalCount)
      await pageThrough(window, first, fetchPage, opts)
      const result: WindowResult = { complete: false }
      await opts.onDone?.(window, result)
      return result
    }
    let complete = true
    for (const half of halves) {
      const halfResult = await collectWindow(half, fetchPage, opts)
      complete = complete && halfResult.complete
    }
    const result: WindowResult = { complete }
    await opts.onDone?.(window, result)
    return result
  }

  await pageThrough(window, first, fetchPage, opts)
  const result: WindowResult = { complete: true }
  await opts.onDone?.(window, result)
  return result
}
