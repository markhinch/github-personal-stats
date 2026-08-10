import { buildRepoSeries, type RepoPoint, type SeriesOptions } from './aggregate'
import type { Dataset } from './types'
import { windowSeries } from './window'

/**
 * The catch-all segment. Safe as a field name beside repo ids: every repo id
 * contains a "/" (see `isRepoId`), so no repo can ever collide with it.
 */
export const OTHER_KEY = 'Other'

/** One bucket, reduced to the bounded set of segments a bar can actually show. */
export interface StackPoint {
  key: string
  label: string
  total: number
  /** Repo id — or OTHER_KEY — to value. Every point carries the same fields. */
  values: Record<string, number>
}

export interface RepoStack {
  /** Stack order, largest first. At most `limit` entries. */
  repos: string[]
  /** Whether an Other segment is present. */
  hasOther: boolean
  points: StackPoint[]
}

/**
 * Bounds a windowed per-repo series to the `limit` largest repos plus an Other
 * segment, so a bar never asks for more colours than a categorical palette can
 * distinguish.
 *
 * Ranking is over the points passed in — which are already windowed — so the
 * segments describe what is on screen rather than the dataset as a whole. The
 * cost is that a repo's colour is positional and can change between views; the
 * legend sits under the plot in stack order to carry that.
 */
export function foldToTopRepos(points: readonly RepoPoint[], limit: number): RepoStack {
  const totals = new Map<string, number>()
  for (const p of points) {
    for (const [repo, value] of Object.entries(p.byRepo)) {
      totals.set(repo, (totals.get(repo) ?? 0) + value)
    }
  }

  // Descending by total, then by id, so equal totals never reorder run to run.
  const ranked = [...totals.keys()].sort((a, b) => {
    const diff = totals.get(b)! - totals.get(a)!
    return diff !== 0 ? diff : a.localeCompare(b)
  })

  const repos = ranked.slice(0, limit)
  const hasOther = ranked.length > limit
  const top = new Set(repos)

  const stackPoints = points.map((p) => {
    const values: Record<string, number> = {}
    for (const repo of repos) values[repo] = p.byRepo[repo] ?? 0
    if (hasOther) {
      let other = 0
      for (const [repo, value] of Object.entries(p.byRepo)) {
        if (!top.has(repo)) other += value
      }
      values[OTHER_KEY] = other
    }
    return { key: p.key, label: p.label, total: p.total, values }
  })

  return { repos, hasOther, points: stackPoints }
}

/**
 * Builds the per-repo stack for a dataset, in the one order that matters:
 * aggregate the whole dataset, THEN window it, THEN rank. Ranking after
 * windowing is what makes segments describe the visible range rather than
 * the dataset as a whole — the reason this is a named function rather than
 * three calls inlined at the call site is so that order is something a test
 * can pin down instead of something only a diff's shape enforces.
 */
export function buildRepoStack(
  ds: Dataset,
  opts: SeriesOptions,
  startKey: string | null,
  limit: number,
): RepoStack {
  return foldToTopRepos(windowSeries(buildRepoSeries(ds, opts), startKey), limit)
}

/** Rows for one bucket's breakdown: zero-valued repos dropped, descending, Other last. */
export function breakdownRows(values: Record<string, number>): Array<[string, number]> {
  // Zero-valued repos are padding for the stack's shape, not part of the
  // bucket's story, so they are dropped here. Other always sorts last,
  // regardless of value, so the catch-all reads as a footnote, not a winner.
  return Object.entries(values)
    .filter(([, value]) => value > 0)
    .sort(([aKey, aValue], [bKey, bValue]) => {
      if (aKey === OTHER_KEY) return 1
      if (bKey === OTHER_KEY) return -1
      return bValue - aValue
    })
}

/** Stack order: ranked repos, then Other when present. Drives bar order, legend order and the rounded cap. */
export function stackSegments(stack: RepoStack): string[] {
  return stack.hasOther ? [...stack.repos, OTHER_KEY] : stack.repos
}
