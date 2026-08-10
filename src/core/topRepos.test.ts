import { describe, it, expect } from 'vitest'
import type { RepoPoint, SeriesOptions } from './aggregate'
import {
  breakdownRows, buildRepoStack, foldToTopRepos, OTHER_KEY, stackSegments, type RepoStack,
} from './topRepos'
import type { Dataset } from './types'

/** Builds one bucket from a repo -> value map. */
const point = (key: string, byRepo: Record<string, number>): RepoPoint => ({
  key,
  label: key,
  total: Object.values(byRepo).reduce((a, b) => a + b, 0),
  byRepo,
})

/** A dataset of commits only, from repos sharing the same org. */
const commitDataset = (commits: Array<{ repo: string; authoredAt: string }>): Dataset => ({
  commits: commits.map((c, i) => ({ sha: `sha-${i}`, ...c })),
  mergedPrs: [],
  meta: { syncedAt: '2026-08-31T00:00:00Z', rangeStart: '2026-01-01', rangeEnd: '2026-08-31' },
})

const monthlyCommits: SeriesOptions = { bucket: 'month', metric: 'commits', orgs: new Set(['o']) }

describe('foldToTopRepos', () => {
  it('ranks repos by their total across the window, largest first', () => {
    const stack = foldToTopRepos(
      [point('a', { 'o/small': 1, 'o/big': 10 }), point('b', { 'o/small': 2, 'o/big': 1 })],
      5,
    )
    expect(stack.repos).toEqual(['o/big', 'o/small'])
  })

  it('ranks on the window total, not on any single bucket', () => {
    // o/steady never wins a bucket outright but wins the window.
    const stack = foldToTopRepos(
      [point('a', { 'o/spike': 9, 'o/steady': 5 }), point('b', { 'o/steady': 5 })],
      5,
    )
    expect(stack.repos).toEqual(['o/steady', 'o/spike'])
  })

  it('breaks ties on repo id ascending so the order is deterministic', () => {
    const stack = foldToTopRepos([point('a', { 'o/b': 5, 'o/a': 5, 'o/c': 5 })], 5)
    expect(stack.repos).toEqual(['o/a', 'o/b', 'o/c'])
  })

  it('keeps the top `limit` and folds the rest into Other', () => {
    const stack = foldToTopRepos(
      [point('a', { 'o/1': 10, 'o/2': 9, 'o/3': 8, 'o/4': 7, 'o/5': 6, 'o/6': 5, 'o/7': 4 })],
      5,
    )
    expect(stack.repos).toEqual(['o/1', 'o/2', 'o/3', 'o/4', 'o/5'])
    expect(stack.hasOther).toBe(true)
    expect(stack.points[0]?.values[OTHER_KEY]).toBe(9)
  })

  it('has no Other segment at exactly the limit', () => {
    const stack = foldToTopRepos([point('a', { 'o/1': 3, 'o/2': 2, 'o/3': 1 })], 3)
    expect(stack.hasOther).toBe(false)
    expect(stack.points[0]?.values).not.toHaveProperty(OTHER_KEY)
  })

  it('writes an explicit zero for a repo absent from a bucket', () => {
    const stack = foldToTopRepos([point('a', { 'o/x': 1 }), point('b', { 'o/y': 1 })], 5)
    expect(stack.points[0]?.values).toEqual({ 'o/x': 1, 'o/y': 0 })
  })

  it('carries key, label and total through unchanged', () => {
    const stack = foldToTopRepos([point('2026-07', { 'o/x': 4 })], 5)
    expect(stack.points[0]).toMatchObject({ key: '2026-07', label: '2026-07', total: 4 })
  })

  it('returns an empty stack for empty input', () => {
    expect(foldToTopRepos([], 5)).toEqual({ repos: [], hasOther: false, points: [] })
  })

  it('names no repos for a window in which nothing happened', () => {
    // Gap-filled buckets are real points with no repos — not the same as no data.
    const stack = foldToTopRepos([point('a', {}), point('b', {})], 5)
    expect(stack.repos).toEqual([])
    expect(stack.hasOther).toBe(false)
    expect(stack.points).toHaveLength(2)
  })

  it('gives a repo with only a zero window total no slot, and no Other on its own', () => {
    // A merged PR with additions + deletions === 0 still records an explicit
    // zero for its repo — real activity, but nothing to rank on.
    const stack = foldToTopRepos([point('a', { 'o/1': 5, 'o/2': 4, 'o/3': 0 })], 5)
    expect(stack.repos).toEqual(['o/1', 'o/2'])
    expect(stack.hasOther).toBe(false)
  })

  it('excludes a zero-total repo from ranking even when it would otherwise fill the last slot', () => {
    const stack = foldToTopRepos(
      [point('a', { 'o/1': 5, 'o/2': 4, 'o/3': 3, 'o/4': 2, 'o/5': 1, 'o/zero': 0 })],
      5,
    )
    expect(stack.repos).toEqual(['o/1', 'o/2', 'o/3', 'o/4', 'o/5'])
    expect(stack.hasOther).toBe(false)
  })
})

describe('buildRepoStack', () => {
  it('ranks on the windowed total, not the whole dataset — the order that makes the window meaningful', () => {
    const ds = commitDataset([
      // Dominates the dataset outright, but every commit predates the window.
      ...Array.from({ length: 20 }, () => ({ repo: 'o/outside', authoredAt: '2026-01-05T00:00:00Z' })),
      // The only activity the window contains.
      { repo: 'o/inside', authoredAt: '2026-03-01T00:00:00Z' },
    ])
    // Window starts in February; the January burst falls outside it.
    const stack = buildRepoStack(ds, monthlyCommits, '2026-02', 1)
    expect(stack.repos).toEqual(['o/inside'])
  })

  it('windows before ranking, so a bucket before startKey is absent from the result', () => {
    const ds = commitDataset([
      { repo: 'o/a', authoredAt: '2026-01-05T00:00:00Z' },
      { repo: 'o/a', authoredAt: '2026-03-05T00:00:00Z' },
    ])
    const stack = buildRepoStack(ds, monthlyCommits, '2026-02', 5)
    // February is the window start though there was no activity in it —
    // gap-filled, not skipped — and January is gone entirely.
    expect(stack.points.map((p) => p.key)).toEqual(['2026-02', '2026-03'])
  })

  it('passes a null startKey through as an unbounded window', () => {
    const ds = commitDataset([
      { repo: 'o/a', authoredAt: '2026-01-05T00:00:00Z' },
      { repo: 'o/a', authoredAt: '2026-03-05T00:00:00Z' },
    ])
    const stack = buildRepoStack(ds, monthlyCommits, null, 5)
    expect(stack.points.map((p) => p.key)).toEqual(['2026-01', '2026-02', '2026-03'])
  })
})

describe('breakdownRows', () => {
  it('drops zero-valued repos', () => {
    expect(breakdownRows({ 'o/a': 3, 'o/b': 0 })).toEqual([['o/a', 3]])
  })

  it('sorts by value descending', () => {
    expect(breakdownRows({ 'o/small': 1, 'o/big': 10 })).toEqual([['o/big', 10], ['o/small', 1]])
  })

  it('forces Other last even when its value is the largest', () => {
    expect(breakdownRows({ 'o/a': 1, [OTHER_KEY]: 99 })).toEqual([['o/a', 1], [OTHER_KEY, 99]])
  })

  it('returns an empty array for empty input', () => {
    expect(breakdownRows({})).toEqual([])
  })
})

describe('stackSegments', () => {
  const stack = (repos: string[], hasOther: boolean): RepoStack => ({ repos, hasOther, points: [] })

  it('appends Other only when hasOther is true', () => {
    expect(stackSegments(stack(['o/a', 'o/b'], true))).toEqual(['o/a', 'o/b', OTHER_KEY])
  })

  it('omits Other when hasOther is false', () => {
    expect(stackSegments(stack(['o/a', 'o/b'], false))).toEqual(['o/a', 'o/b'])
  })

  it('preserves repo order', () => {
    expect(stackSegments(stack(['o/z', 'o/a'], false))).toEqual(['o/z', 'o/a'])
  })

  it('returns an empty array for an empty stack', () => {
    expect(stackSegments(stack([], false))).toEqual([])
  })
})
