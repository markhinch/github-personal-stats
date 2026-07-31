/** Shifts a `YYYY-MM-DD` date by whole days, via UTC so no local offset applies. */
export function shiftDays(date: string, delta: number): string {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + delta)
  return d.toISOString().slice(0, 10)
}

/**
 * The watermark to persist for one metric after a run.
 *
 * The watermark is where the next incremental run starts, so it is the thing
 * that decides whether an incomplete window is ever looked at again. Withholding
 * a window from `doneWindows` is not enough on its own: if the watermark has
 * advanced past that window, the next run's range never reaches it and the
 * withheld marker is irrelevant. So a run that read short rewinds the watermark
 * to just before the earliest window that read short, and the next run re-reads
 * from there.
 *
 * Only short reads clamp. A day over the API's result cap is permanently over
 * the cap, so clamping for one would force a full re-backfill on every run
 * forever without ever recovering anything.
 *
 * Passing an empty list must return `rangeEnd` — otherwise a healthy run would
 * re-collect history it already has.
 */
export function nextWatermark(rangeEnd: string, shortReadStarts: readonly string[]): string {
  if (shortReadStarts.length === 0) return rangeEnd
  // ISO dates sort lexicographically, so the smallest string is the earliest day.
  const earliest = shortReadStarts.reduce((min, s) => (s < min ? s : min))
  // One day before, so the short window itself is inside the next run's range.
  return shiftDays(earliest, -1)
}
