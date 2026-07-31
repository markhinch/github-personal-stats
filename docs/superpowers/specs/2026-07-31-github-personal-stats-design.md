# GitHub Personal Stats — Design

**Date:** 2026-07-31
**Status:** Approved, ready for implementation planning

## Purpose

A small local web app that shows how much work I've been doing on GitHub: a graph of
commit counts bucketed by week or month, filterable by organisation. Lines of code is
available as a secondary metric.

The GitHub profile contribution graph is useless for this account: all work lives in
private repositories, so the calendar API returns only an opaque
`restrictedContributionsCount` (4,207 for H1 2026) with no breakdown. This tool exists
to recover that visibility.

## Scope

**In scope**

- One chart of activity over time
- Week / month bucket toggle
- Commits / lines-of-code metric toggle
- Organisation checkboxes (include/exclude per org)
- One-command ingestion from GitHub, cached locally so the UI is instant

**Explicitly out of scope**

Considered and cut during design, listed so they are not re-litigated silently:
calendar heatmap, punchcard (day × hour), cumulative "race" chart, repo-level
breakdown, review counts, PR counts, two-period comparison, delta tiles, and
language/file-type split. The last was cut on cost (~1,500 extra API calls); the rest
on scope.

No backend, no database, no native modules, no authentication of its own.

## Verified constraints

Measured against the live API on 2026-07-31, authenticated as `markhinch`:

| Constraint | Value |
| --- | --- |
| `contributionsCollection` breakdown | Unusable — all contributions return as `restrictedContributionsCount` |
| Search API rate limit | **30 requests/min** — the binding constraint on the system |
| Search API result cap | **1,000 per query**, hard |
| GraphQL rate limit | 5,000 points/hr — effectively free at this scale |
| Orgs | `Huub-NL`, `smartfaster-ui`, `modem-works`, `mantrasupplies`, `future-self-labs`, plus own repos |

Commit volume by year: 2022: 7 · 2023: 55 · 2024: 179 · 2025: 3,665 · 2026 (to 31 Jul):
5,243. Total ≈ **9,150**.

2026 by month: Jan 362 · Feb 425 · Mar 552 · Apr 405 · May 1,325 · Jun 743 · Jul 1,431.

**Critical:** May (1,325) and July (1,431) exceed the 1,000-result cap. Naive monthly
chunking would silently discard ~750 commits with no error. Adaptive window bisection
is a correctness requirement, not an optimisation.

## Architecture

Static SPA plus an offline ingester. Two commands:

- `pnpm sync` — ingest from GitHub, write `public/data.json`
- `pnpm dev` — serve the SPA, which loads that one file

Nothing at runtime talks to GitHub or to a database. All filtering and bucketing happens
client-side in memory; the dataset is ~150 KB gzipped, so this is instant.

**Stack:** TypeScript · Vite · React 19 · Tailwind v4 · Recharts 3 · Vitest.

Recharts was chosen over ECharts *after* the heatmap and punchcard were cut — ECharts'
built-in `calendar`/`heatmap` primitives were its only advantage here, and for a single
bar/line chart Recharts is simpler and more React-idiomatic.

### Modules

Single Vite project, three directories with one responsibility each.

**`src/ingest/`** — talks to GitHub, knows nothing about charts.

Shells out to `gh api` rather than handling a token directly, so authentication stays in
the existing keyring and no secret enters this repo.

*Commits* — REST `search/commits`, `author:markhinch`, windowed by `author-date`.
Adaptive bisection:

1. Request the window's first page. Its response carries both `total_count` and the
   first 100 results, so the size probe costs nothing extra.
2. If `total_count > 1000`, discard the page and split the window in half; recurse.
3. Otherwise page through the remainder.
4. Bisection floors at one day. A single day over 1,000 commits is logged loudly as
   unhandled rather than silently truncated.

Rate limiting: token bucket at 28/min (headroom under the 30/min limit), honouring
`x-ratelimit-remaining` and `retry-after`, with exponential backoff on secondary
rate-limit 403s. Cold backfill ≈ 104 requests ≈ under 4 minutes.

*Pull requests* — GraphQL `search(type: ISSUE, query: "type:pr author:markhinch …")`,
reading `additions`, `deletions`, `mergedAt`, and `repository.nameWithOwner`. GraphQL
search shares the same 1,000-result cap, so it reuses the same windowing logic; at ~113
PRs/month, monthly windows never approach the cap. ~40 requests total.

*Caching and resumability* — records are keyed by commit SHA and PR node id, so
overlapping windows produced by bisection dedupe naturally. The cache is flushed to
`.cache/` after each completed window, so a backfill interrupted at request 60 of 104
resumes rather than restarting.

*Incremental sync* — re-queries from `watermark − 3 days` to catch amended and
late-arriving commits. `--full` forces a complete rebuild.

*Default range* — from the account's `createdAt` (auto-detected; 2010-12-07) to today.
Empty windows cost one request each, which is negligible.

**`src/core/`** — pure functions. Zero dependencies, zero I/O, no React.

Bucket timestamps into ISO weeks (Monday start) or calendar months; filter by org; sum
commits or lines. This is where week-boundary, month-boundary, and timezone bugs would
otherwise hide, so it is isolated and directly unit-testable without a browser or
network.

*Timezone policy* — commits are bucketed by the **local date in the commit's own
timezone offset**, which `search/commits` preserves. A commit made at 23:00 local time
counts toward that day, not the next one in UTC. This keeps buckets aligned with the days
I actually worked, including while travelling.

*Lines metric* — "lines changed" is `additions + deletions` summed together. Churn is the
signal of interest here; a refactor that deletes 500 lines is work, not negative work.

**`src/ui/`** — one chart and three controls: week/month toggle, commits/lines toggle,
org checkboxes.

Organisations are derived from the ingested data itself, so the checkbox list needs no
configuration file and stays correct as orgs come and go.

### Data shape

`public/data.json` holds the minimum the UI needs:

- `commits`: `{ sha, repo, authoredAt }` — `authoredAt` retains its original UTC offset
- `mergedPrs`: `{ repo, mergedAt, additions, deletions }`
- `meta`: `{ syncedAt, rangeStart, rangeEnd }`

`repo` is stored as `owner/name`; org is derived from the owner segment rather than
duplicated. Repo identity is retained only to derive org and to keep the door open — the
UI groups by org only.

Sync bookkeeping (watermarks, completed windows) stays in `.cache/`, out of the shipped
artifact.

## Data honesty

**Commit counts are exact. Lines of code are approximate.** Per-commit diffs would cost
~9,150 additional API calls, so lines come from pull request `additions`/`deletions` and
are credited to the PR's **merge date**. A PR merged in July containing June commits
attributes all of its lines to July. Only merged PRs count toward lines — unmerged work
is not shipped work.

This limitation is surfaced in the UI next to the lines metric, not buried here.

## Error handling

| Condition | Behaviour |
| --- | --- |
| `gh` missing or unauthenticated | Fail fast, name the fix (`gh auth login`) |
| Rate limit hit | Back off, report progress, continue |
| Backfill interrupted | Resume from cache on next `pnpm sync` |
| A single day exceeds 1,000 commits | Log loudly as unhandled — never truncate silently |
| `public/data.json` missing | UI states that `pnpm sync` needs to run |
| No commits in selected range | Empty state, not a broken axis |

## Testing

Vitest, concentrated on `src/core/` and the bisection logic — the two places where bugs
would be both likely and invisible.

- Bucketing: ISO week boundaries (including year-boundary weeks, where the ISO week may
  belong to the adjacent year), month boundaries, a commit at 23:00 local landing in the
  local day rather than the next UTC day, empty input, single-commit input
- Org filtering: all selected, none selected, unknown org
- **Bisection: a window reporting `total_count > 1000` must split rather than
  truncate.** This is the highest-value test in the suite — the bug it guards against
  would silently cost ~750 commits and produce a chart that looks perfectly plausible.
- Dedup: overlapping windows yielding the same SHA produce one record
- Rate limiter: stays under 30/min; honours `retry-after`

## Implementation notes

- Load the `dataviz` skill before writing chart code — it governs palette, axis, and
  legend treatment.
- `.superpowers/` is gitignored; brainstorming mockups from this session persist there
  locally for reference.
