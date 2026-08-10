import { describe, it, expect } from 'vitest'
import { buildRepoStack, OTHER_KEY } from '../core/topRepos'
import type { Dataset } from '../core/types'
import { MAX_SERIES, segmentColors } from './palette'

describe('segmentColors', () => {
  it('assigns the categorical slots in stack order', () => {
    expect(segmentColors(['o/a', 'o/b'], false)).toEqual({
      'o/a': 'var(--color-series-1)',
      'o/b': 'var(--color-series-2)',
    })
  })

  it('gives Other the neutral, never a categorical slot', () => {
    const colors = segmentColors(['o/a'], true)
    expect(colors[OTHER_KEY]).toBe('var(--color-series-other)')
    expect(colors['o/a']).toBe('var(--color-series-1)')
  })

  it('omits Other when there is none', () => {
    expect(segmentColors(['o/a'], false)).not.toHaveProperty(OTHER_KEY)
  })

  it('covers a full stack at the maximum', () => {
    const repos = Array.from({ length: MAX_SERIES }, (_, i) => `o/${i}`)
    const colors = segmentColors(repos, true)
    expect(Object.keys(colors)).toHaveLength(MAX_SERIES + 1)
    expect(colors[`o/${MAX_SERIES - 1}`]).toBe(`var(--color-series-${MAX_SERIES})`)
  })

  it('throws rather than cycling hues past the last slot', () => {
    const repos = Array.from({ length: MAX_SERIES + 1 }, (_, i) => `o/${i}`)
    expect(() => segmentColors(repos, false)).toThrow(/MAX_SERIES/)
  })

  it('is the palette size the fold should be limited to', () => {
    expect(MAX_SERIES).toBe(5)
  })

  // Guards the seam between the two modules: buildRepoStack is the caller's
  // only source of a repo list, so it must never hand segmentColors more
  // repos than MAX_SERIES lets it colour.
  it('never throws on a stack built at the fold limit, however many repos the dataset has', () => {
    const repoCount = MAX_SERIES + 2
    const ds: Dataset = {
      commits: Array.from({ length: repoCount }, (_, i) => ({
        sha: `sha-${i}`,
        repo: `o/repo-${i}`,
        authoredAt: '2026-05-01T00:00:00Z',
      })),
      mergedPrs: [],
      meta: { syncedAt: '2026-08-31T00:00:00Z', rangeStart: '2026-01-01', rangeEnd: '2026-08-31' },
    }
    const stack = buildRepoStack(
      ds,
      { bucket: 'month', metric: 'commits', orgs: new Set(['o']) },
      null,
      MAX_SERIES,
    )
    expect(() => segmentColors(stack.repos, stack.hasOther)).not.toThrow()
  })
})
