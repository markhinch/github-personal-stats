import { OTHER_KEY } from '../core/topRepos'

/**
 * The categorical slots, in fixed assignment order. Read as CSS custom
 * properties so the chart follows the colour scheme without a JS media query,
 * the same way the rest of the chart reads its tokens.
 */
const SLOTS = [
  'var(--color-series-1)',
  'var(--color-series-2)',
  'var(--color-series-3)',
  'var(--color-series-4)',
  'var(--color-series-5)',
] as const

const OTHER_COLOR = 'var(--color-series-other)'

/** How many repos can be given a distinct hue. The fold's limit. */
export const MAX_SERIES = SLOTS.length

/**
 * Maps each segment of a stack to its colour.
 *
 * Throws past the last slot rather than cycling: a repeated hue would make two
 * segments of one bar indistinguishable, which is worse than a loud failure.
 * Callers bound the set with `foldToTopRepos(points, MAX_SERIES)`.
 */
export function segmentColors(
  repos: readonly string[],
  hasOther: boolean,
): Record<string, string> {
  if (repos.length > MAX_SERIES) {
    throw new Error(`${repos.length} repos exceeds MAX_SERIES (${MAX_SERIES})`)
  }

  const colors: Record<string, string> = {}
  repos.forEach((repo, i) => {
    colors[repo] = SLOTS[i]!
  })
  if (hasOther) colors[OTHER_KEY] = OTHER_COLOR

  return colors
}
