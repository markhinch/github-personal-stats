# GitHub Personal Stats

A local dashboard of my own GitHub commit activity over time: a row of headline stat
tiles above one bar chart with its values written on the bars, bucketed by ISO week
or calendar month, filtered by metric (commits / lines changed), trailing time range,
and organisation.

It exists because the GitHub profile contribution graph is useless for this account —
all the work is in private repositories, so the calendar API returns only an opaque
`restrictedContributionsCount` (4,207 for H1 2026) with no breakdown at all. This tool
recovers that visibility by ingesting from the Search API directly.

## Usage

Requires **Node 22+**, **pnpm**, and the [`gh`](https://cli.github.com) CLI, already
authenticated (`gh auth login`). Auth stays entirely in `gh`'s own keyring — this tool
never handles a GitHub token itself.

```bash
pnpm install
pnpm sync   # cold backfill: ~4-5 minutes. later runs: seconds
pnpm dev
```

`pnpm sync --full` discards the local cache and rebuilds the dataset from scratch.

## How it works

- **`src/ingest/`** fetches via `gh api` — commits from the REST Search API, merged
  PRs from GraphQL — and writes `public/data.json`. The Search API caps every query at
  1,000 results and truncates *silently* past that, so date windows are bisected
  recursively until each one fits. Requests are rate-limited to 28/min (headroom under
  GitHub's 30/min search limit), which is what makes a cold backfill take a few
  minutes (~104 requests). The cache is flushed to `.cache/ingest.json` after every
  completed window, so a sync interrupted partway through resumes rather than
  restarting.
- **`src/core/`** is pure, dependency-free bucketing and aggregation: ISO week/month
  keys, org derivation, gap-filled series.
- **`src/ui/`** is a React SPA that loads `public/data.json` once and does all
  filtering and bucketing in memory.

## Data caveats

- **Commit counts are exact, but the Search API's `total_count` is not a commit
  count.** It counts *(commit × repository)* rows, so a commit that exists in an
  n-way fork network is reported n times. This tool dedupes by SHA before counting
  anything, so the numbers shown are always distinct commits — just don't read
  `total_count` from a raw API response as "commits."
- **Lines changed is an approximation.** It's `additions + deletions` from **merged
  pull requests only**, credited to the PR's **merge date** — so a PR merged in July
  that contains June commits attributes all of its churn to July. Per-commit diffs
  would cost roughly 9,000 extra API calls, which is why this tool doesn't do that.
  This caveat is also shown directly in the UI next to the lines-changed toggle.
- **Timezone handling is intentionally asymmetric.** Commits bucket by the calendar
  date as written in the commit's own UTC offset — a commit at 23:00 local time counts
  toward that day, not the next UTC one. Merged-PR `mergedAt` timestamps from GitHub
  are UTC-only, so the lines metric buckets by UTC date instead. This is a deliberate
  trade-off, not a bug.
- **A single day over the 1,000-result cap is unrecoverable.** The ingester bisects
  date windows down to one day to stay under the cap; if one day alone ever exceeds
  it, that excess cannot be retrieved by any amount of re-syncing, and `pnpm sync`
  says so loudly rather than truncating quietly. This has never happened on this
  account.

`.cache/ingest.json` and `public/data.json` are both gitignored — they're rebuilt by
`pnpm sync`, not committed.

## Tests

```bash
pnpm test
```

The highest-value test in the suite asserts that a window reporting more than 1,000
results is split rather than truncated — the bug it guards against would silently
lose several hundred commits in a dense month while producing a chart that looks
entirely plausible. That's not a hypothetical for this account: two months in
2026 genuinely exceed 1,000 commits on their own (May and July). A related test covers the companion
failure mode — GitHub can serve an empty page under soft-throttling even while its
own count still promises more results, and trusting that empty page as "done" would
under-report just as silently.
