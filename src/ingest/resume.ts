import { windowKey, type DateWindow, type WindowResult } from './windows'

/**
 * The two decisions that turn `collectWindow`'s honest `complete` flag into a
 * resume-cache entry.
 *
 * They live here, apart from the sync CLI, because this is the seam where a
 * mistake is not merely wrong once. `isDone` is consulted *before* the size
 * probe, so a window wrongly recorded as done is never looked at again: the
 * probe never runs, `onUnsplittable`/`onShortRead` never fire, and every later
 * `pnpm sync` under-reports in total silence. The flag itself is well covered in
 * `windows.test.ts`; what needed covering is what the caller does with it.
 */

/**
 * Builds the predicate `collectWindow` consults to skip a window entirely.
 *
 * Two conditions, both required:
 *
 * - the window must be recorded in `doneWindows` — i.e. a previous run read it
 *   in full, `complete` and all; and
 * - the window must end strictly before `staleFrom` — the start of the overlap
 *   period the incremental run deliberately re-reads. Commits get amended and
 *   arrive late, so a window overlapping recent history is *never* trustworthy
 *   as "done" no matter what the cache says. Dropping this clause would make
 *   every incremental run skip the very days the overlap exists to re-check.
 *
 * `doneWindows` is read at call time rather than copied, so a window finished
 * earlier in the same run is visible to the predicate — matching the previous
 * inline behaviour exactly.
 */
export function makeIsDone(
  doneWindows: readonly string[],
  staleFrom: string,
): (w: DateWindow) => boolean {
  return (w) => w.end < staleFrom && doneWindows.includes(windowKey(w))
}

/**
 * Records a finished window in the resume list, then persists.
 *
 * The `complete` gate is the whole point. An incomplete window has provably lost
 * items, so marking it done would make `makeIsDone` skip it before the probe on
 * the next run and suppress the warning along with it. The records that *were*
 * reachable are still worth keeping, so the flush happens either way; only the
 * "skip me next time" marker is withheld.
 */
export async function finishWindow(
  doneWindows: string[],
  w: DateWindow,
  result: WindowResult,
  flush: () => Promise<void>,
): Promise<void> {
  const key = windowKey(w)
  if (result.complete && !doneWindows.includes(key)) doneWindows.push(key)
  await flush()
}
