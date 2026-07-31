import { describe, it, expect, vi } from 'vitest'
import { finishWindow, makeIsDone } from './resume'
import { collectWindow, windowKey, type DateWindow, type PageFetcher } from './windows'

const W = (start: string, end: string): DateWindow => ({ start, end })

describe('finishWindow', () => {
  it('records a complete window so the next run can skip it', async () => {
    const done: string[] = []
    const flush = vi.fn(async () => {})
    await finishWindow(done, W('2026-01-01', '2026-01-31'), { complete: true }, flush)
    expect(done).toEqual(['2026-01-01..2026-01-31'])
    expect(flush).toHaveBeenCalledTimes(1)
  })

  it('REFUSES to record an incomplete window, but still flushes what was collected', async () => {
    // The gate that matters. Recording an incomplete window would make
    // `makeIsDone` skip it before the size probe on every future run, so the
    // shortfall would never be re-read and never be warned about again. The
    // records that *were* reachable are still worth persisting.
    const done: string[] = []
    const flush = vi.fn(async () => {})
    await finishWindow(done, W('2026-05-01', '2026-05-31'), { complete: false }, flush)
    expect(done).toEqual([])
    expect(flush).toHaveBeenCalledTimes(1)
  })

  it('does not record the same window twice', async () => {
    const done = ['2026-01-01..2026-01-31']
    await finishWindow(done, W('2026-01-01', '2026-01-31'), { complete: true }, async () => {})
    expect(done).toEqual(['2026-01-01..2026-01-31'])
  })

  it('propagates a flush failure instead of swallowing it', async () => {
    const done: string[] = []
    await expect(
      finishWindow(done, W('2026-01-01', '2026-01-31'), { complete: true }, async () => {
        throw new Error('disk full')
      }),
    ).rejects.toThrow('disk full')
  })
})

describe('makeIsDone', () => {
  const staleFrom = '2026-07-28' // rangeEnd 2026-07-31 minus the 3-day overlap

  it('skips a cached window that ended before the overlap period', () => {
    const isDone = makeIsDone(['2026-06-01..2026-06-30'], staleFrom)
    expect(isDone(W('2026-06-01', '2026-06-30'))).toBe(true)
  })

  it('REFUSES to skip a cached window whose end falls inside the overlap period', () => {
    // Commits get amended and arrive late, which is the entire reason the
    // incremental run re-reads a trailing overlap. A cache hit must not be
    // allowed to skip those days.
    const isDone = makeIsDone(
      ['2026-07-01..2026-07-31', '2026-07-28..2026-07-28', '2026-07-20..2026-07-29'],
      staleFrom,
    )
    expect(isDone(W('2026-07-01', '2026-07-31'))).toBe(false) // ends after staleFrom
    expect(isDone(W('2026-07-28', '2026-07-28'))).toBe(false) // ends exactly at staleFrom
    expect(isDone(W('2026-07-20', '2026-07-29'))).toBe(false) // straddles staleFrom
  })

  it('does not skip a window that is not in the cache', () => {
    const isDone = makeIsDone(['2026-06-01..2026-06-30'], staleFrom)
    expect(isDone(W('2026-05-01', '2026-05-31'))).toBe(false)
  })

  it('sees windows appended during the same run', () => {
    const done: string[] = []
    const isDone = makeIsDone(done, staleFrom)
    expect(isDone(W('2026-06-01', '2026-06-30'))).toBe(false)
    done.push('2026-06-01..2026-06-30')
    expect(isDone(W('2026-06-01', '2026-06-30'))).toBe(true)
  })
})

/**
 * The seam itself, wired the way `sync.ts` wires it: `collectWindow`'s honest
 * `complete` flag, through the real `finishWindow`, into a real `doneWindows`
 * list that the real `makeIsDone` then consults on a second run.
 *
 * `isDone` is checked *before* the size probe, so a wrongly-cached window is not
 * wrong once — it is silently wrong forever, with the warning suppressed.
 */
describe('the resume seam across two runs', () => {
  /** Days over 1000 are capped, as the real Search API caps them. */
  const fakeApi = (countsByDay: Record<string, number>) => {
    const calls: Array<{ window: string; page: number }> = []
    const fetchPage: PageFetcher<string> = async (w, page) => {
      calls.push({ window: windowKey(w), page })
      const all: string[] = []
      for (const [day, n] of Object.entries(countsByDay)) {
        if (day >= w.start && day <= w.end) {
          for (let i = 0; i < n; i++) all.push(`${day}#${i}`)
        }
      }
      all.sort()
      const from = (page - 1) * 100
      return { totalCount: all.length, items: all.slice(0, 1000).slice(from, from + 100) }
    }
    return { fetchPage, calls }
  }

  it('keeps re-probing and re-warning about an over-cap day, run after run', async () => {
    const doneWindows: string[] = []
    const staleFrom = '2026-07-28'
    // 2026-07-05 holds more than the API will serve; 2026-07-06 is ordinary.
    const counts = { '2026-07-05': 1200, '2026-07-06': 120 }

    const run = async () => {
      const onUnsplittable = vi.fn()
      const { fetchPage, calls } = fakeApi(counts)
      await collectWindow(W('2026-07-05', '2026-07-06'), fetchPage, {
        onItems: async () => {},
        onUnsplittable,
        isDone: makeIsDone(doneWindows, staleFrom),
        onDone: (w, r) => finishWindow(doneWindows, w, r, async () => {}),
      })
      return { onUnsplittable, calls }
    }

    await run()
    // The incomplete day and its incomplete parent stay out of the cache; only
    // the sibling that was genuinely exhausted is recorded.
    expect(doneWindows).toEqual(['2026-07-06..2026-07-06'])

    const second = await run()
    // Still probed, still warned about — not silently short forever.
    expect(second.onUnsplittable).toHaveBeenCalledTimes(1)
    expect(second.calls.some((c) => c.window === '2026-07-05..2026-07-05')).toBe(true)
    // ...while the complete sibling is skipped, so resume still saves requests.
    expect(second.calls.some((c) => c.window === '2026-07-06..2026-07-06')).toBe(false)
  })

  it('re-reads a cached window that reaches into the overlap period', async () => {
    // A window that a previous run completed and cached, but which ends inside
    // the trailing overlap: it must be fetched again anyway.
    const doneWindows = ['2026-07-29..2026-07-31']
    const { fetchPage, calls } = fakeApi({ '2026-07-30': 5 })
    await collectWindow(W('2026-07-29', '2026-07-31'), fetchPage, {
      onItems: async () => {},
      isDone: makeIsDone(doneWindows, '2026-07-28'),
      onDone: (w, r) => finishWindow(doneWindows, w, r, async () => {}),
    })
    expect(calls).toHaveLength(1)
  })
})
