import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { assertGhReady, GhError } from './gh'
import { RateLimiter } from './ratelimit'
import {
  collectWindow, windowKey, yearWindows, EMPTY_PAGE_RETRIES, SEARCH_RESULT_CAP,
  type DateWindow, type WindowResult,
} from './windows'
import { emptyCache, loadCache, saveCache } from './cache'
import {
  fetchViewerCreatedAt, makeCommitFetcher, makePrFetcher, type ParsedPr,
} from './fetchers'
import type { CommitRecord, Dataset } from '../core/types'

const LOGIN = 'markhinch'
const SEARCH_PER_MINUTE = 28 // headroom under GitHub's 30/min search limit
const CACHE_PATH = resolve('.cache/ingest.json')
const OUT_PATH = resolve('public/data.json')
/** Re-query recent history to catch amended and late-arriving commits. */
const OVERLAP_DAYS = 3
/**
 * Backoff before re-requesting a page that came back empty. GitHub serves empty
 * pages when it is soft-throttling, and its secondary limits clear on the order
 * of a minute, so the waits are long rather than eager.
 */
const retryBackoffMs = (attempt: number): number => Math.min(60_000, 15_000 * 2 ** (attempt - 1))

const today = (): string => new Date().toISOString().slice(0, 10)

const shiftDays = (date: string, delta: number): string => {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + delta)
  return d.toISOString().slice(0, 10)
}

async function main(): Promise<void> {
  const full = process.argv.includes('--full')

  await assertGhReady()

  const cache = full ? emptyCache() : await loadCache(CACHE_PATH)
  const rangeEnd = today()
  const accountStart = await fetchViewerCreatedAt()

  // Incremental runs re-scan a short overlap; a full run rebuilds from scratch.
  const commitStart = !full && cache.watermark.commits
    ? shiftDays(cache.watermark.commits, -OVERLAP_DAYS)
    : accountStart
  const prStart = !full && cache.watermark.prs
    ? shiftDays(cache.watermark.prs, -OVERLAP_DAYS)
    : accountStart

  if (full) {
    console.log('Full rebuild requested — ignoring cached windows.')
  }
  console.log(`Commits: ${commitStart} → ${rangeEnd}`)
  console.log(`PRs:     ${prStart} → ${rangeEnd}`)
  console.log(`Search limited to ${SEARCH_PER_MINUTE}/min; a cold backfill takes ~4-5 minutes.\n`)

  const rl = new RateLimiter(SEARCH_PER_MINUTE)
  // Windows re-scanned by the overlap must not be skipped as "done".
  const staleFrom = shiftDays(rangeEnd, -OVERLAP_DAYS)
  const isDone = (list: string[]) => (w: DateWindow): boolean =>
    w.end < staleFrom && list.includes(windowKey(w))

  let flushed = 0
  const flush = async (): Promise<void> => {
    await saveCache(CACHE_PATH, cache)
    flushed++
  }

  /**
   * Records a finished window, then persists.
   *
   * The `complete` gate is the whole point: an incomplete window has provably
   * lost items, so marking it done would make `isDone` skip it *before the
   * probe* on the next run — `onUnsplittable` would never fire again and every
   * later sync would under-report in total silence. The records that were
   * reachable are still worth keeping, so the flush happens either way; only
   * the "skip me next time" marker is withheld.
   */
  const finishWindow = async (
    list: string[],
    w: DateWindow,
    result: WindowResult,
  ): Promise<void> => {
    const key = windowKey(w)
    if (result.complete && !list.includes(key)) list.push(key)
    await flush()
  }

  // Days the API refuses to serve in full. Collected from `onUnsplittable`,
  // which fires exactly once per such day, so this is the shortest honest
  // description of what is missing (an incomplete day also marks every
  // enclosing window incomplete, which would be far noisier to list).
  const unreachableCommitDays: string[] = []
  const unreachablePrDays: string[] = []
  const shortReads: string[] = []

  /**
   * Hands the retry wait to the rate limiter, whose next `acquire()` honours the
   * pause. Injecting it this way is what keeps `windows.ts` free of any
   * dependency on the limiter.
   */
  const onEmptyPageRetry = (w: DateWindow, page: number, attempt: number): void => {
    const wait = retryBackoffMs(attempt)
    rl.pauseFor(wait)
    console.error(
      `  .. ${windowKey(w)} page ${page} came back empty with results still outstanding; ` +
      `retrying in ${Math.round(wait / 1000)}s (attempt ${attempt}/${EMPTY_PAGE_RETRIES}).`,
    )
  }

  const onShortRead = (noun: string, into: string[]) =>
    (w: DateWindow, collected: number, expected: number): void => {
      into.push(`${windowKey(w)} (${collected}/${expected} ${noun})`)
      console.error(
        `\n!! ${windowKey(w)} served only ${collected} of ${expected} ${noun} even after ` +
        `retries. NOT cached as done — the next sync will re-read this window.\n`,
      )
    }

  // ---- commits ----
  const commitFetcher = makeCommitFetcher(LOGIN, rl)
  let commitCount = 0
  for (const seed of yearWindows(commitStart, rangeEnd)) {
    await collectWindow<CommitRecord>(seed, commitFetcher, {
      isDone: isDone(cache.doneWindows.commits),
      onItems: async (items) => {
        for (const c of items) cache.commits[c.sha] = c // dedupe by SHA
        commitCount += items.length
      },
      onDone: (w, result) => finishWindow(cache.doneWindows.commits, w, result),
      onEmptyPageRetry,
      onShortRead: onShortRead('commits', shortReads),
      onProgress: (w, total) => {
        process.stdout.write(`  commits ${windowKey(w)}: ${total}\n`)
      },
      onUnsplittable: (w, total) => {
        unreachableCommitDays.push(windowKey(w))
        console.error(
          `\n!! ${windowKey(w)} reports ${total} commits but the API serves at most ` +
          `${SEARCH_RESULT_CAP} for a single day. ${total - SEARCH_RESULT_CAP} commits are ` +
          `UNREACHABLE and missing from the dataset.\n`,
        )
      },
    })
  }
  cache.watermark.commits = rangeEnd

  // ---- merged PRs ----
  const prFetcher = makePrFetcher(LOGIN, rl)
  for (const seed of yearWindows(prStart, rangeEnd)) {
    await collectWindow<ParsedPr>(seed, prFetcher, {
      isDone: isDone(cache.doneWindows.prs),
      onItems: async (items) => {
        for (const p of items) cache.prs[p.id] = p.record
      },
      onDone: (w, result) => finishWindow(cache.doneWindows.prs, w, result),
      onEmptyPageRetry,
      onShortRead: onShortRead('merged PRs', shortReads),
      onProgress: (w, total) => {
        process.stdout.write(`  PRs ${windowKey(w)}: ${total}\n`)
      },
      onUnsplittable: (w, total) => {
        unreachablePrDays.push(windowKey(w))
        console.error(
          `\n!! ${windowKey(w)} has ${total} merged PRs; only ${SEARCH_RESULT_CAP} reachable.\n`,
        )
      },
    })
  }
  cache.watermark.prs = rangeEnd

  await saveCache(CACHE_PATH, cache)

  const dataset: Dataset = {
    commits: Object.values(cache.commits),
    mergedPrs: Object.values(cache.prs),
    meta: { syncedAt: new Date().toISOString(), rangeStart: accountStart, rangeEnd },
  }
  await mkdir(dirname(OUT_PATH), { recursive: true })
  await writeFile(OUT_PATH, JSON.stringify(dataset), 'utf8')

  console.log(
    `\nDone. ${dataset.commits.length} commits, ${dataset.mergedPrs.length} merged PRs ` +
    `(${commitCount} commit rows fetched this run, ${flushed} cache flushes).`,
  )
  // Restated at the end because the per-window warnings above are easy to lose
  // in several hundred lines of progress output.
  if (unreachableCommitDays.length > 0 || unreachablePrDays.length > 0) {
    // Never cached as done, so these keep warning on every run that covers them.
    console.error(
      `\n!! DATA IS INCOMPLETE — days over the ${SEARCH_RESULT_CAP}-result cap ` +
      `(permanently unreachable):\n` +
      `   commits: ${unreachableCommitDays.join(', ') || '(none)'}\n` +
      `   PRs:     ${unreachablePrDays.join(', ') || '(none)'}\n`,
    )
  }
  if (shortReads.length > 0) {
    // Unlike the cap, this is usually transient throttling — and because the
    // window is not cached as done, the next run re-reads it and self-heals.
    console.error(
      `\n!! ${shortReads.length} window(s) read short of their reported count and were NOT ` +
      `cached as done. Re-run \`pnpm sync\` to re-read them:\n` +
      shortReads.map((s) => `   ${s}`).join('\n') + '\n',
    )
  }
  console.log(`Wrote ${OUT_PATH}`)
}

main().catch((err: unknown) => {
  if (err instanceof GhError) {
    console.error(`\n${err.message}`)
    if (err.stderr) console.error(err.stderr)
  } else {
    console.error('\nSync failed:', err)
  }
  console.error('\nProgress is cached — re-run `pnpm sync` to resume.')
  process.exit(1)
})
