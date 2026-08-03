/**
 * Most value labels that fit across the plot without colliding — roughly one per
 * 34px of an ~880px plot.
 */
const MAX_LABELS = 26

/**
 * Which bars get a value written above them.
 *
 * Every bar is labelled when they all fit, because the point of the labels is to
 * read the numbers off a screenshot without hovering. Past MAX_LABELS bars,
 * though, thinning to every nth doesn't help: the bars are then narrower than
 * the text, so a label sits over its neighbours rather than over its own bar. So
 * the dense case falls back to the two numbers a reader actually looks for — the
 * peak and the latest bucket — and the axis and tooltip carry the rest.
 *
 * Empty buckets are never labelled either way: a row of "0"s along the baseline
 * is noise, and the gap already says it.
 */
export function labelledIndices(values: readonly number[]): Set<number> {
  const n = values.length
  const out = new Set<number>()
  if (n === 0) return out

  const nonZero = (i: number): boolean => values[i] !== 0

  if (n <= MAX_LABELS) {
    for (let i = 0; i < n; i++) if (nonZero(i)) out.add(i)
    return out
  }

  let peak = 0
  for (let i = 1; i < n; i++) if (values[i]! > values[peak]!) peak = i
  if (nonZero(peak)) out.add(peak)

  for (let i = n - 1; i >= 0; i--) {
    if (nonZero(i)) {
      out.add(i)
      break
    }
  }

  return out
}
