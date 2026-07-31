# GitHub Personal Stats Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A local static web app showing commit activity over time, bucketed by ISO week or calendar month, filterable by GitHub organisation, with lines-changed as a secondary metric.

**Architecture:** An offline ingester (`pnpm sync`) shells out to the `gh` CLI, works around the Search API's 1,000-result cap via adaptive window bisection, and writes a single `public/data.json`. A static Vite SPA loads that file once and does all filtering and bucketing client-side in memory. No backend, no database, no native modules.

**Tech Stack:** TypeScript · Vite · React 19 · Tailwind v4 · Recharts 3 · Vitest · tsx (to run the ingester)

**Spec:** `docs/superpowers/specs/2026-07-31-github-personal-stats-design.md`

## Global Constraints

- **Node 22+** (verified present: v22.22.2). Package manager: **pnpm**.
- **The GitHub Search API caps every query at 1,000 results.** Exceeding it truncates *silently*. Adaptive bisection is a correctness requirement, not an optimisation. Verified: May 2026 = 1,325 commits, July 2026 = 1,431.
- **Search API rate limit: 30 requests/min.** The rate limiter runs at **28/min** for headroom. Cold backfill ≈ 4–5 minutes.
- **Search API pagination limit:** `page × per_page ≤ 1000`, so with `per_page=100` the maximum page is **10**.
- **Never handle a GitHub token directly.** All API access goes through `gh api`, so auth stays in the user's keyring.
- **Commit timestamps preserve their original UTC offset** — verified format: `2026-07-22T16:05:11.000+02:00` (note the milliseconds). Commits bucket by the **local date as written in that offset**.
- **GraphQL `mergedAt` is UTC (`Z`) only.** The lines metric therefore buckets by UTC date. Acceptable and documented; do not attempt to reconcile.
- **Lines = `additions + deletions`** (churn), from **merged PRs only**, credited to merge date. Must be labelled in the UI.
- **`git` identity is already configured** (`Mark Hinch <me@markhinch.com>`). Never pass `-c user.email`/`-c user.name`, never run `git config user.*`.
- GitHub login for all queries: **`markhinch`**.

---

### Task 1: Project scaffold, types, and a working test harness

Sets up the project non-interactively (no `create vite` prompts) and proves the test runner works before any logic exists.

**Files:**
- Create: `package.json`, `tsconfig.json`, `vite.config.ts`, `index.html`, `src/styles.css`, `src/core/types.ts`, `src/core/types.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `CommitRecord`, `MergedPrRecord`, `Dataset`, `Bucket`, `Metric`, `SeriesPoint`, `LocalDate` — every later task imports these from `src/core/types.ts`.

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "github-personal-stats",
  "private": true,
  "type": "module",
  "scripts": {
    "sync": "tsx src/ingest/sync.ts",
    "dev": "vite",
    "build": "tsc --noEmit && vite build",
    "preview": "vite preview",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "recharts": "^3.0.0"
  },
  "devDependencies": {
    "@tailwindcss/vite": "^4.0.0",
    "@types/node": "^22.0.0",
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "@vitejs/plugin-react": "^5.0.0",
    "tailwindcss": "^4.0.0",
    "tsx": "^4.0.0",
    "typescript": "^5.6.0",
    "vite": "^7.0.0",
    "vitest": "^3.0.0"
  }
}
```

- [ ] **Step 2: Install dependencies**

Run: `pnpm install`
Expected: completes without error. If any `^` range above has no matching release, install that package unpinned (`pnpm add <pkg>`) and keep the resolved version.

- [ ] **Step 3: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noEmit": true,
    "skipLibCheck": true,
    "types": ["node", "vitest/globals"]
  },
  "include": ["src"]
}
```

- [ ] **Step 4: Create `vite.config.ts`**

```ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  test: { globals: true, environment: 'node' },
})
```

- [ ] **Step 5: Create `index.html`**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>GitHub Personal Stats</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 6: Create `src/styles.css`**

```css
@import "tailwindcss";
```

- [ ] **Step 7: Create `src/core/types.ts`**

```ts
/** A single commit authored by the user. */
export interface CommitRecord {
  sha: string
  /** "owner/name" */
  repo: string
  /** ISO 8601 retaining the commit's original UTC offset, e.g. "2026-07-22T16:05:11.000+02:00" */
  authoredAt: string
}

/** A merged pull request, used only for the lines-changed metric. */
export interface MergedPrRecord {
  /** "owner/name" */
  repo: string
  /** ISO 8601, always UTC ("...Z") — GraphQL does not expose an offset. */
  mergedAt: string
  additions: number
  deletions: number
}

export interface DatasetMeta {
  syncedAt: string
  rangeStart: string
  rangeEnd: string
}

export interface Dataset {
  commits: CommitRecord[]
  mergedPrs: MergedPrRecord[]
  meta: DatasetMeta
}

export type Bucket = 'week' | 'month'
export type Metric = 'commits' | 'lines'

/** A timezone-free calendar date. Month is 1-12, day is 1-31. */
export interface LocalDate {
  year: number
  month: number
  day: number
}

export interface SeriesPoint {
  /** Sortable bucket identity, e.g. "2026-W31" or "2026-07". */
  key: string
  /** Human label, e.g. "W31 2026" or "Jul 2026". */
  label: string
  value: number
}
```

- [ ] **Step 8: Write a test proving the harness runs**

Create `src/core/types.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import type { Dataset } from './types'

describe('test harness', () => {
  it('constructs an empty dataset', () => {
    const ds: Dataset = {
      commits: [],
      mergedPrs: [],
      meta: { syncedAt: '2026-07-31T00:00:00Z', rangeStart: '2010-12-07', rangeEnd: '2026-07-31' },
    }
    expect(ds.commits).toHaveLength(0)
  })
})
```

- [ ] **Step 9: Run the test**

Run: `pnpm test`
Expected: PASS, 1 test.

- [ ] **Step 10: Commit**

```bash
git add package.json pnpm-lock.yaml tsconfig.json vite.config.ts index.html src/
git commit -m "chore: scaffold Vite + React + Tailwind project with core types"
```

---

### Task 2: Derive organisation from repo identifier

**Files:**
- Create: `src/core/orgs.ts`, `src/core/orgs.test.ts`

**Interfaces:**
- Consumes: `Dataset` from `src/core/types.ts`
- Produces: `orgOf(repo: string): string`, `listOrgs(ds: Dataset): string[]`

- [ ] **Step 1: Write the failing tests**

Create `src/core/orgs.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { orgOf, listOrgs } from './orgs'
import type { Dataset } from './types'

describe('orgOf', () => {
  it('extracts the owner segment', () => {
    expect(orgOf('Huub-NL/finview')).toBe('Huub-NL')
    expect(orgOf('markhinch/zen_fatale')).toBe('markhinch')
  })

  it('rejects a malformed identifier rather than guessing', () => {
    expect(() => orgOf('finview')).toThrow(/malformed/i)
    expect(() => orgOf('/finview')).toThrow(/malformed/i)
  })
})

describe('listOrgs', () => {
  const ds: Dataset = {
    commits: [
      { sha: 'a', repo: 'Huub-NL/finview', authoredAt: '2026-07-01T10:00:00.000+02:00' },
      { sha: 'b', repo: 'Huub-NL/huub', authoredAt: '2026-07-01T11:00:00.000+02:00' },
      { sha: 'c', repo: 'markhinch/zen_fatale', authoredAt: '2026-07-02T11:00:00.000+02:00' },
    ],
    mergedPrs: [
      { repo: 'modem-works/site', mergedAt: '2026-07-03T09:00:00Z', additions: 10, deletions: 2 },
    ],
    meta: { syncedAt: '2026-07-31T00:00:00Z', rangeStart: '2026-01-01', rangeEnd: '2026-07-31' },
  }

  it('returns unique orgs from both commits and PRs, sorted case-insensitively', () => {
    expect(listOrgs(ds)).toEqual(['Huub-NL', 'markhinch', 'modem-works'])
  })

  it('returns an empty array for an empty dataset', () => {
    expect(listOrgs({ ...ds, commits: [], mergedPrs: [] })).toEqual([])
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run src/core/orgs.test.ts`
Expected: FAIL — cannot resolve `./orgs`.

- [ ] **Step 3: Implement `src/core/orgs.ts`**

```ts
import type { Dataset } from './types'

/** Extracts the owner segment from an "owner/name" repo identifier. */
export function orgOf(repo: string): string {
  const slash = repo.indexOf('/')
  if (slash <= 0) throw new Error(`Malformed repo identifier: ${JSON.stringify(repo)}`)
  return repo.slice(0, slash)
}

/**
 * Every org present in the dataset, sorted case-insensitively.
 * Derived from the data rather than configured, so the checkbox list
 * stays correct as orgs come and go.
 */
export function listOrgs(ds: Dataset): string[] {
  const seen = new Set<string>()
  for (const c of ds.commits) seen.add(orgOf(c.repo))
  for (const p of ds.mergedPrs) seen.add(orgOf(p.repo))
  return [...seen].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()))
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm vitest run src/core/orgs.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add src/core/orgs.ts src/core/orgs.test.ts
git commit -m "feat(core): derive organisation from repo identifier"
```

---

### Task 3: Timezone-safe bucketing into ISO weeks and calendar months

The highest-risk pure logic in the project. Everything here is timezone-free arithmetic: `Date.UTC` is used purely as a calendar calculator, never as a moment in time, so the machine's local timezone can never leak into a bucket.

**Files:**
- Create: `src/core/buckets.ts`, `src/core/buckets.test.ts`

**Interfaces:**
- Consumes: `LocalDate`, `Bucket` from `src/core/types.ts`
- Produces: `localDateOf(iso: string): LocalDate`, `toDayNumber(d: LocalDate): number`, `fromDayNumber(n: number): LocalDate`, `isoWeek(d: LocalDate): { year: number; week: number }`, `isoWeekStart(d: LocalDate): LocalDate`, `bucketKeyOfLocalDate(d: LocalDate, b: Bucket): string`, `bucketKeyOf(iso: string, b: Bucket): string`, `bucketStartOf(key: string, b: Bucket): LocalDate`, `bucketLabelOf(key: string, b: Bucket): string`

- [ ] **Step 1: Write the failing tests**

Create `src/core/buckets.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import {
  localDateOf, toDayNumber, fromDayNumber, isoWeek, isoWeekStart,
  bucketKeyOf, bucketStartOf, bucketLabelOf,
} from './buckets'

describe('localDateOf', () => {
  it('reads the date as written in the commit\'s own offset', () => {
    // 23:30 on 15 July at +02:00 is 21:30 UTC the same day.
    expect(localDateOf('2026-07-15T23:30:00.000+02:00')).toEqual({ year: 2026, month: 7, day: 15 })
  })

  it('does not shift a late-evening local commit into the next UTC day', () => {
    // 01:30 on 16 July at +02:00 is 23:30 UTC on the 15th. The user worked on the 16th.
    expect(localDateOf('2026-07-16T01:30:00.000+02:00')).toEqual({ year: 2026, month: 7, day: 16 })
  })

  it('handles a negative offset', () => {
    expect(localDateOf('2026-07-15T22:00:00.000-07:00')).toEqual({ year: 2026, month: 7, day: 15 })
  })

  it('handles UTC "Z" and offsets without a colon', () => {
    expect(localDateOf('2026-07-15T10:00:00Z')).toEqual({ year: 2026, month: 7, day: 15 })
    expect(localDateOf('2026-07-15T10:00:00.000+0200')).toEqual({ year: 2026, month: 7, day: 15 })
  })

  it('throws on an unparseable timestamp rather than silently returning a wrong date', () => {
    expect(() => localDateOf('yesterday')).toThrow(/unparseable/i)
    expect(() => localDateOf('')).toThrow(/unparseable/i)
  })
})

describe('day number round-trip', () => {
  it('round-trips dates', () => {
    for (const d of [
      { year: 2026, month: 7, day: 31 },
      { year: 2024, month: 2, day: 29 },
      { year: 2010, month: 12, day: 7 },
      { year: 2026, month: 1, day: 1 },
    ]) {
      expect(fromDayNumber(toDayNumber(d))).toEqual(d)
    }
  })

  it('advances across a month boundary', () => {
    expect(fromDayNumber(toDayNumber({ year: 2026, month: 7, day: 31 }) + 1))
      .toEqual({ year: 2026, month: 8, day: 1 })
  })
})

describe('isoWeek', () => {
  it('assigns a mid-year date correctly', () => {
    // Wed 22 Jul 2026 falls in ISO week 30.
    expect(isoWeek({ year: 2026, month: 7, day: 22 })).toEqual({ year: 2026, week: 30 })
  })

  it('assigns 1 Jan 2026 (a Thursday) to week 1 of 2026', () => {
    expect(isoWeek({ year: 2026, month: 1, day: 1 })).toEqual({ year: 2026, week: 1 })
  })

  it('assigns 1 Jan 2023 (a Sunday) to week 52 of 2022', () => {
    expect(isoWeek({ year: 2023, month: 1, day: 1 })).toEqual({ year: 2022, week: 52 })
  })

  it('assigns 31 Dec 2024 (a Tuesday) to week 1 of 2025', () => {
    expect(isoWeek({ year: 2024, month: 12, day: 31 })).toEqual({ year: 2025, week: 1 })
  })

  it('recognises 2020 as a 53-week ISO year', () => {
    expect(isoWeek({ year: 2020, month: 12, day: 31 })).toEqual({ year: 2020, week: 53 })
  })
})

describe('isoWeekStart', () => {
  it('returns the Monday of the containing week', () => {
    // Wed 22 Jul 2026 -> Mon 20 Jul 2026
    expect(isoWeekStart({ year: 2026, month: 7, day: 22 })).toEqual({ year: 2026, month: 7, day: 20 })
  })

  it('returns the same date when given a Monday', () => {
    expect(isoWeekStart({ year: 2026, month: 7, day: 20 })).toEqual({ year: 2026, month: 7, day: 20 })
  })

  it('crosses a year boundary backwards', () => {
    // Fri 1 Jan 2027 -> Mon 28 Dec 2026
    expect(isoWeekStart({ year: 2027, month: 1, day: 1 })).toEqual({ year: 2026, month: 12, day: 28 })
  })
})

describe('bucketKeyOf', () => {
  it('builds zero-padded, sortable month keys', () => {
    expect(bucketKeyOf('2026-07-22T16:05:11.000+02:00', 'month')).toBe('2026-07')
    expect(bucketKeyOf('2026-01-05T10:00:00.000+01:00', 'month')).toBe('2026-01')
  })

  it('builds zero-padded, sortable week keys using the ISO week year', () => {
    expect(bucketKeyOf('2026-07-22T16:05:11.000+02:00', 'week')).toBe('2026-W30')
    expect(bucketKeyOf('2023-01-01T10:00:00.000+01:00', 'week')).toBe('2022-W52')
  })

  it('sorts keys chronologically as plain strings', () => {
    const keys = ['2026-W09', '2026-W10', '2026-W02']
    expect([...keys].sort()).toEqual(['2026-W02', '2026-W09', '2026-W10'])
  })
})

describe('bucketStartOf', () => {
  it('round-trips a month key', () => {
    expect(bucketStartOf('2026-07', 'month')).toEqual({ year: 2026, month: 7, day: 1 })
  })

  it('round-trips a week key to its Monday', () => {
    expect(bucketStartOf('2026-W30', 'week')).toEqual({ year: 2026, month: 7, day: 20 })
  })

  it('round-trips a week key belonging to the previous calendar year', () => {
    expect(bucketStartOf('2022-W52', 'week')).toEqual({ year: 2022, month: 12, day: 26 })
  })

  it('throws on a malformed key', () => {
    expect(() => bucketStartOf('nope', 'month')).toThrow(/malformed/i)
  })
})

describe('bucketLabelOf', () => {
  it('labels months and weeks readably', () => {
    expect(bucketLabelOf('2026-07', 'month')).toBe('Jul 2026')
    expect(bucketLabelOf('2026-W30', 'week')).toBe('W30 2026')
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run src/core/buckets.test.ts`
Expected: FAIL — cannot resolve `./buckets`.

- [ ] **Step 3: Implement `src/core/buckets.ts`**

```ts
import type { Bucket, LocalDate } from './types'

const MS_PER_DAY = 86_400_000

/**
 * Matches an ISO 8601 timestamp with optional fractional seconds and either
 * "Z", "+HH:MM", or "+HHMM". The offset is deliberately captured but unused:
 * we want the date as the author experienced it, which is the date as written.
 */
const ISO_RE =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})$/

/** Reads the calendar date as written, ignoring the offset entirely. */
export function localDateOf(iso: string): LocalDate {
  const m = ISO_RE.exec(iso)
  if (!m) throw new Error(`Unparseable timestamp: ${JSON.stringify(iso)}`)
  return { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) }
}

/**
 * Days since 1970-01-01 for a timezone-free date.
 * Date.UTC is used purely as calendar arithmetic — never as a moment in time —
 * so the host timezone cannot influence the result.
 */
export function toDayNumber(d: LocalDate): number {
  return Math.round(Date.UTC(d.year, d.month - 1, d.day) / MS_PER_DAY)
}

export function fromDayNumber(n: number): LocalDate {
  const dt = new Date(n * MS_PER_DAY)
  return { year: dt.getUTCFullYear(), month: dt.getUTCMonth() + 1, day: dt.getUTCDate() }
}

/** Day of week, Monday = 1 … Sunday = 7. */
function isoDayOfWeek(d: LocalDate): number {
  const dow = new Date(toDayNumber(d) * MS_PER_DAY).getUTCDay()
  return dow === 0 ? 7 : dow
}

/**
 * ISO 8601 week number and week-numbering year. Week 1 is the week containing
 * the first Thursday, so early-January dates can belong to the previous year.
 */
export function isoWeek(d: LocalDate): { year: number; week: number } {
  // Step to the Thursday of this week; its calendar year is the ISO week year.
  const thursday = fromDayNumber(toDayNumber(d) + (4 - isoDayOfWeek(d)))
  const jan1 = toDayNumber({ year: thursday.year, month: 1, day: 1 })
  const week = Math.floor((toDayNumber(thursday) - jan1) / 7) + 1
  return { year: thursday.year, week }
}

/** The Monday of the ISO week containing `d`. */
export function isoWeekStart(d: LocalDate): LocalDate {
  return fromDayNumber(toDayNumber(d) - (isoDayOfWeek(d) - 1))
}

const pad2 = (n: number): string => String(n).padStart(2, '0')

export function bucketKeyOfLocalDate(d: LocalDate, bucket: Bucket): string {
  if (bucket === 'month') return `${d.year}-${pad2(d.month)}`
  const { year, week } = isoWeek(d)
  return `${year}-W${pad2(week)}`
}

export function bucketKeyOf(iso: string, bucket: Bucket): string {
  return bucketKeyOfLocalDate(localDateOf(iso), bucket)
}

const MONTH_KEY_RE = /^(\d{4})-(\d{2})$/
const WEEK_KEY_RE = /^(\d{4})-W(\d{2})$/

/** The first day of the bucket a key names. Inverse of bucketKeyOfLocalDate. */
export function bucketStartOf(key: string, bucket: Bucket): LocalDate {
  if (bucket === 'month') {
    const m = MONTH_KEY_RE.exec(key)
    if (!m) throw new Error(`Malformed month key: ${JSON.stringify(key)}`)
    return { year: Number(m[1]), month: Number(m[2]), day: 1 }
  }
  const m = WEEK_KEY_RE.exec(key)
  if (!m) throw new Error(`Malformed week key: ${JSON.stringify(key)}`)
  const isoYear = Number(m[1])
  const week = Number(m[2])
  // 4 January is always in ISO week 1; walk forward from that week's Monday.
  const week1Monday = isoWeekStart({ year: isoYear, month: 1, day: 4 })
  return fromDayNumber(toDayNumber(week1Monday) + (week - 1) * 7)
}

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export function bucketLabelOf(key: string, bucket: Bucket): string {
  if (bucket === 'month') {
    const start = bucketStartOf(key, 'month')
    return `${MONTH_NAMES[start.month - 1]} ${start.year}`
  }
  const m = WEEK_KEY_RE.exec(key)
  if (!m) throw new Error(`Malformed week key: ${JSON.stringify(key)}`)
  return `W${m[2]} ${m[1]}`
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm vitest run src/core/buckets.test.ts`
Expected: PASS, all tests.

- [ ] **Step 5: Commit**

```bash
git add src/core/buckets.ts src/core/buckets.test.ts
git commit -m "feat(core): timezone-safe ISO week and month bucketing"
```

---

### Task 4: Aggregate into a gap-filled series

Gap-filling matters for honesty: a three-week silence must render as three zero bars, not as a straight line between two distant points.

**Files:**
- Create: `src/core/aggregate.ts`, `src/core/aggregate.test.ts`

**Interfaces:**
- Consumes: `bucketKeyOf`, `bucketKeyOfLocalDate`, `bucketStartOf`, `bucketLabelOf`, `toDayNumber`, `fromDayNumber`, `localDateOf` from `./buckets`; `orgOf` from `./orgs`; types from `./types`
- Produces: `SeriesOptions`, `buildSeries(ds: Dataset, opts: SeriesOptions): SeriesPoint[]`

- [ ] **Step 1: Write the failing tests**

Create `src/core/aggregate.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { buildSeries } from './aggregate'
import type { Dataset } from './types'

const ds: Dataset = {
  commits: [
    { sha: 'a', repo: 'Huub-NL/finview', authoredAt: '2026-05-04T10:00:00.000+02:00' },
    { sha: 'b', repo: 'Huub-NL/finview', authoredAt: '2026-05-04T11:00:00.000+02:00' },
    { sha: 'c', repo: 'markhinch/zen', authoredAt: '2026-05-05T09:00:00.000+02:00' },
    // Three-month gap, then July.
    { sha: 'd', repo: 'Huub-NL/finview', authoredAt: '2026-08-03T09:00:00.000+02:00' },
  ],
  mergedPrs: [
    { repo: 'Huub-NL/finview', mergedAt: '2026-05-04T12:00:00Z', additions: 100, deletions: 20 },
    { repo: 'markhinch/zen', mergedAt: '2026-05-06T12:00:00Z', additions: 5, deletions: 1 },
  ],
  meta: { syncedAt: '2026-08-31T00:00:00Z', rangeStart: '2026-01-01', rangeEnd: '2026-08-31' },
}

const allOrgs = new Set(['Huub-NL', 'markhinch'])

describe('buildSeries — commits', () => {
  it('counts commits per month', () => {
    const s = buildSeries(ds, { bucket: 'month', metric: 'commits', orgs: allOrgs })
    expect(s.map((p) => [p.key, p.value])).toEqual([
      ['2026-05', 3],
      ['2026-06', 0],
      ['2026-07', 0],
      ['2026-08', 1],
    ])
  })

  it('fills empty buckets with zero rather than omitting them', () => {
    const s = buildSeries(ds, { bucket: 'month', metric: 'commits', orgs: allOrgs })
    expect(s.map((p) => p.key)).toContain('2026-06')
    expect(s.find((p) => p.key === '2026-06')?.value).toBe(0)
  })

  it('counts commits per ISO week', () => {
    const s = buildSeries(ds, { bucket: 'week', metric: 'commits', orgs: allOrgs })
    // 4 and 5 May 2026 are both in ISO week 19; 3 Aug 2026 is in week 32.
    expect(s[0]).toMatchObject({ key: '2026-W19', value: 3 })
    expect(s[s.length - 1]).toMatchObject({ key: '2026-W32', value: 1 })
    expect(s).toHaveLength(14)
  })

  it('excludes orgs that are not selected', () => {
    const s = buildSeries(ds, { bucket: 'month', metric: 'commits', orgs: new Set(['markhinch']) })
    expect(s.find((p) => p.key === '2026-05')?.value).toBe(1)
  })

  it('returns an empty series when no orgs are selected', () => {
    expect(buildSeries(ds, { bucket: 'month', metric: 'commits', orgs: new Set() })).toEqual([])
  })

  it('returns an empty series for an empty dataset', () => {
    const empty: Dataset = { ...ds, commits: [], mergedPrs: [] }
    expect(buildSeries(empty, { bucket: 'month', metric: 'commits', orgs: allOrgs })).toEqual([])
  })

  it('attaches a human label', () => {
    const s = buildSeries(ds, { bucket: 'month', metric: 'commits', orgs: allOrgs })
    expect(s[0]?.label).toBe('May 2026')
  })
})

describe('buildSeries — lines', () => {
  it('sums additions and deletions as churn', () => {
    const s = buildSeries(ds, { bucket: 'month', metric: 'lines', orgs: allOrgs })
    expect(s).toEqual([{ key: '2026-05', label: 'May 2026', value: 126 }])
  })

  it('respects org selection', () => {
    const s = buildSeries(ds, { bucket: 'month', metric: 'lines', orgs: new Set(['markhinch']) })
    expect(s).toEqual([{ key: '2026-05', label: 'May 2026', value: 6 }])
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run src/core/aggregate.test.ts`
Expected: FAIL — cannot resolve `./aggregate`.

- [ ] **Step 3: Implement `src/core/aggregate.ts`**

```ts
import type { Bucket, Dataset, Metric, SeriesPoint } from './types'
import { orgOf } from './orgs'
import {
  bucketKeyOf, bucketKeyOfLocalDate, bucketLabelOf, bucketStartOf,
  fromDayNumber, toDayNumber,
} from './buckets'

export interface SeriesOptions {
  bucket: Bucket
  metric: Metric
  /** Orgs to include. An empty set yields an empty series. */
  orgs: Set<string>
}

/**
 * Aggregates the dataset into one contiguous, gap-filled series.
 *
 * Empty buckets are emitted with value 0 rather than omitted, so a quiet
 * stretch reads as quiet instead of being visually interpolated away.
 */
export function buildSeries(ds: Dataset, opts: SeriesOptions): SeriesPoint[] {
  const { bucket, metric, orgs } = opts
  const totals = new Map<string, number>()

  const record = (iso: string, repo: string, amount: number): void => {
    if (!orgs.has(orgOf(repo))) return
    const key = bucketKeyOf(iso, bucket)
    totals.set(key, (totals.get(key) ?? 0) + amount)
  }

  if (metric === 'commits') {
    for (const c of ds.commits) record(c.authoredAt, c.repo, 1)
  } else {
    for (const p of ds.mergedPrs) record(p.mergedAt, p.repo, p.additions + p.deletions)
  }

  if (totals.size === 0) return []

  const keys = [...totals.keys()].sort()
  const firstKey = keys[0]!
  const lastKey = keys[keys.length - 1]!

  // Walk day by day from the first bucket's start to the last bucket's start,
  // emitting each distinct bucket key in order. Day-stepping keeps this correct
  // across month lengths, leap years, and ISO week-year boundaries alike.
  const endDay = toDayNumber(bucketStartOf(lastKey, bucket))
  const out: SeriesPoint[] = []
  let seenKey: string | null = null

  for (let day = toDayNumber(bucketStartOf(firstKey, bucket)); day <= endDay; day++) {
    const key = bucketKeyOfLocalDate(fromDayNumber(day), bucket)
    if (key === seenKey) continue
    seenKey = key
    out.push({ key, label: bucketLabelOf(key, bucket), value: totals.get(key) ?? 0 })
  }

  return out
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm vitest run src/core/aggregate.test.ts`
Expected: PASS, all tests.

- [ ] **Step 5: Commit**

```bash
git add src/core/aggregate.ts src/core/aggregate.test.ts
git commit -m "feat(core): aggregate dataset into gap-filled series"
```

---

### Task 5: `gh` CLI wrapper

**Files:**
- Create: `src/ingest/gh.ts`, `src/ingest/gh.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks
- Produces: `GhError` (class), `ghJson<T>(args: string[]): Promise<T>`, `assertGhReady(): Promise<void>`

- [ ] **Step 1: Write the failing tests**

These run the real `gh` binary for the failure paths only — no network calls, so they stay fast and deterministic.

Create `src/ingest/gh.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { ghJson, GhError } from './gh'

describe('ghJson', () => {
  it('parses JSON from a successful gh invocation', async () => {
    // `gh api rate_limit` is a cheap, always-available endpoint.
    const res = await ghJson<{ resources: { search: { limit: number } } }>(['api', 'rate_limit'])
    expect(res.resources.search.limit).toBeGreaterThan(0)
  })

  it('throws GhError with stderr context on a failed invocation', async () => {
    await expect(ghJson(['api', 'this/endpoint/does/not/exist'])).rejects.toThrow(GhError)
  })

  it('throws GhError when the binary is missing', async () => {
    await expect(ghJson(['api', 'rate_limit'], { bin: 'gh-does-not-exist' }))
      .rejects.toThrow(/not found|ENOENT/i)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run src/ingest/gh.test.ts`
Expected: FAIL — cannot resolve `./gh`.

- [ ] **Step 3: Implement `src/ingest/gh.ts`**

```ts
import { execFile } from 'node:child_process'

export class GhError extends Error {
  constructor(message: string, readonly stderr = '') {
    super(message)
    this.name = 'GhError'
  }
}

interface GhOptions {
  /** Overridable for tests. */
  bin?: string
  /** Response bodies can be large; default 64 MB. */
  maxBuffer?: number
}

/**
 * Runs `gh` with the given args and parses stdout as JSON.
 *
 * Auth is delegated entirely to the gh CLI, so no token is ever handled here.
 */
export function ghJson<T>(args: string[], opts: GhOptions = {}): Promise<T> {
  const bin = opts.bin ?? 'gh'
  return new Promise<T>((resolve, reject) => {
    execFile(bin, args, { maxBuffer: opts.maxBuffer ?? 64 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        const enoent = (err as NodeJS.ErrnoException).code === 'ENOENT'
        reject(
          new GhError(
            enoent
              ? `\`${bin}\` not found. Install the GitHub CLI: https://cli.github.com`
              : `\`${bin} ${args.join(' ')}\` failed: ${err.message}`,
            stderr,
          ),
        )
        return
      }
      try {
        resolve(JSON.parse(stdout) as T)
      } catch {
        reject(new GhError(`\`${bin} ${args.join(' ')}\` returned unparseable JSON`, stdout.slice(0, 500)))
      }
    })
  })
}

/** Fails fast with an actionable message if gh is missing or unauthenticated. */
export async function assertGhReady(): Promise<void> {
  let login: string
  try {
    const viewer = await ghJson<{ login: string }>(['api', 'user', '--jq', '{login: .login}'])
    login = viewer.login
  } catch (err) {
    const detail = err instanceof GhError ? `${err.message}\n${err.stderr}` : String(err)
    throw new GhError(
      `Cannot reach the GitHub API via gh. Run \`gh auth login\` and try again.\n\n${detail}`,
    )
  }
  if (!login) throw new GhError('gh returned no authenticated user. Run `gh auth login`.')
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm vitest run src/ingest/gh.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add src/ingest/gh.ts src/ingest/gh.test.ts
git commit -m "feat(ingest): gh CLI wrapper with actionable auth errors"
```

---

### Task 6: Rate limiter

The Search API's 30/min ceiling is the binding constraint on the whole system, so this gets a real test with an injected clock — no sleeping in tests.

**Files:**
- Create: `src/ingest/ratelimit.ts`, `src/ingest/ratelimit.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `RateLimiter` class with `constructor(perMinute: number, deps?: { now?: () => number; sleep?: (ms: number) => Promise<void> })` and `acquire(): Promise<void>`

- [ ] **Step 1: Write the failing tests**

Create `src/ingest/ratelimit.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { RateLimiter } from './ratelimit'

/** Deterministic fake clock: sleeping advances virtual time instantly. */
function fakeClock() {
  let t = 0
  return {
    now: () => t,
    sleep: async (ms: number) => { t += ms },
    advance: (ms: number) => { t += ms },
    get time() { return t },
  }
}

describe('RateLimiter', () => {
  it('allows the first burst up to the limit without waiting', async () => {
    const c = fakeClock()
    const rl = new RateLimiter(28, c)
    for (let i = 0; i < 28; i++) await rl.acquire()
    expect(c.time).toBe(0)
  })

  it('delays the request that would exceed the limit', async () => {
    const c = fakeClock()
    const rl = new RateLimiter(3, c)
    await rl.acquire()
    await rl.acquire()
    await rl.acquire()
    expect(c.time).toBe(0)
    await rl.acquire()
    // Must wait until the oldest of the 3 timestamps falls outside the window.
    expect(c.time).toBeGreaterThanOrEqual(60_000)
  })

  it('never exceeds the limit in any 60s window', async () => {
    const c = fakeClock()
    const rl = new RateLimiter(5, c)
    const stamps: number[] = []
    for (let i = 0; i < 20; i++) {
      await rl.acquire()
      stamps.push(c.time)
    }
    for (const s of stamps) {
      const inWindow = stamps.filter((o) => o > s - 60_000 && o <= s).length
      expect(inWindow).toBeLessThanOrEqual(5)
    }
  })

  it('honours an externally requested pause', async () => {
    const c = fakeClock()
    const rl = new RateLimiter(28, c)
    rl.pauseFor(5_000)
    await rl.acquire()
    expect(c.time).toBeGreaterThanOrEqual(5_000)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run src/ingest/ratelimit.test.ts`
Expected: FAIL — cannot resolve `./ratelimit`.

- [ ] **Step 3: Implement `src/ingest/ratelimit.ts`**

```ts
const WINDOW_MS = 60_000

const realSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms))

interface Deps {
  now?: () => number
  sleep?: (ms: number) => Promise<void>
}

/**
 * Sliding-window rate limiter.
 *
 * The GitHub Search API allows 30 requests/min; callers should construct this
 * with 28 to leave headroom for clock skew and retries.
 */
export class RateLimiter {
  private readonly stamps: number[] = []
  private pausedUntil = 0
  private readonly now: () => number
  private readonly sleep: (ms: number) => Promise<void>

  constructor(private readonly perMinute: number, deps: Deps = {}) {
    if (perMinute < 1) throw new Error(`perMinute must be >= 1, got ${perMinute}`)
    this.now = deps.now ?? Date.now
    this.sleep = deps.sleep ?? realSleep
  }

  /** Requests a backoff pause, e.g. in response to a Retry-After header. */
  pauseFor(ms: number): void {
    this.pausedUntil = Math.max(this.pausedUntil, this.now() + ms)
  }

  /** Resolves when it is safe to issue another request. */
  async acquire(): Promise<void> {
    for (;;) {
      const now = this.now()

      if (now < this.pausedUntil) {
        await this.sleep(this.pausedUntil - now)
        continue
      }

      // Drop timestamps that have aged out of the window.
      while (this.stamps.length > 0 && this.stamps[0]! <= now - WINDOW_MS) this.stamps.shift()

      if (this.stamps.length < this.perMinute) {
        this.stamps.push(now)
        return
      }

      // +1ms so the oldest stamp is strictly outside the window on the retry.
      await this.sleep(this.stamps[0]! + WINDOW_MS - now + 1)
    }
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm vitest run src/ingest/ratelimit.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add src/ingest/ratelimit.ts src/ingest/ratelimit.test.ts
git commit -m "feat(ingest): sliding-window rate limiter with injectable clock"
```

---

### Task 7: Adaptive window bisection

**The most important task in the plan.** The Search API caps results at 1,000 and truncates silently. Without bisection, May and July 2026 alone lose ~750 commits and the resulting chart looks entirely plausible. The test that a >1,000 window *splits* rather than truncates is the highest-value test in the suite.

**Files:**
- Create: `src/ingest/windows.ts`, `src/ingest/windows.test.ts`

**Interfaces:**
- Consumes: `toDayNumber`, `fromDayNumber`, `localDateOf` from `../core/buckets`
- Produces: `DateWindow` (`{ start: string; end: string }`, both `YYYY-MM-DD`, inclusive), `windowKey(w: DateWindow): string`, `splitWindow(w: DateWindow): [DateWindow, DateWindow] | null`, `yearWindows(startDate: string, endDate: string): DateWindow[]`, `PageFetcher<T>`, `collectWindow<T>(w, fetch, opts): Promise<void>`

- [ ] **Step 1: Write the failing tests**

Create `src/ingest/windows.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest'
import { splitWindow, windowKey, yearWindows, collectWindow, type DateWindow } from './windows'

describe('splitWindow', () => {
  it('halves a multi-day window into contiguous, non-overlapping halves', () => {
    const [a, b] = splitWindow({ start: '2026-01-01', end: '2026-01-10' })!
    expect(a).toEqual({ start: '2026-01-01', end: '2026-01-05' })
    expect(b).toEqual({ start: '2026-01-06', end: '2026-01-10' })
  })

  it('splits a two-day window', () => {
    const [a, b] = splitWindow({ start: '2026-01-01', end: '2026-01-02' })!
    expect(a).toEqual({ start: '2026-01-01', end: '2026-01-01' })
    expect(b).toEqual({ start: '2026-01-02', end: '2026-01-02' })
  })

  it('returns null for a single-day window — the bisection floor', () => {
    expect(splitWindow({ start: '2026-01-01', end: '2026-01-01' })).toBeNull()
  })

  it('crosses month and year boundaries', () => {
    const [a, b] = splitWindow({ start: '2025-12-30', end: '2026-01-02' })!
    expect(a).toEqual({ start: '2025-12-30', end: '2025-12-31' })
    expect(b).toEqual({ start: '2026-01-01', end: '2026-01-02' })
  })
})

describe('yearWindows', () => {
  it('emits one window per calendar year, clamped to the range', () => {
    expect(yearWindows('2024-03-15', '2026-07-31')).toEqual([
      { start: '2024-03-15', end: '2024-12-31' },
      { start: '2025-01-01', end: '2025-12-31' },
      { start: '2026-01-01', end: '2026-07-31' },
    ])
  })

  it('handles a range inside a single year', () => {
    expect(yearWindows('2026-01-01', '2026-07-31')).toEqual([
      { start: '2026-01-01', end: '2026-07-31' },
    ])
  })
})

describe('windowKey', () => {
  it('is stable and unique per window', () => {
    expect(windowKey({ start: '2026-01-01', end: '2026-01-31' })).toBe('2026-01-01..2026-01-31')
  })
})

/**
 * Builds a fake pager over a synthetic day -> count map, mimicking the real API:
 * total_count reflects the whole window, but at most 1000 results are reachable.
 */
function fakeApi(countsByDay: Record<string, number>) {
  const calls: Array<{ window: string; page: number }> = []

  const idsIn = (w: DateWindow): string[] => {
    const out: string[] = []
    for (const [day, n] of Object.entries(countsByDay)) {
      if (day >= w.start && day <= w.end) {
        for (let i = 0; i < n; i++) out.push(`${day}#${i}`)
      }
    }
    return out.sort()
  }

  const fetchPage = async (w: DateWindow, page: number) => {
    calls.push({ window: windowKey(w), page })
    const all = idsIn(w)
    const reachable = all.slice(0, 1000) // the API's hard ceiling
    const from = (page - 1) * 100
    return { totalCount: all.length, items: reachable.slice(from, from + 100) }
  }

  return { fetchPage, calls }
}

describe('collectWindow', () => {
  it('pages through a window under the cap', async () => {
    const { fetchPage, calls } = fakeApi({ '2026-01-01': 250 })
    const got: string[] = []
    await collectWindow({ start: '2026-01-01', end: '2026-01-01' }, fetchPage, {
      onItems: async (items) => { got.push(...items) },
    })
    expect(got).toHaveLength(250)
    expect(calls.map((c) => c.page)).toEqual([1, 2, 3])
  })

  it('SPLITS rather than truncates when a window exceeds the 1000 cap', async () => {
    // 1431 commits in one month — the real July 2026 figure.
    const { fetchPage } = fakeApi({
      '2026-07-05': 700,
      '2026-07-20': 731,
    })
    const got: string[] = []
    await collectWindow({ start: '2026-07-01', end: '2026-07-31' }, fetchPage, {
      onItems: async (items) => { got.push(...items) },
    })
    // The whole point: nothing is lost.
    expect(new Set(got).size).toBe(1431)
  })

  it('recurses as deep as needed', async () => {
    const days: Record<string, number> = {}
    for (let d = 1; d <= 28; d++) {
      days[`2026-02-${String(d).padStart(2, '0')}`] = 300
    }
    const { fetchPage } = fakeApi(days)
    const got: string[] = []
    await collectWindow({ start: '2026-02-01', end: '2026-02-28' }, fetchPage, {
      onItems: async (items) => { got.push(...items) },
    })
    expect(new Set(got).size).toBe(28 * 300)
  })

  it('costs only one request for an empty window', async () => {
    const { fetchPage, calls } = fakeApi({})
    await collectWindow({ start: '2015-01-01', end: '2015-12-31' }, fetchPage, {
      onItems: async () => {},
    })
    expect(calls).toHaveLength(1)
  })

  it('reports a single day that exceeds the cap instead of silently truncating', async () => {
    const onUnsplittable = vi.fn()
    const { fetchPage } = fakeApi({ '2026-07-05': 1200 })
    await collectWindow({ start: '2026-07-05', end: '2026-07-05' }, fetchPage, {
      onItems: async () => {},
      onUnsplittable,
    })
    expect(onUnsplittable).toHaveBeenCalledWith(
      { start: '2026-07-05', end: '2026-07-05' },
      1200,
    )
  })

  it('skips windows the resume predicate reports as already done', async () => {
    const { fetchPage, calls } = fakeApi({ '2026-01-01': 50 })
    await collectWindow({ start: '2026-01-01', end: '2026-01-31' }, fetchPage, {
      onItems: async () => {},
      isDone: (w) => windowKey(w) === '2026-01-01..2026-01-31',
    })
    expect(calls).toHaveLength(0)
  })

  it('marks a window complete only after it is fully collected', async () => {
    const done: string[] = []
    const { fetchPage } = fakeApi({ '2026-07-05': 700, '2026-07-20': 731 })
    await collectWindow({ start: '2026-07-01', end: '2026-07-31' }, fetchPage, {
      onItems: async () => {},
      onDone: async (w) => { done.push(windowKey(w)) },
    })
    // Children complete before their parent.
    expect(done[done.length - 1]).toBe('2026-07-01..2026-07-31')
    expect(done.length).toBeGreaterThan(1)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run src/ingest/windows.test.ts`
Expected: FAIL — cannot resolve `./windows`.

- [ ] **Step 3: Implement `src/ingest/windows.ts`**

```ts
import { fromDayNumber, localDateOf, toDayNumber } from '../core/buckets'
import type { LocalDate } from '../core/types'

/** An inclusive date range, both bounds `YYYY-MM-DD`. */
export interface DateWindow {
  start: string
  end: string
}

/** The GitHub Search API returns at most this many results per query. */
export const SEARCH_RESULT_CAP = 1000
/** With per_page=100, page * per_page must stay <= SEARCH_RESULT_CAP. */
export const PER_PAGE = 100

const pad2 = (n: number): string => String(n).padStart(2, '0')

const fmt = (d: LocalDate): string => `${d.year}-${pad2(d.month)}-${pad2(d.day)}`

const dayOf = (date: string): number => toDayNumber(localDateOf(`${date}T00:00:00Z`))

export function windowKey(w: DateWindow): string {
  return `${w.start}..${w.end}`
}

/** Halves a window. Returns null for a single day — the bisection floor. */
export function splitWindow(w: DateWindow): [DateWindow, DateWindow] | null {
  const start = dayOf(w.start)
  const end = dayOf(w.end)
  if (end <= start) return null
  const mid = start + Math.floor((end - start) / 2)
  return [
    { start: w.start, end: fmt(fromDayNumber(mid)) },
    { start: fmt(fromDayNumber(mid + 1)), end: w.end },
  ]
}

/**
 * Seeds bisection with one window per calendar year.
 *
 * Yearly seeds keep the probe count low (~17 for this account's history) while
 * letting bisection adapt to the fact that recent years are far denser than old
 * ones. An empty year costs exactly one request.
 */
export function yearWindows(startDate: string, endDate: string): DateWindow[] {
  const first = localDateOf(`${startDate}T00:00:00Z`)
  const last = localDateOf(`${endDate}T00:00:00Z`)
  const out: DateWindow[] = []
  for (let y = first.year; y <= last.year; y++) {
    out.push({
      start: y === first.year ? startDate : `${y}-01-01`,
      end: y === last.year ? endDate : `${y}-12-31`,
    })
  }
  return out
}

export type PageFetcher<T> = (
  w: DateWindow,
  page: number,
) => Promise<{ totalCount: number; items: T[] }>

export interface CollectOptions<T> {
  /** Receives every batch of items as it arrives. */
  onItems: (items: T[], w: DateWindow) => Promise<void>
  /** Called once a window (and all its children) is fully collected. */
  onDone?: (w: DateWindow) => Promise<void>
  /** Resume hook: return true to skip a window entirely. */
  isDone?: (w: DateWindow) => boolean
  /** Called when a single day exceeds the cap and cannot be split further. */
  onUnsplittable?: (w: DateWindow, totalCount: number) => void
  /** Progress reporting. */
  onProgress?: (w: DateWindow, totalCount: number) => void
}

/**
 * Collects every result in `window`, bisecting whenever the API reports more
 * than it will actually serve.
 *
 * The size probe is free: page 1's response carries both `total_count` and the
 * first 100 results, so an under-cap window costs no extra request.
 */
export async function collectWindow<T>(
  window: DateWindow,
  fetchPage: PageFetcher<T>,
  opts: CollectOptions<T>,
): Promise<void> {
  if (opts.isDone?.(window)) return

  const first = await fetchPage(window, 1)
  opts.onProgress?.(window, first.totalCount)

  if (first.totalCount > SEARCH_RESULT_CAP) {
    const halves = splitWindow(window)
    if (!halves) {
      // A single day over the cap. Take what we can reach and report loudly:
      // silently truncating here is exactly the failure this module prevents.
      opts.onUnsplittable?.(window, first.totalCount)
      await opts.onItems(first.items, window)
      for (let page = 2; page <= SEARCH_RESULT_CAP / PER_PAGE; page++) {
        const res = await fetchPage(window, page)
        if (res.items.length === 0) break
        await opts.onItems(res.items, window)
      }
      await opts.onDone?.(window)
      return
    }
    for (const half of halves) await collectWindow(half, fetchPage, opts)
    await opts.onDone?.(window)
    return
  }

  await opts.onItems(first.items, window)
  const pages = Math.ceil(first.totalCount / PER_PAGE)
  for (let page = 2; page <= pages; page++) {
    const res = await fetchPage(window, page)
    await opts.onItems(res.items, window)
  }
  await opts.onDone?.(window)
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm vitest run src/ingest/windows.test.ts`
Expected: PASS, all tests — especially "SPLITS rather than truncates".

- [ ] **Step 5: Commit**

```bash
git add src/ingest/windows.ts src/ingest/windows.test.ts
git commit -m "feat(ingest): adaptive window bisection around the 1000-result search cap"
```

---

### Task 8: Resumable cache

**Files:**
- Create: `src/ingest/cache.ts`, `src/ingest/cache.test.ts`

**Interfaces:**
- Consumes: `CommitRecord`, `MergedPrRecord` from `../core/types`
- Produces: `IngestCache` interface, `emptyCache(): IngestCache`, `loadCache(path: string): Promise<IngestCache>`, `saveCache(path: string, cache: IngestCache): Promise<void>`

- [ ] **Step 1: Write the failing tests**

Create `src/ingest/cache.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { emptyCache, loadCache, saveCache } from './cache'

const tmpFile = async (name: string): Promise<string> => {
  const dir = await mkdtemp(join(tmpdir(), 'ghstats-'))
  return join(dir, name)
}

describe('cache', () => {
  it('returns an empty cache when the file does not exist', async () => {
    const c = await loadCache(await tmpFile('missing.json'))
    expect(c.commits).toEqual({})
    expect(c.doneWindows.commits).toEqual([])
  })

  it('round-trips through save and load', async () => {
    const path = await tmpFile('cache.json')
    const c = emptyCache()
    c.commits['abc'] = { sha: 'abc', repo: 'Huub-NL/finview', authoredAt: '2026-07-01T10:00:00.000+02:00' }
    c.doneWindows.commits.push('2026-01-01..2026-12-31')
    await saveCache(path, c)

    const back = await loadCache(path)
    expect(back.commits['abc']?.repo).toBe('Huub-NL/finview')
    expect(back.doneWindows.commits).toContain('2026-01-01..2026-12-31')
  })

  it('dedupes by key when the same commit is written twice', async () => {
    const path = await tmpFile('cache.json')
    const c = emptyCache()
    const rec = { sha: 'dup', repo: 'a/b', authoredAt: '2026-07-01T10:00:00.000+02:00' }
    c.commits['dup'] = rec
    c.commits['dup'] = rec
    await saveCache(path, c)
    expect(Object.keys((await loadCache(path)).commits)).toEqual(['dup'])
  })

  it('recovers from a corrupt cache rather than crashing the sync', async () => {
    const path = await tmpFile('corrupt.json')
    await writeFile(path, '{ this is not json')
    const c = await loadCache(path)
    expect(c.commits).toEqual({})
  })

  it('writes atomically so an interrupted save cannot corrupt the cache', async () => {
    const path = await tmpFile('atomic.json')
    await saveCache(path, emptyCache())
    // A temp file must not be left behind.
    const { readdir } = await import('node:fs/promises')
    const { dirname, basename } = await import('node:path')
    const entries = await readdir(dirname(path))
    expect(entries).toEqual([basename(path)])
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run src/ingest/cache.test.ts`
Expected: FAIL — cannot resolve `./cache`.

- [ ] **Step 3: Implement `src/ingest/cache.ts`**

```ts
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { CommitRecord, MergedPrRecord } from '../core/types'

export interface IngestCache {
  /** Keyed by commit SHA, so overlapping bisected windows dedupe for free. */
  commits: Record<string, CommitRecord>
  /** Keyed by GraphQL node id. */
  prs: Record<string, MergedPrRecord>
  /** Fully-collected window keys, enabling resume after an interruption. */
  doneWindows: { commits: string[]; prs: string[] }
  watermark: { commits?: string; prs?: string }
}

export function emptyCache(): IngestCache {
  return { commits: {}, prs: {}, doneWindows: { commits: [], prs: [] }, watermark: {} }
}

/** Loads the cache, falling back to empty on a missing or corrupt file. */
export async function loadCache(path: string): Promise<IngestCache> {
  let raw: string
  try {
    raw = await readFile(path, 'utf8')
  } catch {
    return emptyCache()
  }
  try {
    const parsed = JSON.parse(raw) as Partial<IngestCache>
    const base = emptyCache()
    return {
      commits: parsed.commits ?? base.commits,
      prs: parsed.prs ?? base.prs,
      doneWindows: {
        commits: parsed.doneWindows?.commits ?? [],
        prs: parsed.doneWindows?.prs ?? [],
      },
      watermark: parsed.watermark ?? {},
    }
  } catch {
    // A corrupt cache costs a re-backfill, not a crash.
    console.warn(`Cache at ${path} was unreadable; starting fresh.`)
    return emptyCache()
  }
}

/** Writes via a temp file + rename so an interrupted save cannot corrupt the cache. */
export async function saveCache(path: string, cache: IngestCache): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const tmp = `${path}.tmp`
  await writeFile(tmp, JSON.stringify(cache), 'utf8')
  await rename(tmp, path)
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm vitest run src/ingest/cache.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add src/ingest/cache.ts src/ingest/cache.test.ts
git commit -m "feat(ingest): atomic, resumable ingest cache"
```

---

### Task 9: Fetch commits and merged PRs

**Files:**
- Create: `src/ingest/fetchers.ts`, `src/ingest/fetchers.test.ts`

**Interfaces:**
- Consumes: `ghJson` from `./gh`; `RateLimiter` from `./ratelimit`; `DateWindow`, `PER_PAGE` from `./windows`; `CommitRecord`, `MergedPrRecord` from `../core/types`
- Produces: `parseCommitSearchResponse(json)`, `parsePrSearchResponse(json)`, `makeCommitFetcher(login, rl)`, `makePrFetcher(login, rl)`, `fetchViewerCreatedAt()`

Response parsing is separated from I/O so it can be tested against real captured payloads without network access.

- [ ] **Step 1: Write the failing tests**

Create `src/ingest/fetchers.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { parseCommitSearchResponse, parsePrSearchResponse } from './fetchers'

// Captured verbatim from `gh api search/commits` on 2026-07-31.
const COMMIT_PAYLOAD = {
  total_count: 246,
  incomplete_results: false,
  items: [
    {
      sha: '71a69c8d1111111111111111111111111111aaaa',
      commit: {
        author: { date: '2026-07-22T16:05:11.000+02:00' },
        committer: { date: '2026-07-22T16:05:11.000+02:00' },
      },
      repository: { full_name: 'Huub-NL/finview' },
    },
  ],
}

describe('parseCommitSearchResponse', () => {
  it('extracts sha, repo, and the offset-preserving author date', () => {
    const { totalCount, items } = parseCommitSearchResponse(COMMIT_PAYLOAD)
    expect(totalCount).toBe(246)
    expect(items).toEqual([
      {
        sha: '71a69c8d1111111111111111111111111111aaaa',
        repo: 'Huub-NL/finview',
        authoredAt: '2026-07-22T16:05:11.000+02:00',
      },
    ])
  })

  it('prefers author date over committer date', () => {
    const payload = {
      total_count: 1,
      items: [{
        sha: 'x',
        commit: {
          author: { date: '2026-07-01T10:00:00.000+02:00' },
          committer: { date: '2026-07-09T10:00:00.000+02:00' },
        },
        repository: { full_name: 'a/b' },
      }],
    }
    expect(parseCommitSearchResponse(payload).items[0]?.authoredAt)
      .toBe('2026-07-01T10:00:00.000+02:00')
  })

  it('skips malformed items rather than aborting the whole window', () => {
    const payload = {
      total_count: 2,
      items: [
        { sha: 'ok', commit: { author: { date: '2026-07-01T10:00:00.000+02:00' } }, repository: { full_name: 'a/b' } },
        { sha: 'bad', commit: {}, repository: {} },
      ],
    }
    expect(parseCommitSearchResponse(payload).items).toHaveLength(1)
  })

  it('throws when total_count is absent — a shape change must not read as zero', () => {
    expect(() => parseCommitSearchResponse({ items: [] })).toThrow(/total_count/i)
  })
})

const PR_PAYLOAD = {
  data: {
    search: {
      issueCount: 113,
      pageInfo: { hasNextPage: false, endCursor: 'Y3Vyc29yOjE=' },
      nodes: [
        {
          id: 'PR_kwDO1',
          mergedAt: '2026-06-30T12:00:00Z',
          additions: 7964,
          deletions: 51,
          repository: { nameWithOwner: 'Huub-NL/finview' },
        },
        // GraphQL search can return non-PR nodes as empty objects; they must be skipped.
        {},
      ],
    },
  },
}

describe('parsePrSearchResponse', () => {
  it('extracts merged PRs with churn fields', () => {
    const { totalCount, items, pageInfo } = parsePrSearchResponse(PR_PAYLOAD)
    expect(totalCount).toBe(113)
    expect(pageInfo.hasNextPage).toBe(false)
    expect(items).toEqual([
      {
        id: 'PR_kwDO1',
        record: {
          repo: 'Huub-NL/finview',
          mergedAt: '2026-06-30T12:00:00Z',
          additions: 7964,
          deletions: 51,
        },
      },
    ])
  })

  it('surfaces GraphQL errors instead of silently returning nothing', () => {
    expect(() => parsePrSearchResponse({ errors: [{ message: 'Bad credentials' }] }))
      .toThrow(/Bad credentials/)
  })

  it('skips a PR with no mergedAt', () => {
    const payload = {
      data: { search: { issueCount: 1, pageInfo: { hasNextPage: false }, nodes: [
        { id: 'x', mergedAt: null, additions: 1, deletions: 1, repository: { nameWithOwner: 'a/b' } },
      ] } },
    }
    expect(parsePrSearchResponse(payload).items).toHaveLength(0)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run src/ingest/fetchers.test.ts`
Expected: FAIL — cannot resolve `./fetchers`.

- [ ] **Step 3: Implement `src/ingest/fetchers.ts`**

```ts
import { ghJson } from './gh'
import type { RateLimiter } from './ratelimit'
import { PER_PAGE, type DateWindow, type PageFetcher } from './windows'
import type { CommitRecord, MergedPrRecord } from '../core/types'

// ---------- commits (REST search) ----------

export function parseCommitSearchResponse(json: unknown): {
  totalCount: number
  items: CommitRecord[]
} {
  const o = json as { total_count?: number; items?: unknown[] }
  if (typeof o.total_count !== 'number') {
    throw new Error('Commit search response has no numeric total_count — API shape may have changed')
  }
  const items: CommitRecord[] = []
  for (const raw of o.items ?? []) {
    const it = raw as {
      sha?: string
      commit?: { author?: { date?: string } }
      repository?: { full_name?: string }
    }
    const sha = it.sha
    const authoredAt = it.commit?.author?.date
    const repo = it.repository?.full_name
    // Skip rather than abort: one odd item must not cost a whole window.
    if (!sha || !authoredAt || !repo) continue
    items.push({ sha, repo, authoredAt })
  }
  return { totalCount: o.total_count, items }
}

/** A rate-limited page fetcher for commits authored by `login`. */
export function makeCommitFetcher(login: string, rl: RateLimiter): PageFetcher<CommitRecord> {
  return async (w: DateWindow, page: number) => {
    await rl.acquire()
    const json = await ghJson<unknown>([
      'api', '-X', 'GET', 'search/commits',
      '-f', `q=author:${login} author-date:${w.start}..${w.end}`,
      '-f', `per_page=${PER_PAGE}`,
      '-f', `page=${page}`,
    ])
    return parseCommitSearchResponse(json)
  }
}

// ---------- merged PRs (GraphQL search) ----------

export interface ParsedPr {
  id: string
  record: MergedPrRecord
}

export function parsePrSearchResponse(json: unknown): {
  totalCount: number
  items: ParsedPr[]
  pageInfo: { hasNextPage: boolean; endCursor?: string }
} {
  const o = json as {
    errors?: Array<{ message?: string }>
    data?: {
      search?: {
        issueCount?: number
        pageInfo?: { hasNextPage?: boolean; endCursor?: string }
        nodes?: unknown[]
      }
    }
  }
  if (o.errors?.length) {
    throw new Error(`GraphQL error: ${o.errors.map((e) => e.message ?? '?').join('; ')}`)
  }
  const search = o.data?.search
  if (!search || typeof search.issueCount !== 'number') {
    throw new Error('PR search response has no issueCount — API shape may have changed')
  }
  const items: ParsedPr[] = []
  for (const raw of search.nodes ?? []) {
    const n = raw as {
      id?: string
      mergedAt?: string | null
      additions?: number
      deletions?: number
      repository?: { nameWithOwner?: string }
    }
    const repo = n.repository?.nameWithOwner
    if (!n.id || !n.mergedAt || !repo) continue
    items.push({
      id: n.id,
      record: {
        repo,
        mergedAt: n.mergedAt,
        additions: n.additions ?? 0,
        deletions: n.deletions ?? 0,
      },
    })
  }
  return {
    totalCount: search.issueCount,
    items,
    pageInfo: {
      hasNextPage: search.pageInfo?.hasNextPage ?? false,
      endCursor: search.pageInfo?.endCursor,
    },
  }
}

const PR_QUERY = `
query($q: String!, $cursor: String) {
  search(query: $q, type: ISSUE, first: 100, after: $cursor) {
    issueCount
    pageInfo { hasNextPage endCursor }
    nodes {
      ... on PullRequest {
        id
        mergedAt
        additions
        deletions
        repository { nameWithOwner }
      }
    }
  }
}`

/**
 * A page fetcher for merged PRs. GraphQL search shares the same 1000-result
 * cap, so this plugs into collectWindow exactly like the commit fetcher.
 *
 * Cursor pagination is mapped onto page numbers by walking cursors internally;
 * GraphQL is cheap (5000 pts/hr) so this is not rate-limited by the search bucket.
 */
export function makePrFetcher(login: string, rl: RateLimiter): PageFetcher<ParsedPr> {
  // Cursors per window, so repeated page-N requests stay coherent.
  const cursors = new Map<string, string[]>()

  return async (w: DateWindow, page: number) => {
    const key = `${w.start}..${w.end}`
    const known = cursors.get(key) ?? []
    const args = [
      'api', 'graphql',
      '-f', `query=${PR_QUERY}`,
      '-f', `q=type:pr author:${login} is:merged merged:${w.start}..${w.end}`,
    ]
    const cursor = page > 1 ? known[page - 2] : undefined
    if (cursor) args.push('-f', `cursor=${cursor}`)

    await rl.acquire()
    const parsed = parsePrSearchResponse(await ghJson<unknown>(args))
    if (parsed.pageInfo.endCursor) {
      known[page - 1] = parsed.pageInfo.endCursor
      cursors.set(key, known)
    }
    return { totalCount: parsed.totalCount, items: parsed.items }
  }
}

// ---------- viewer metadata ----------

/** The account creation date, used as the default backfill start. */
export async function fetchViewerCreatedAt(): Promise<string> {
  const json = await ghJson<{ data: { viewer: { createdAt: string } } }>([
    'api', 'graphql', '-f', 'query={ viewer { createdAt } }',
  ])
  return json.data.viewer.createdAt.slice(0, 10)
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm vitest run src/ingest/fetchers.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add src/ingest/fetchers.ts src/ingest/fetchers.test.ts
git commit -m "feat(ingest): commit and merged-PR fetchers with pure response parsers"
```

---

### Task 10: Sync CLI

Wires everything together into `pnpm sync`. This task's verification is a real run against the live API — the first end-to-end proof.

**Files:**
- Create: `src/ingest/sync.ts`
- Modify: `.gitignore` (already ignores `.cache/` and `public/data.json` — verify)

**Interfaces:**
- Consumes: everything from Tasks 5–9
- Produces: `public/data.json` conforming to `Dataset`

- [ ] **Step 1: Implement `src/ingest/sync.ts`**

```ts
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { assertGhReady, GhError } from './gh'
import { RateLimiter } from './ratelimit'
import { collectWindow, windowKey, yearWindows, type DateWindow } from './windows'
import { emptyCache, loadCache, saveCache, type IngestCache } from './cache'
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
      onDone: async (w) => {
        const key = windowKey(w)
        if (!cache.doneWindows.commits.includes(key)) cache.doneWindows.commits.push(key)
        await flush()
      },
      onProgress: (w, total) => {
        process.stdout.write(`  commits ${windowKey(w)}: ${total}\n`)
      },
      onUnsplittable: (w, total) => {
        console.error(
          `\n!! ${windowKey(w)} reports ${total} commits but the API serves at most 1000 ` +
          `for a single day. ${total - 1000} commits are UNREACHABLE and missing from the dataset.\n`,
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
      onDone: async (w) => {
        const key = windowKey(w)
        if (!cache.doneWindows.prs.includes(key)) cache.doneWindows.prs.push(key)
        await flush()
      },
      onProgress: (w, total) => {
        process.stdout.write(`  PRs ${windowKey(w)}: ${total}\n`)
      },
      onUnsplittable: (w, total) => {
        console.error(`\n!! ${windowKey(w)} has ${total} merged PRs; only 1000 reachable.\n`)
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
```

- [ ] **Step 2: Verify `.gitignore` covers the outputs**

Run: `grep -E '^\.cache/|^public/data\.json' .gitignore`
Expected: both lines present. If not, add them.

- [ ] **Step 3: Run the real sync**

Run: `pnpm sync`
Expected: progress lines per window; takes ~4–5 minutes; ends with a summary.

Verify the critical behaviour — that 2026 windows over 1,000 were bisected rather than truncated:

```bash
node -e "
const d = require('./public/data.json');
const byMonth = {};
for (const c of d.commits) { const k = c.authoredAt.slice(0,7); byMonth[k] = (byMonth[k]||0)+1 }
for (const k of ['2026-05','2026-06','2026-07']) console.log(k, byMonth[k]);
console.log('total commits', d.commits.length, 'merged PRs', d.mergedPrs.length);
"
```

Expected, matching the figures measured during design (allowing for commits added since):
- `2026-05` ≈ **1325** — proves bisection worked; a truncating implementation caps near 1000
- `2026-06` ≈ **743**
- `2026-07` ≈ **1431** — likewise over 1000
- total commits ≈ **9150**

If May or July come back at ~1000, bisection is broken. Stop and fix Task 7 before continuing.

- [ ] **Step 4: Verify resume works**

Run `pnpm sync` again.
Expected: completes in seconds, skipping already-complete windows, and reports a similar total.

- [ ] **Step 5: Commit**

```bash
git add src/ingest/sync.ts .gitignore
git commit -m "feat(ingest): sync CLI writing public/data.json"
```

---

### Task 11: UI — chart and controls

**Files:**
- Create: `src/main.tsx`, `src/App.tsx`, `src/ui/useDataset.ts`, `src/ui/Controls.tsx`, `src/ui/ActivityChart.tsx`
- Test: `src/ui/useDataset.test.ts`

**Interfaces:**
- Consumes: `buildSeries`, `listOrgs`, types from `src/core/*`
- Produces: the rendered app

**Before writing chart code:** load the `dataviz` skill — it governs palette, axis, legend, and tooltip treatment.

- [ ] **Step 1: Write the failing test for dataset loading**

Create `src/ui/useDataset.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { parseDataset } from './useDataset'

describe('parseDataset', () => {
  it('accepts a well-formed dataset', () => {
    const ds = parseDataset({
      commits: [{ sha: 'a', repo: 'a/b', authoredAt: '2026-07-01T10:00:00.000+02:00' }],
      mergedPrs: [],
      meta: { syncedAt: '2026-07-31T00:00:00Z', rangeStart: '2026-01-01', rangeEnd: '2026-07-31' },
    })
    expect(ds.commits).toHaveLength(1)
  })

  it('rejects a payload missing commits with an actionable message', () => {
    expect(() => parseDataset({ mergedPrs: [] })).toThrow(/pnpm sync/i)
  })

  it('rejects a null payload', () => {
    expect(() => parseDataset(null)).toThrow(/pnpm sync/i)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run src/ui/useDataset.test.ts`
Expected: FAIL — cannot resolve `./useDataset`.

- [ ] **Step 3: Implement `src/ui/useDataset.ts`**

```ts
import { useEffect, useState } from 'react'
import type { Dataset } from '../core/types'

const MISSING =
  'No dataset found. Run `pnpm sync` to fetch your GitHub activity, then reload.'

export function parseDataset(json: unknown): Dataset {
  const o = json as Partial<Dataset> | null
  if (!o || !Array.isArray(o.commits) || !Array.isArray(o.mergedPrs)) {
    throw new Error(MISSING)
  }
  return {
    commits: o.commits,
    mergedPrs: o.mergedPrs,
    meta: o.meta ?? { syncedAt: '', rangeStart: '', rangeEnd: '' },
  }
}

export type DatasetState =
  | { status: 'loading' }
  | { status: 'ready'; dataset: Dataset }
  | { status: 'error'; message: string }

export function useDataset(): DatasetState {
  const [state, setState] = useState<DatasetState>({ status: 'loading' })

  useEffect(() => {
    let cancelled = false
    fetch('/data.json')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(MISSING))))
      .then((json) => {
        if (!cancelled) setState({ status: 'ready', dataset: parseDataset(json) })
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setState({ status: 'error', message: err instanceof Error ? err.message : MISSING })
        }
      })
    return () => { cancelled = true }
  }, [])

  return state
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm vitest run src/ui/useDataset.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Implement `src/ui/Controls.tsx`**

```tsx
import type { Bucket, Metric } from '../core/types'

interface Props {
  bucket: Bucket
  metric: Metric
  orgs: string[]
  selectedOrgs: Set<string>
  onBucket: (b: Bucket) => void
  onMetric: (m: Metric) => void
  onToggleOrg: (org: string) => void
}

function Segmented<T extends string>(props: {
  value: T
  options: ReadonlyArray<{ value: T; label: string }>
  onChange: (v: T) => void
}) {
  return (
    <div className="inline-flex overflow-hidden rounded-lg border border-neutral-300 dark:border-neutral-700">
      {props.options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => props.onChange(o.value)}
          aria-pressed={props.value === o.value}
          className={
            'px-3 py-1.5 text-sm transition-colors ' +
            (props.value === o.value
              ? 'bg-blue-600 font-semibold text-white'
              : 'hover:bg-neutral-100 dark:hover:bg-neutral-800')
          }
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function Controls(p: Props) {
  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
      <Segmented<Bucket>
        value={p.bucket}
        onChange={p.onBucket}
        options={[
          { value: 'week', label: 'Week' },
          { value: 'month', label: 'Month' },
        ]}
      />
      <Segmented<Metric>
        value={p.metric}
        onChange={p.onMetric}
        options={[
          { value: 'commits', label: 'Commits' },
          { value: 'lines', label: 'Lines changed' },
        ]}
      />
      <fieldset className="flex flex-wrap items-center gap-3">
        <legend className="sr-only">Organisations</legend>
        {p.orgs.map((org) => (
          <label key={org} className="flex cursor-pointer items-center gap-1.5 text-sm">
            <input
              type="checkbox"
              checked={p.selectedOrgs.has(org)}
              onChange={() => p.onToggleOrg(org)}
              className="size-4 accent-blue-600"
            />
            {org}
          </label>
        ))}
      </fieldset>
    </div>
  )
}
```

- [ ] **Step 6: Implement `src/ui/ActivityChart.tsx`**

```tsx
import {
  Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import type { Metric, SeriesPoint } from '../core/types'

const compact = new Intl.NumberFormat('en-GB', { notation: 'compact' })
const full = new Intl.NumberFormat('en-GB')

export function ActivityChart({ series, metric }: { series: SeriesPoint[]; metric: Metric }) {
  if (series.length === 0) {
    return (
      <div className="flex h-80 items-center justify-center rounded-xl border border-dashed border-neutral-300 text-sm text-neutral-500 dark:border-neutral-700">
        Nothing to show — select at least one organisation.
      </div>
    )
  }

  const name = metric === 'commits' ? 'Commits' : 'Lines changed'

  return (
    <div className="h-80 w-full">
      <ResponsiveContainer>
        <BarChart data={series} margin={{ top: 8, right: 8, bottom: 8, left: 8 }}>
          <CartesianGrid vertical={false} strokeOpacity={0.15} />
          <XAxis
            dataKey="label"
            tick={{ fontSize: 11 }}
            interval="preserveStartEnd"
            minTickGap={24}
          />
          <YAxis tick={{ fontSize: 11 }} tickFormatter={(v: number) => compact.format(v)} width={44} />
          <Tooltip
            formatter={(v) => [full.format(Number(v)), name]}
            contentStyle={{ fontSize: 12, borderRadius: 8 }}
          />
          <Bar dataKey="value" name={name} fill="#3b82f6" radius={[3, 3, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
```

- [ ] **Step 7: Implement `src/App.tsx`**

```tsx
import { useMemo, useState } from 'react'
import { buildSeries } from './core/aggregate'
import { listOrgs } from './core/orgs'
import type { Bucket, Metric } from './core/types'
import { ActivityChart } from './ui/ActivityChart'
import { Controls } from './ui/Controls'
import { useDataset } from './ui/useDataset'

export default function App() {
  const state = useDataset()
  const [bucket, setBucket] = useState<Bucket>('month')
  const [metric, setMetric] = useState<Metric>('commits')
  const [deselected, setDeselected] = useState<Set<string>>(new Set())

  const orgs = useMemo(
    () => (state.status === 'ready' ? listOrgs(state.dataset) : []),
    [state],
  )
  // Default to every org selected; track exclusions so newly-synced orgs appear.
  const selectedOrgs = useMemo(
    () => new Set(orgs.filter((o) => !deselected.has(o))),
    [orgs, deselected],
  )
  const series = useMemo(
    () =>
      state.status === 'ready'
        ? buildSeries(state.dataset, { bucket, metric, orgs: selectedOrgs })
        : [],
    [state, bucket, metric, selectedOrgs],
  )
  const total = useMemo(() => series.reduce((sum, p) => sum + p.value, 0), [series])

  const toggleOrg = (org: string): void => {
    setDeselected((prev) => {
      const next = new Set(prev)
      if (next.has(org)) next.delete(org)
      else next.add(org)
      return next
    })
  }

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <h1 className="text-2xl font-semibold">GitHub activity</h1>

      {state.status === 'loading' && <p className="mt-6 text-sm text-neutral-500">Loading…</p>}

      {state.status === 'error' && (
        <p className="mt-6 rounded-lg border border-amber-400 bg-amber-50 p-4 text-sm dark:bg-amber-950/30">
          {state.message}
        </p>
      )}

      {state.status === 'ready' && (
        <>
          <p className="mt-1 text-sm text-neutral-500">
            {new Intl.NumberFormat('en-GB').format(total)}{' '}
            {metric === 'commits' ? 'commits' : 'lines changed'} across{' '}
            {series.length} {bucket === 'week' ? 'weeks' : 'months'}
            {state.dataset.meta.syncedAt
              ? ` · synced ${state.dataset.meta.syncedAt.slice(0, 10)}`
              : ''}
          </p>

          <div className="mt-6">
            <Controls
              bucket={bucket}
              metric={metric}
              orgs={orgs}
              selectedOrgs={selectedOrgs}
              onBucket={setBucket}
              onMetric={setMetric}
              onToggleOrg={toggleOrg}
            />
          </div>

          <div className="mt-8">
            <ActivityChart series={series} metric={metric} />
          </div>

          {metric === 'lines' && (
            <p className="mt-4 text-xs text-neutral-500">
              Lines changed is additions + deletions from merged pull requests, credited to
              the merge date — so a PR merged this month may contain earlier work. Commit
              counts are exact; this metric is an approximation.
            </p>
          )}
        </>
      )}
    </main>
  )
}
```

- [ ] **Step 8: Implement `src/main.tsx`**

```tsx
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './styles.css'

const root = document.getElementById('root')
if (!root) throw new Error('Missing #root element')
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
```

- [ ] **Step 9: Verify the full suite and a type check pass**

Run: `pnpm test && pnpm build`
Expected: all tests PASS; build completes with no type errors.

- [ ] **Step 10: Run the app and confirm it renders real data**

Run: `pnpm dev`, open the printed URL.
Expected, verified by eye:
- Month view shows the 2026 shape measured during design: a May spike (~1,325), a June dip (~743), a July peak (~1,431)
- Toggling to Week re-buckets without a visible pause
- Unchecking `Huub-NL` drops the totals sharply (it dominates the data)
- Switching to Lines changed shows the approximation note

- [ ] **Step 11: Commit**

```bash
git add src/main.tsx src/App.tsx src/ui/
git commit -m "feat(ui): activity chart with week/month, metric, and org controls"
```

---

### Task 12: README

**Files:**
- Create: `README.md`

- [ ] **Step 1: Write `README.md`**

```markdown
# GitHub Personal Stats

A local dashboard of my GitHub commit activity over time, bucketed by ISO week or
calendar month and filterable by organisation.

It exists because the GitHub profile contribution graph is useless for this account:
all the work is in private repositories, so the contributions API returns only an
opaque `restrictedContributionsCount` with no breakdown.

## Usage

Requires Node 22+, pnpm, and an authenticated [`gh`](https://cli.github.com) CLI.

```bash
pnpm install
pnpm sync   # first run takes ~4-5 minutes; later runs take seconds
pnpm dev
```

`pnpm sync --full` discards the cache and rebuilds from scratch.

## How it works

- `src/ingest/` — fetches via `gh api` (so no token is ever handled here) and writes
  `public/data.json`. The GitHub Search API caps every query at 1,000 results and
  truncates *silently*, so windows are bisected adaptively until each fits under the
  cap. Search is limited to 30 requests/min, which is what makes the first run slow.
  Progress is cached after every window, so an interrupted sync resumes.
- `src/core/` — pure, dependency-free bucketing and aggregation. Commits are bucketed
  by the local date in the commit's own UTC offset, so a 23:00 commit counts toward
  the day it felt like.
- `src/ui/` — React SPA that loads the dataset once and filters in memory.

## Data caveats

- **Commit counts are exact.**
- **Lines changed is approximate**: additions + deletions from merged PRs only,
  credited to the PR's merge date. Per-commit diffs would cost ~9,000 extra API
  calls. A PR merged in July containing June work counts as July.

## Tests

```bash
pnpm test
```

The most important test asserts that a window reporting more than 1,000 results is
split rather than truncated — the bug it guards against would silently lose ~750
commits while producing a chart that looks entirely plausible.
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: add README"
```

---

## Self-Review

**1. Spec coverage**

| Spec requirement | Task |
| --- | --- |
| One chart of activity over time | 11 |
| Week / month toggle | 3 (logic), 11 (control) |
| Commits / lines metric toggle | 4 (logic), 11 (control) |
| Org checkboxes, derived from data | 2, 11 |
| `pnpm sync` / `pnpm dev` commands | 1, 10 |
| Adaptive bisection around the 1,000 cap | 7 |
| Rate limiting at 28/min | 6 |
| Resumable cache, dedupe by SHA | 8, 10 |
| Incremental sync with 3-day overlap; `--full` | 10 |
| Commits by own-offset local date | 3 |
| Lines = additions + deletions, merged only, merge date | 4, 9 |
| Auth via `gh`, no token handling | 5 |
| Error handling: gh missing/unauthenticated | 5 |
| Error handling: single day over cap logged loudly | 7, 10 |
| Error handling: missing `data.json` | 11 |
| Error handling: empty state | 4, 11 |
| Gap-filled buckets | 4 |
| Default range = account creation | 9, 10 |
| Tests: ISO week edges, month boundaries, local-date, dedupe, bisection, rate limiter | 3, 6, 7, 8 |

No gaps.

**2. Placeholder scan**

No TBD/TODO, no "add error handling" without code, no "similar to Task N". Every code
step contains complete, runnable content.

**3. Type consistency**

Verified across tasks: `CommitRecord`/`MergedPrRecord`/`Dataset`/`Bucket`/`Metric`/
`SeriesPoint`/`LocalDate` (Task 1) are used unchanged in 2, 3, 4, 8, 9, 11.
`DateWindow`, `windowKey`, `splitWindow`, `PageFetcher`, `collectWindow` (Task 7) are
consumed with matching signatures in 9 and 10. `RateLimiter.acquire`/`pauseFor`
(Task 6) match usage in 9. `orgOf`/`listOrgs` (Task 2) match usage in 4 and 11.
`buildSeries(ds, { bucket, metric, orgs })` (Task 4) matches its call in 11.
`bucketKeyOfLocalDate` is exported in Task 3 and consumed in Task 4.

**Known deliberate gap:** `RateLimiter.pauseFor` is implemented and tested in Task 6
but never called by the fetchers in Task 9 — GitHub's `Retry-After` header is not
surfaced through `gh api`'s JSON output, so honouring it would require parsing stderr.
The 28/min ceiling keeps runs comfortably inside the limit in practice. If secondary
rate limits do bite during Task 10's real run, wire `pauseFor` into the fetchers'
error path then.
