import { describe, it, expect, vi } from 'vitest'
import {
  splitWindow,
  windowKey,
  yearWindows,
  collectWindow,
  EMPTY_PAGE_RETRIES,
  MAX_PAGE,
  type DateWindow,
  type PageFetcher,
} from './windows'

describe('splitWindow', () => {
  it('halves a multi-day window into contiguous, non-overlapping halves', () => {
    const [a, b] = splitWindow({ start: '2026-01-01', end: '2026-01-10' })!
    expect(a).toEqual({ start: '2026-01-01', end: '2026-01-05' })
    expect(b).toEqual({ start: '2026-01-06', end: '2026-01-10' })
  })

  it('splits a two-day window', () => {
    const [a, b] = splitWindow({ start: '2026-01-01', end: '2026-01-02' })!
    expect(a).toEqual({ start: '2026-01-01', end: '2026-01-01' })
    expect(b).toEqual({ start: '2026-01-02', end: '2026-01-02' })
  })

  it('returns null for a single-day window — the bisection floor', () => {
    expect(splitWindow({ start: '2026-01-01', end: '2026-01-01' })).toBeNull()
  })

  it('crosses month and year boundaries', () => {
    const [a, b] = splitWindow({ start: '2025-12-30', end: '2026-01-02' })!
    expect(a).toEqual({ start: '2025-12-30', end: '2025-12-31' })
    expect(b).toEqual({ start: '2026-01-01', end: '2026-01-02' })
  })
})

describe('yearWindows', () => {
  it('emits one window per calendar year, clamped to the range', () => {
    expect(yearWindows('2024-03-15', '2026-07-31')).toEqual([
      { start: '2024-03-15', end: '2024-12-31' },
      { start: '2025-01-01', end: '2025-12-31' },
      { start: '2026-01-01', end: '2026-07-31' },
    ])
  })

  it('handles a range inside a single year', () => {
    expect(yearWindows('2026-01-01', '2026-07-31')).toEqual([
      { start: '2026-01-01', end: '2026-07-31' },
    ])
  })
})

describe('windowKey', () => {
  it('is stable and unique per window', () => {
    expect(windowKey({ start: '2026-01-01', end: '2026-01-31' })).toBe('2026-01-01..2026-01-31')
  })
})

/**
 * Builds a fake pager over a synthetic day -> count map, mimicking the real API:
 * total_count reflects the whole window, but at most 1000 results are reachable.
 */
function fakeApi(countsByDay: Record<string, number>) {
  const calls: Array<{ window: string; page: number }> = []

  const idsIn = (w: DateWindow): string[] => {
    const out: string[] = []
    for (const [day, n] of Object.entries(countsByDay)) {
      if (day >= w.start && day <= w.end) {
        for (let i = 0; i < n; i++) out.push(`${day}#${i}`)
      }
    }
    return out.sort()
  }

  const fetchPage = async (w: DateWindow, page: number) => {
    calls.push({ window: windowKey(w), page })
    const all = idsIn(w)
    const reachable = all.slice(0, 1000) // the API's hard ceiling
    const from = (page - 1) * 100
    return { totalCount: all.length, items: reachable.slice(from, from + 100) }
  }

  return { fetchPage, calls }
}

describe('collectWindow', () => {
  it('pages through a window under the cap', async () => {
    const { fetchPage, calls } = fakeApi({ '2026-01-01': 250 })
    const got: string[] = []
    await collectWindow({ start: '2026-01-01', end: '2026-01-01' }, fetchPage, {
      onItems: async (items) => { got.push(...items) },
    })
    expect(got).toHaveLength(250)
    expect(calls.map((c) => c.page)).toEqual([1, 2, 3])
  })

  it('SPLITS rather than truncates when a window exceeds the 1000 cap', async () => {
    // 1431 commits in one month — the real July 2026 figure.
    const { fetchPage } = fakeApi({
      '2026-07-05': 700,
      '2026-07-20': 731,
    })
    const got: string[] = []
    await collectWindow({ start: '2026-07-01', end: '2026-07-31' }, fetchPage, {
      onItems: async (items) => { got.push(...items) },
    })
    // The whole point: nothing is lost.
    expect(new Set(got).size).toBe(1431)
  })

  it('recurses as deep as needed', async () => {
    const days: Record<string, number> = {}
    for (let d = 1; d <= 28; d++) {
      days[`2026-02-${String(d).padStart(2, '0')}`] = 300
    }
    const { fetchPage } = fakeApi(days)
    const got: string[] = []
    await collectWindow({ start: '2026-02-01', end: '2026-02-28' }, fetchPage, {
      onItems: async (items) => { got.push(...items) },
    })
    expect(new Set(got).size).toBe(28 * 300)
  })

  it('costs only one request for an empty window', async () => {
    const { fetchPage, calls } = fakeApi({})
    await collectWindow({ start: '2015-01-01', end: '2015-12-31' }, fetchPage, {
      onItems: async () => {},
    })
    expect(calls).toHaveLength(1)
  })

  it('reports a single day that exceeds the cap instead of silently truncating', async () => {
    const onUnsplittable = vi.fn()
    // The overflowing day sits between two ordinary days, so the test also pins
    // that the run keeps going past the leaf it cannot fully read.
    const { fetchPage } = fakeApi({
      '2026-07-05': 1200,
      '2026-07-06': 120,
      '2026-07-07': 30,
    })
    const got: string[] = []
    await collectWindow({ start: '2026-07-05', end: '2026-07-07' }, fetchPage, {
      onItems: async (items) => { got.push(...items) },
      onUnsplittable,
    })
    expect(onUnsplittable).toHaveBeenCalledWith(
      { start: '2026-07-05', end: '2026-07-05' },
      1200,
    )
    // The 1000 reachable results of the overflowing day are still emitted, and
    // the days after it are still collected.
    expect(new Set(got).size).toBe(1000 + 120 + 30)
  })

  it('never reports an overflowing day, or any window containing one, as complete', async () => {
    const done = new Map<string, boolean>()
    const { fetchPage } = fakeApi({ '2026-07-05': 1200, '2026-07-06': 120 })
    const result = await collectWindow({ start: '2026-07-05', end: '2026-07-06' }, fetchPage, {
      onItems: async () => {},
      onDone: async (w, r) => { done.set(windowKey(w), r.complete) },
    })
    expect(done.get('2026-07-05..2026-07-05')).toBe(false)
    // Incompleteness propagates: a resume cache must not skip the parent either.
    expect(done.get('2026-07-05..2026-07-06')).toBe(false)
    expect(result.complete).toBe(false)
    // A sibling that was genuinely exhausted is still complete.
    expect(done.get('2026-07-06..2026-07-06')).toBe(true)
  })

  it('keeps re-probing and re-reporting an overflowing day on later runs', async () => {
    // A resume cache that stores only complete windows, as onDone's contract requires.
    const cache = new Set<string>()
    const counts = { '2026-07-05': 1200, '2026-07-06': 120 }
    const run = async () => {
      const onUnsplittable = vi.fn()
      const { fetchPage, calls } = fakeApi(counts)
      await collectWindow({ start: '2026-07-05', end: '2026-07-06' }, fetchPage, {
        onItems: async () => {},
        onUnsplittable,
        isDone: (w) => cache.has(windowKey(w)),
        onDone: async (w, r) => { if (r.complete) cache.add(windowKey(w)) },
      })
      return { onUnsplittable, calls }
    }

    expect((await run()).onUnsplittable).toHaveBeenCalledTimes(1)

    const second = await run()
    // Still warns rather than quietly serving a short day forever...
    expect(second.onUnsplittable).toHaveBeenCalledTimes(1)
    // ...while the sibling that completed is skipped.
    expect(second.calls.some((c) => c.window === '2026-07-06..2026-07-06')).toBe(false)
  })

  it('keeps paging past an under-reported total_count instead of trusting it', async () => {
    // The shape of a window that grew after its probe, or of a fetcher paging at
    // fewer than PER_PAGE: the count says 150, the API keeps serving.
    const calls: number[] = []
    const all = Array.from({ length: 350 }, (_, i) => `c${i}`)
    const fetchPage: PageFetcher<string> = async (_w, page) => {
      calls.push(page)
      const from = (page - 1) * 100
      return { totalCount: 150, items: all.slice(from, from + 100) }
    }
    const got: string[] = []
    await collectWindow({ start: '2026-01-01', end: '2026-01-31' }, fetchPage, {
      onItems: async (items) => { got.push(...items) },
    })
    expect(got).toHaveLength(350)
    expect(calls).toEqual([1, 2, 3, 4])
  })

  it('never requests past the pagination limit even when every page comes back full', async () => {
    const calls: number[] = []
    const fetchPage: PageFetcher<string> = async (_w, page) => {
      calls.push(page)
      return { totalCount: 1000, items: Array.from({ length: 100 }, (_, i) => `p${page}-${i}`) }
    }
    await collectWindow({ start: '2026-01-01', end: '2026-01-31' }, fetchPage, {
      onItems: async () => {},
    })
    expect(Math.max(...calls)).toBe(MAX_PAGE)
    expect(MAX_PAGE).toBe(10)
  })

  it('throws rather than collapsing a window when total_count is not a finite number', async () => {
    const fetchPage: PageFetcher<string> = async () => ({
      totalCount: Number.NaN,
      items: ['only-the-first-page'],
    })
    await expect(
      collectWindow({ start: '2026-01-01', end: '2026-01-31' }, fetchPage, {
        onItems: async () => {},
      }),
    ).rejects.toThrow(/total_count/)
  })

  it('skips windows the resume predicate reports as already done', async () => {
    const { fetchPage, calls } = fakeApi({ '2026-01-01': 50 })
    await collectWindow({ start: '2026-01-01', end: '2026-01-31' }, fetchPage, {
      onItems: async () => {},
      isDone: (w) => windowKey(w) === '2026-01-01..2026-01-31',
    })
    expect(calls).toHaveLength(0)
  })

  /**
   * Regression cover for a real 558-commit loss. GitHub answered a mid-window
   * page with 200-and-empty-`items` while soft-throttling; the window was taken
   * as exhausted, reported complete, and cached as done, so the commits the API
   * would happily serve were gone for good.
   *
   * No test here sleeps: the backoff is injected via `onEmptyPageRetry`, so the
   * suite exercises the retry path in milliseconds.
   */
  describe('an empty page that contradicts the reported count', () => {
    /** 250 results, but page 2 is empty the first `emptyTimes` times it is asked. */
    const flakyFetcher = (emptyTimes: number) => {
      const all = Array.from({ length: 250 }, (_, i) => `c${i}`)
      const calls: number[] = []
      let seen = 0
      const fetchPage: PageFetcher<string> = async (_w, page) => {
        calls.push(page)
        if (page === 2 && seen < emptyTimes) {
          seen++
          return { totalCount: 250, items: [] }
        }
        const from = (page - 1) * 100
        return { totalCount: 250, items: all.slice(from, from + 100) }
      }
      return { fetchPage, calls }
    }

    it('is retried, and the items are recovered', async () => {
      const { fetchPage, calls } = flakyFetcher(1)
      const retries: Array<{ page: number; attempt: number }> = []
      const got: string[] = []
      const result = await collectWindow({ start: '2026-01-01', end: '2026-01-31' }, fetchPage, {
        onItems: async (items) => { got.push(...items) },
        onEmptyPageRetry: (_w, page, attempt) => { retries.push({ page, attempt }) },
      })
      // Nothing lost, and the window is honestly complete.
      expect(new Set(got).size).toBe(250)
      expect(result.complete).toBe(true)
      expect(retries).toEqual([{ page: 2, attempt: 1 }])
      expect(calls).toEqual([1, 2, 2, 3])
    })

    it('reports the window incomplete — without hanging — when it stays empty', async () => {
      const calls: number[] = []
      const fetchPage: PageFetcher<string> = async (_w, page) => {
        calls.push(page)
        if (page === 1) {
          return { totalCount: 500, items: Array.from({ length: 100 }, (_, i) => `a${i}`) }
        }
        return { totalCount: 500, items: [] } // never recovers
      }
      const shortReads: Array<[number, number]> = []
      const done = new Map<string, boolean>()
      const result = await collectWindow({ start: '2026-01-01', end: '2026-01-31' }, fetchPage, {
        onItems: async () => {},
        onShortRead: (_w, collected, expected) => { shortReads.push([collected, expected]) },
        onDone: async (w, r) => { done.set(windowKey(w), r.complete) },
      })
      expect(result.complete).toBe(false)
      expect(shortReads).toEqual([[100, 500]])
      expect(done.get('2026-01-01..2026-01-31')).toBe(false)
      // Bounded: the first attempt plus its retries, then it gives up.
      expect(calls.filter((p) => p === 2)).toHaveLength(EMPTY_PAGE_RETRIES + 1)
      expect(calls).toEqual([1, 2, 2, 2])
    })

    it('is NOT retried once everything the count promised is already collected', async () => {
      // A full last page followed by an empty one is ordinary termination, not
      // throttling, and must not pay for retries or a backoff.
      const calls: number[] = []
      const pages: Record<number, string[]> = {
        1: Array.from({ length: 100 }, (_, i) => `a${i}`),
        2: Array.from({ length: 100 }, (_, i) => `b${i}`),
      }
      const fetchPage: PageFetcher<string> = async (_w, page) => {
        calls.push(page)
        return { totalCount: 200, items: pages[page] ?? [] }
      }
      const retries: number[] = []
      const result = await collectWindow({ start: '2026-01-01', end: '2026-01-31' }, fetchPage, {
        onItems: async () => {},
        onEmptyPageRetry: (_w, _page, attempt) => { retries.push(attempt) },
      })
      expect(result.complete).toBe(true)
      expect(retries).toEqual([])
      expect(calls).toEqual([1, 2, 3])
    })

    /**
     * Page 1 is not special to soft throttling, and it *is* special to this
     * tool: it is the only page a small window ever requests, so a page 1 that
     * was never retried meant one throttled response cost a whole extra 4-5
     * minute run.
     */
    describe('on page 1', () => {
      /** 250 results, but page 1 is empty the first `emptyTimes` times it is asked. */
      const flakyFirstPage = (emptyTimes: number) => {
        const all = Array.from({ length: 250 }, (_, i) => `c${i}`)
        const calls: number[] = []
        let seen = 0
        const fetchPage: PageFetcher<string> = async (_w, page) => {
          calls.push(page)
          if (page === 1 && seen < emptyTimes) {
            seen++
            return { totalCount: 250, items: [] }
          }
          const from = (page - 1) * 100
          return { totalCount: 250, items: all.slice(from, from + 100) }
        }
        return { fetchPage, calls }
      }

      it('is retried, and the whole window is still collected', async () => {
        const { fetchPage, calls } = flakyFirstPage(1)
        const retries: Array<{ page: number; attempt: number }> = []
        const got: string[] = []
        const result = await collectWindow({ start: '2026-01-01', end: '2026-01-31' }, fetchPage, {
          onItems: async (items) => { got.push(...items) },
          onEmptyPageRetry: (_w, page, attempt) => { retries.push({ page, attempt }) },
        })
        expect(new Set(got).size).toBe(250)
        expect(result.complete).toBe(true)
        expect(retries).toEqual([{ page: 1, attempt: 1 }])
        // The probe, its one retry, then the remaining pages.
        expect(calls).toEqual([1, 1, 2, 3])
      })

      it('reports the window incomplete — without hanging — when it stays empty', async () => {
        const { fetchPage, calls } = flakyFirstPage(EMPTY_PAGE_RETRIES + 1)
        const retries: number[] = []
        const shortReads: Array<[number, number]> = []
        const done = new Map<string, boolean>()
        const result = await collectWindow({ start: '2026-01-01', end: '2026-01-31' }, fetchPage, {
          onItems: async () => {},
          onEmptyPageRetry: (_w, _page, attempt) => { retries.push(attempt) },
          onShortRead: (_w, collected, expected) => { shortReads.push([collected, expected]) },
          onDone: async (w, r) => { done.set(windowKey(w), r.complete) },
        })
        expect(result.complete).toBe(false)
        expect(shortReads).toEqual([[0, 250]])
        expect(done.get('2026-01-01..2026-01-31')).toBe(false)
        // Bounded by the same budget as any other page: the probe plus its retries.
        expect(retries).toEqual([1, 2])
        expect(calls).toEqual([1, 1, 1])
      })

      it('is NOT retried for a genuinely empty window — that still costs one request', async () => {
        const calls: number[] = []
        const fetchPage: PageFetcher<string> = async (_w, page) => {
          calls.push(page)
          return { totalCount: 0, items: [] }
        }
        const retries: number[] = []
        const result = await collectWindow({ start: '2015-01-01', end: '2015-12-31' }, fetchPage, {
          onItems: async () => {},
          onEmptyPageRetry: (_w, _page, attempt) => { retries.push(attempt) },
        })
        expect(calls).toEqual([1])
        expect(retries).toEqual([])
        expect(result.complete).toBe(true)
      })

      it('keeps the FIRST response\'s total_count, so a retry cannot rewrite the bar', async () => {
        // A soft-throttled response is exactly the kind that would under-report
        // the count. If a retry's smaller count governed, `expected` would drop
        // to 0, the window would report complete, and a 250-result window would
        // be cached as finished holding nothing.
        const calls: number[] = []
        const fetchPage: PageFetcher<string> = async (_w, page) => {
          calls.push(page)
          if (page === 1 && calls.filter((p) => p === 1).length === 1) {
            return { totalCount: 250, items: [] }
          }
          return { totalCount: 0, items: [] } // the retry now claims the window is empty
        }
        const result = await collectWindow({ start: '2026-01-01', end: '2026-01-31' }, fetchPage, {
          onItems: async () => {},
          onEmptyPageRetry: () => {},
        })
        expect(result.complete).toBe(false)
      })
    })

    it('is not cached as done, so the next run re-reads it and self-heals', async () => {
      // The end-to-end shape of the original bug: throttled run loses items,
      // healthy run recovers them, because the loss was never marked finished.
      const cache = new Set<string>()
      const w: DateWindow = { start: '2026-01-01', end: '2026-01-31' }
      const run = async (emptyTimes: number) => {
        const { fetchPage } = flakyFetcher(emptyTimes)
        const got: string[] = []
        const result = await collectWindow(w, fetchPage, {
          onItems: async (items) => { got.push(...items) },
          isDone: (x) => cache.has(windowKey(x)),
          onDone: async (x, r) => { if (r.complete) cache.add(windowKey(x)) },
        })
        return { got, result }
      }

      // Throttled: page 2 empty through every retry.
      const first = await run(EMPTY_PAGE_RETRIES + 1)
      expect(first.result.complete).toBe(false)
      expect(new Set(first.got).size).toBe(100)
      expect(cache.has(windowKey(w))).toBe(false) // the loss is not locked in

      // Healthy: the window is re-read rather than skipped, and recovers fully.
      const second = await run(0)
      expect(second.result.complete).toBe(true)
      expect(new Set(second.got).size).toBe(250)
      expect(cache.has(windowKey(w))).toBe(true)
    })
  })

  it('reports a window that split cleanly as COMPLETE, so resume can cache it', async () => {
    // The true direction of the completeness AND, which nothing else pinned. If
    // the recursive branch ever returned `complete: false` regardless, every
    // over-cap month would be excluded from the resume cache forever and each
    // sync would re-probe the entire history — slow and silent rather than wrong,
    // which is exactly why it needs a test rather than a bug report.
    const done = new Map<string, boolean>()
    const { fetchPage } = fakeApi({ '2026-07-05': 700, '2026-07-20': 731 })
    const w = { start: '2026-07-01', end: '2026-07-31' }
    const result = await collectWindow(w, fetchPage, {
      onItems: async () => {},
      onDone: async (x, r) => { done.set(windowKey(x), r.complete) },
    })
    expect(result.complete).toBe(true)
    expect(done.get(windowKey(w))).toBe(true)
    // Nothing anywhere in the tree was incomplete.
    expect([...done.values()].every((c) => c)).toBe(true)
  })

  it('marks a window complete only after it is fully collected', async () => {
    const done: string[] = []
    const { fetchPage } = fakeApi({ '2026-07-05': 700, '2026-07-20': 731 })
    await collectWindow({ start: '2026-07-01', end: '2026-07-31' }, fetchPage, {
      onItems: async () => {},
      onDone: async (w) => { done.push(windowKey(w)) },
    })
    // Children complete before their parent.
    expect(done[done.length - 1]).toBe('2026-07-01..2026-07-31')
    expect(done.length).toBeGreaterThan(1)
  })
})
