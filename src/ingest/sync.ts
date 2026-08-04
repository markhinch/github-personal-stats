import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { assertGhReady, GhError, TRANSIENT_RETRIES } from './gh'
import { RateLimiter } from './ratelimit'
import {
  collectWindow, windowKey, yearWindows, EMPTY_PAGE_RETRIES, SEARCH_RESULT_CAP,
  type DateWindow,
} from './windows'
import { emptyCache, loadCache, saveCache } from './cache'
import { finishWindow, makeIsDone } from './resume'
import { isEntryPoint } from './entrypoint'
import {
  fetchViewerCreatedAt, fetchViewerOrgs, makeCommitFetcher, makePrFetcher, type ParsedPr,
} from './fetchers'
import { preferRepo, type OwnedIdentity } from './attribution'
import { nextWatermark, shiftDays } from './watermark'
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

export async function main(): Promise<void> {
  const full = process.argv.includes('--full')

  await assertGhReady()

  const cache = full ? emptyCache() : await loadCache(CACHE_PATH)
  const rangeEnd = today()
  const accountStart = await fetchViewerCreatedAt()
  const identity: OwnedIdentity = { login: LOGIN, orgs: await fetchViewerOrgs() }

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
  console.log(`Attributing fork-duplicated commits to: ${[LOGIN, ...identity.orgs].join(', ')}`)
  console.log(`Search limited to ${SEARCH_PER_MINUTE}/min; a cold backfill takes ~4-5 minutes.\n`)

  const rl = new RateLimiter(SEARCH_PER_MINUTE)
  // Start of the overlap period the incremental run deliberately re-reads. It is
  // consumed by `makeIsDone`, which — together with `finishWindow`'s `complete`
  // gate — lives in ./resume, where both decisions are tested.
  const staleFrom = shiftDays(rangeEnd, -OVERLAP_DAYS)

  let flushed = 0
  const flush = async (): Promise<void> => {
    await saveCache(CACHE_PATH, cache)
    flushed++
  }

  // Days the API refuses to serve in full. Collected from `onUnsplittable`,
  // which fires exactly once per such day, so this is the shortest honest
  // description of what is missing (an incomplete day also marks every
  // enclosing window incomplete, which would be far noisier to list).
  const unreachableCommitDays: string[] = []
  const unreachablePrDays: string[] = []
  /**
   * Short reads per metric, kept apart so commits and PRs cannot clamp each
   * other's watermark: a short PR window must not force commits to re-collect a
   * year they already have, or vice versa.
   */
  const shortReads = {
    commits: [] as string[],
    prs: [] as string[],
  }
  /** Window starts, per metric, used to rewind the watermark. */
  const shortReadStarts = {
    commits: [] as string[],
    prs: [] as string[],
  }

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

  /**
   * A transient API failure (a search-backend 502, a 503, a 429) pauses and
   * re-attempts the same request rather than ending the run.
   *
   * Worth the wait: without it a single 502 discarded a whole 4-5 minute
   * backfill, and the identical request — same window, same cursor — succeeded on
   * the following run. Same backoff as the empty-page path, so there is one
   * retry-delay policy to reason about.
   */
  const onTransientError = (err: GhError, attempt: number): void => {
    const wait = retryBackoffMs(attempt)
    rl.pauseFor(wait)
    console.error(
      `  .. request failed with HTTP ${err.status ?? '?'}; retrying in ` +
      `${Math.round(wait / 1000)}s (attempt ${attempt}/${TRANSIENT_RETRIES}).`,
    )
  }

  const onShortRead = (noun: string, metric: 'commits' | 'prs') =>
    (w: DateWindow, collected: number, expected: number): void => {
      shortReads[metric].push(`${windowKey(w)} (${collected}/${expected} ${noun})`)
      shortReadStarts[metric].push(w.start)
      console.error(
        `\n!! ${windowKey(w)} served only ${collected} of ${expected} ${noun} even after ` +
        `retries. Not cached as done, and the ${noun} watermark will be rewound to before ` +
        `${w.start}, so the next \`pnpm sync\` re-reads this window.\n`,
      )
    }

  // ---- commits ----
  const commitFetcher = makeCommitFetcher(LOGIN, rl, { onTransientError })
  let commitCount = 0
  for (const seed of yearWindows(commitStart, rangeEnd)) {
    await collectWindow<CommitRecord>(seed, commitFetcher, {
      isDone: makeIsDone(cache.doneWindows.commits, staleFrom),
      onItems: async (items) => {
        // Dedupe by SHA. Search returns one row per (commit x repository), so a
        // commit in a fork network arrives once per copy; preferRepo picks which
        // copy it is filed under, independently of the order they arrive in.
        for (const c of items) cache.commits[c.sha] = preferRepo(cache.commits[c.sha], c, identity)
        commitCount += items.length
      },
      onDone: (w, result) => finishWindow(cache.doneWindows.commits, w, result, flush),
      onEmptyPageRetry,
      onShortRead: onShortRead('commits', 'commits'),
      onProgress: (w, total) => {
        process.stdout.write(`  commits ${windowKey(w)}: ${total}\n`)
      },
      onUnsplittable: (w, total) => {
        unreachableCommitDays.push(windowKey(w))
        if (!cache.unreachableDays.commits.includes(windowKey(w))) {
          cache.unreachableDays.commits.push(windowKey(w))
        }
        console.error(
          `\n!! ${windowKey(w)} reports ${total} commits but the API serves at most ` +
          `${SEARCH_RESULT_CAP} for a single day. ${total - SEARCH_RESULT_CAP} commits are ` +
          `UNREACHABLE and missing from the dataset.\n`,
        )
      },
    })
  }
  // Rewound to before the earliest short read, so the next run's range actually
  // reaches it. Withholding the doneWindows marker alone would be pointless:
  // an advanced watermark means the next run never looks at that window again.
  cache.watermark.commits = nextWatermark(rangeEnd, shortReadStarts.commits)

  // ---- merged PRs ----
  const prFetcher = makePrFetcher(LOGIN, rl, { onTransientError })
  for (const seed of yearWindows(prStart, rangeEnd)) {
    await collectWindow<ParsedPr>(seed, prFetcher, {
      isDone: makeIsDone(cache.doneWindows.prs, staleFrom),
      onItems: async (items) => {
        for (const p of items) cache.prs[p.id] = p.record
      },
      onDone: (w, result) => finishWindow(cache.doneWindows.prs, w, result, flush),
      onEmptyPageRetry,
      onShortRead: onShortRead('merged PRs', 'prs'),
      onProgress: (w, total) => {
        process.stdout.write(`  PRs ${windowKey(w)}: ${total}\n`)
      },
      onUnsplittable: (w, total) => {
        unreachablePrDays.push(windowKey(w))
        if (!cache.unreachableDays.prs.includes(windowKey(w))) {
          cache.unreachableDays.prs.push(windowKey(w))
        }
        console.error(
          `\n!! ${windowKey(w)} has ${total} merged PRs; only ${SEARCH_RESULT_CAP} reachable.\n`,
        )
      },
    })
  }
  cache.watermark.prs = nextWatermark(rangeEnd, shortReadStarts.prs)

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
  // in several hundred lines of progress output. Each block must state the
  // remedy that actually works — a warning whose suggested fix does nothing is
  // worse than no warning, because it reads as reassurance.
  const unreachable = cache.unreachableDays
  if (unreachable.commits.length > 0 || unreachable.prs.length > 0) {
    // Read from the cache, not just this run: these days are permanent, and the
    // warning has to outlive the run that first found them.
    const seenNow = unreachableCommitDays.length + unreachablePrDays.length > 0
    console.error(
      `\n!! DATA IS PERMANENTLY INCOMPLETE — these single days hold more than the ` +
      `${SEARCH_RESULT_CAP} results the API will serve, so the excess CANNOT be retrieved. ` +
      `Re-running \`pnpm sync\` will NOT recover them; no sequence of syncs can. The only ` +
      `remedy is a narrower query than one day, which this tool does not support.\n` +
      `   commits: ${unreachable.commits.join(', ') || '(none)'}\n` +
      `   PRs:     ${unreachable.prs.join(', ') || '(none)'}\n` +
      (seenNow ? '' : '   (carried over from an earlier run; not re-probed in this range)\n'),
    )
  }
  const shortTotal = shortReads.commits.length + shortReads.prs.length
  if (shortTotal > 0) {
    // Unlike the cap, this is recoverable: the windows are not cached as done
    // AND the watermark was rewound to before the earliest of them, so the next
    // run's range genuinely reaches them.
    console.error(
      `\n!! ${shortTotal} window(s) read short of their reported count, most likely ` +
      `throttling. Recoverable: they were not cached as done, and the watermark was rewound ` +
      `so the next run re-reads them. Run \`pnpm sync\` again — the totals should rise.\n` +
      [...shortReads.commits.map((s) => `   commits ${s}`),
       ...shortReads.prs.map((s) => `   PRs     ${s}`)].join('\n') + '\n' +
      `   watermark rewound to: commits ${cache.watermark.commits}, PRs ${cache.watermark.prs}\n`,
    )
  }
  console.log(`Wrote ${OUT_PATH}`)
}

/**
 * Only run the backfill when this file *is* the command being run. Without the
 * guard, merely importing this module — which a test must be able to do — would
 * fire ~104 live API requests against a real account.
 */
if (isEntryPoint(process.argv[1], import.meta.url)) {
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
}
