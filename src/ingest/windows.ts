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

/**
 * How many times to re-request a page that came back empty while the reported
 * count still promises more results.
 *
 * Bounded on purpose: a page that is legitimately and permanently empty must
 * end the window rather than hang the backfill.
 */
export const EMPTY_PAGE_RETRIES = 2

/** The outcome of reading a window: was everything in it actually reachable? */
export interface WindowResult {
  /**
   * False when the window — or any window nested inside it — did not yield
   * everything the API said it held. Two causes: the window reported more
   * results than the API will serve (the cap), or paging ended short of the
   * reported count (a throttled or flaky read). Either way the window has
   * provably lost items, so a resume cache must not record it as finished.
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
  /**
   * Called before re-requesting a page that came back empty while the reported
   * count still promised more results.
   *
   * The backoff lives here rather than in this module so bisection stays
   * independent of the rate limiter: the caller owns the delay (typically
   * `RateLimiter.pauseFor`), and tests inject nothing and so never sleep.
   */
  onEmptyPageRetry?: (w: DateWindow, page: number, attempt: number) => Promise<void> | void
  /**
   * Called when a window ended short of its reported count even after retries.
   * The window is reported incomplete, so it will be re-read on the next run;
   * this exists so the shortfall is never merely inferred from a total.
   */
  onShortRead?: (w: DateWindow, collected: number, expected: number) => void
  /** Progress reporting. */
  onProgress?: (w: DateWindow, totalCount: number) => void
}

/** What a paging pass actually read, versus what the count promised. */
interface PageThroughResult {
  collected: number
  expected: number
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
 *
 * An empty page is not treated as proof of exhaustion while the count still
 * promises more: GitHub serves 200-with-empty-`items` under soft throttling,
 * and believing it once cost a real backfill 558 commits that the API would
 * serve on request. Such a page is retried, and if it stays empty the shortfall
 * is returned rather than hidden — the caller turns that into
 * `complete: false`, which keeps the window out of the resume cache so the next
 * run re-reads it.
 *
 * Page 1 is retried on exactly the same terms as any later page. Soft throttling
 * does not skip the first page, and page 1 is the *only* page a small window ever
 * requests — so excluding it meant a single throttled response cost a whole extra
 * 4-5 minute run where one re-requested page would have done.
 */
async function pageThrough<T>(
  w: DateWindow,
  first: { totalCount: number; items: T[] },
  fetchPage: PageFetcher<T>,
  opts: CollectOptions<T>,
): Promise<PageThroughResult> {
  /**
   * The **first** page-1 response's `total_count` governs, deliberately: it is
   * also the number the caller already used to decide split-or-page, and a retry
   * must not change that decision as a side effect. A retried page 1 therefore
   * contributes items only, never a revised count.
   *
   * The asymmetry that settles it: a soft-throttled response is exactly the kind
   * that would report a *lower* count, and adopting a lower count would shrink
   * the bar this window has to clear — laundering a lossy read into
   * `complete: true` and caching it as done forever. If the true count is in fact
   * higher, the window simply reads short, reports incomplete, stays out of the
   * cache, and the next run re-probes it with a fresh page 1 and re-decides
   * bisection from that. Discrepancies surface through the existing self-healing
   * path rather than being resolved mid-window.
   */
  const expected = Math.min(first.totalCount, SEARCH_RESULT_CAP)
  let collected = 0
  let lastPageSize = 0

  for (let page = 1; page <= MAX_PAGE; page++) {
    // Page 1 has already been fetched by the caller as the size probe, and its
    // items must always be emitted, so the termination test starts at page 2.
    if (page > 1 && collected >= expected && lastPageSize < PER_PAGE) break

    let res = page === 1 ? first : await fetchPage(w, page)
    // Only retry an empty page that contradicts the count. An empty page once
    // we already hold everything promised is ordinary termination — and a
    // genuinely empty window (expected 0) must still cost exactly one request.
    for (
      let attempt = 1;
      res.items.length === 0 && collected < expected && attempt <= EMPTY_PAGE_RETRIES;
      attempt++
    ) {
      await opts.onEmptyPageRetry?.(w, page, attempt)
      res = await fetchPage(w, page)
    }

    await opts.onItems(res.items, w)
    collected += res.items.length
    lastPageSize = res.items.length
    // A page that is still empty after its retries ends the window. The
    // shortfall travels back to the caller instead of passing for success.
    if (res.items.length === 0) break
  }

  return { collected, expected }
}

/**
 * Collects every result in `window`, bisecting whenever the API reports more
 * than it will actually serve.
 *
 * The size probe is free: page 1's response carries both `total_count` and the
 * first 100 results, so an under-cap window costs no extra request.
 *
 * Returns whether the window was fully reachable — meaning the pages actually
 * read delivered what the count promised, not merely that no error was thrown.
 * Incompleteness propagates upward: a month containing one over-cap day, or one
 * day that read short, is itself incomplete.
 *
 * The limit of that guarantee, written down so it is not rediscovered: the
 * comparison is on **row counts**, not distinct keys. This module is
 * deliberately key-agnostic — it never inspects an item — so it cannot tell one
 * result from another. GitHub's search pagination is not stable, so a reshuffle
 * between two page requests could serve one row twice and another not at all,
 * and `collected == expected` would still hold with a row genuinely missing.
 * Detecting that needs a key the caller owns (the sync dedupes commits by SHA),
 * so it belongs there, not here. Row counting catches the failure that actually
 * bit us — a page truncating the window early — and that is what it is for.
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

  // Under the cap, so everything the count promises should be reachable. Assert
  // that it actually arrived: claiming `complete: true` here without checking
  // is what let a throttled read be cached as finished and lost for good.
  const { collected, expected } = await pageThrough(window, first, fetchPage, opts)
  const complete = collected >= expected
  if (!complete) opts.onShortRead?.(window, collected, expected)
  const result: WindowResult = { complete }
  await opts.onDone?.(window, result)
  return result
}
