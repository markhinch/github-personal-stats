# Per-repo Bar Segments Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "By repo" mode that splits each activity bar into coloured segments for the top 5 repositories in the visible window, folding the rest into a neutral "Other".

**Architecture:** Additive throughout. `buildSeries` and every stat tile are untouched; a parallel `buildRepoSeries` produces per-repo detail, `foldToTopRepos` bounds it to 5 hues + Other, and `ActivityChart` grows a second render shape behind a `split` prop. Ranking happens *after* windowing so segments describe what is on screen.

**Tech Stack:** TypeScript, React 19, Recharts 3, Tailwind 4 (`@theme` tokens), Vitest.

Spec: `docs/superpowers/specs/2026-08-10-repo-segments-design.md`

## Global Constraints

- Run tests with `pnpm test` (Vitest, `run` mode). Typecheck with `pnpm build` (`tsc --noEmit && vite build`).
- `buildSeries` in `src/core/aggregate.ts` must keep its current signature and behaviour. Existing tests in `src/core/aggregate.test.ts` must pass unmodified.
- Colours are only ever referenced as CSS custom properties (`var(--color-series-2)`), never as literal hex, outside `src/styles.css`. Recharts accepts `var()` as an SVG attribute value.
- Text wears ink tokens (`--color-ink`, `--color-ink-2`, `--color-muted`), never a series colour.
- The dark column of every token is a *selected* value from the spec's table, not a computed flip.
- `Other` is the string `"Other"`, exported as `OTHER_KEY`. Never inline the literal outside its defining module.
- No new dependencies.
- Repo ids always contain `/` (enforced by `isRepoId`), so they can never collide with `OTHER_KEY`.

---

### Task 1: Per-repo series builder

Extracts the bucket-key walk so one copy serves both builders, then adds `buildRepoSeries`.

**Files:**
- Modify: `src/core/aggregate.ts`
- Test: `src/core/aggregate.test.ts` (append; do not edit existing tests)

**Interfaces:**
- Consumes: `bucketKeyOf`, `bucketKeyOfLocalDate`, `bucketLabelOf`, `bucketStartOf`, `fromDayNumber`, `toDayNumber` from `./buckets`; `orgOf` from `./orgs`; `SeriesOptions` (already exported from this file).
- Produces: `export interface RepoPoint { key: string; label: string; total: number; byRepo: Record<string, number> }` and `export function buildRepoSeries(ds: Dataset, opts: SeriesOptions): RepoPoint[]`.

- [ ] **Step 1: Write the failing tests**

Append to `src/core/aggregate.test.ts`. The `ds` and `allOrgs` fixtures already exist at the top of that file — reuse them, do not redeclare.

```ts
import { buildRepoSeries, buildSeries } from './aggregate'

describe('buildRepoSeries', () => {
  it('splits each bucket by repo', () => {
    const s = buildRepoSeries(ds, { bucket: 'month', metric: 'commits', orgs: allOrgs })
    expect(s.find((p) => p.key === '2026-05')?.byRepo).toEqual({
      'Huub-NL/finview': 2,
      'markhinch/zen': 1,
    })
  })

  it('carries a total alongside the split', () => {
    const s = buildRepoSeries(ds, { bucket: 'month', metric: 'commits', orgs: allOrgs })
    expect(s.find((p) => p.key === '2026-05')?.total).toBe(3)
  })

  it('splits line churn by repo', () => {
    const s = buildRepoSeries(ds, { bucket: 'month', metric: 'lines', orgs: allOrgs })
    expect(s.find((p) => p.key === '2026-05')?.byRepo).toEqual({
      'Huub-NL/finview': 120,
      'markhinch/zen': 6,
    })
  })

  it('gives empty buckets a zero total and no repos', () => {
    const s = buildRepoSeries(ds, { bucket: 'month', metric: 'commits', orgs: allOrgs })
    const june = s.find((p) => p.key === '2026-06')
    expect(june?.total).toBe(0)
    expect(june?.byRepo).toEqual({})
  })

  it('excludes repos whose org is deselected', () => {
    const s = buildRepoSeries(ds, {
      bucket: 'month', metric: 'commits', orgs: new Set(['Huub-NL']),
    })
    expect(s.find((p) => p.key === '2026-05')?.byRepo).toEqual({ 'Huub-NL/finview': 2 })
  })

  it('returns nothing when no org is selected', () => {
    expect(buildRepoSeries(ds, { bucket: 'month', metric: 'commits', orgs: new Set() })).toEqual([])
  })

  // Guards the bucketKeysBetween extraction: if the shared walk changes
  // behaviour, the two builders stop agreeing.
  it.each(['commits', 'lines'] as const)('totals agree with buildSeries for %s', (metric) => {
    for (const bucket of ['week', 'month'] as const) {
      const flat = buildSeries(ds, { bucket, metric, orgs: allOrgs })
      const split = buildRepoSeries(ds, { bucket, metric, orgs: allOrgs })
      expect(split.map((p) => [p.key, p.total])).toEqual(flat.map((p) => [p.key, p.value]))
    }
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm test src/core/aggregate.test.ts
```

Expected: FAIL — `buildRepoSeries` is not exported from `./aggregate`.

- [ ] **Step 3: Extract the shared bucket walk**

In `src/core/aggregate.ts`, add this module-private helper above `buildSeries`:

```ts
/**
 * Every distinct bucket key from `firstKey`'s start through `lastKey`'s start,
 * in order.
 *
 * Walks day by day rather than bucket by bucket: day-stepping keeps this
 * correct across month lengths, leap years, and ISO week-year boundaries alike.
 */
function bucketKeysBetween(firstKey: string, lastKey: string, bucket: Bucket): string[] {
  const endDay = toDayNumber(bucketStartOf(lastKey, bucket))
  const out: string[] = []
  let seenKey: string | null = null

  for (let day = toDayNumber(bucketStartOf(firstKey, bucket)); day <= endDay; day++) {
    const key = bucketKeyOfLocalDate(fromDayNumber(day), bucket)
    if (key === seenKey) continue
    seenKey = key
    out.push(key)
  }

  return out
}
```

Then replace the body of `buildSeries` from `const keys = [...totals.keys()].sort()` to the end (the `for` loop and its surrounding comment go away) with:

```ts
  const keys = [...totals.keys()].sort()

  return bucketKeysBetween(keys[0]!, keys[keys.length - 1]!, bucket).map((key) => ({
    key,
    label: bucketLabelOf(key, bucket),
    value: totals.get(key) ?? 0,
  }))
}
```

- [ ] **Step 4: Run tests to verify the extraction broke nothing**

```bash
pnpm test src/core/aggregate.test.ts
```

Expected: the pre-existing `buildSeries` tests PASS; the new `buildRepoSeries` tests still FAIL.

- [ ] **Step 5: Add `buildRepoSeries`**

Append to `src/core/aggregate.ts`:

```ts
/** One bucket of activity, split by the repositories that made it up. */
export interface RepoPoint {
  /** Sortable bucket identity, e.g. "2026-W31" or "2026-07". */
  key: string
  /** Human label, e.g. "W31 2026" or "Jul 2026". */
  label: string
  /** Sum of every value in byRepo. */
  total: number
  /** Repo id -> value. A repo with no activity in this bucket is absent. */
  byRepo: Record<string, number>
}

/**
 * The same aggregation as `buildSeries` — same filtering, same contiguous
 * gap-filled buckets — but retaining which repo each unit of work belongs to.
 *
 * Deliberately a second pass over the dataset rather than the source
 * `buildSeries` is derived from: at this dataset's size the extra scan is
 * cheap, and the two staying independent keeps the gap-fill logic that every
 * existing test covers exactly where it was.
 */
export function buildRepoSeries(ds: Dataset, opts: SeriesOptions): RepoPoint[] {
  const { bucket, metric, orgs } = opts
  const byBucket = new Map<string, Map<string, number>>()

  const record = (iso: string, repo: string, amount: number): void => {
    if (!orgs.has(orgOf(repo))) return
    const key = bucketKeyOf(iso, bucket)
    let repos = byBucket.get(key)
    if (repos === undefined) {
      repos = new Map()
      byBucket.set(key, repos)
    }
    repos.set(repo, (repos.get(repo) ?? 0) + amount)
  }

  if (metric === 'commits') {
    for (const c of ds.commits) record(c.authoredAt, c.repo, 1)
  } else {
    for (const p of ds.mergedPrs) record(p.mergedAt, p.repo, p.additions + p.deletions)
  }

  if (byBucket.size === 0) return []

  const keys = [...byBucket.keys()].sort()

  return bucketKeysBetween(keys[0]!, keys[keys.length - 1]!, bucket).map((key) => {
    const byRepo: Record<string, number> = {}
    let total = 0
    for (const [repo, value] of byBucket.get(key) ?? []) {
      byRepo[repo] = value
      total += value
    }
    return { key, label: bucketLabelOf(key, bucket), total, byRepo }
  })
}
```

- [ ] **Step 6: Run the full suite**

```bash
pnpm test
```

Expected: PASS, all files.

- [ ] **Step 7: Commit**

```bash
git add src/core/aggregate.ts src/core/aggregate.test.ts
git commit -m "feat(core): add buildRepoSeries, sharing the bucket walk with buildSeries"
```

---

### Task 2: Fold to top repos

**Files:**
- Create: `src/core/topRepos.ts`
- Test: `src/core/topRepos.test.ts`

**Interfaces:**
- Consumes: `RepoPoint` from `./aggregate` (Task 1).
- Produces: `OTHER_KEY`, `interface StackPoint { key: string; label: string; total: number; values: Record<string, number> }`, `interface RepoStack { repos: string[]; hasOther: boolean; points: StackPoint[] }`, `function foldToTopRepos(points: readonly RepoPoint[], limit: number): RepoStack`.

Note on shape: `values` is a nested record, not flattened onto the point. A flat `{ key: string } & Record<string, number>` collapses `key` to `never` under TypeScript's intersection rules, and Recharts' dotted-path `dataKey` would break on any repo name containing a `.`. Task 5 reads it with a function `dataKey` instead.

- [ ] **Step 1: Write the failing test**

Create `src/core/topRepos.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import type { RepoPoint } from './aggregate'
import { OTHER_KEY, foldToTopRepos } from './topRepos'

/** Builds one bucket from a repo -> value map. */
const point = (key: string, byRepo: Record<string, number>): RepoPoint => ({
  key,
  label: key,
  total: Object.values(byRepo).reduce((a, b) => a + b, 0),
  byRepo,
})

describe('foldToTopRepos', () => {
  it('ranks repos by their total across the window, largest first', () => {
    const stack = foldToTopRepos(
      [point('a', { 'o/small': 1, 'o/big': 10 }), point('b', { 'o/small': 2, 'o/big': 1 })],
      5,
    )
    expect(stack.repos).toEqual(['o/big', 'o/small'])
  })

  it('ranks on the window total, not on any single bucket', () => {
    // o/steady never wins a bucket outright but wins the window.
    const stack = foldToTopRepos(
      [point('a', { 'o/spike': 9, 'o/steady': 5 }), point('b', { 'o/steady': 5 })],
      5,
    )
    expect(stack.repos).toEqual(['o/steady', 'o/spike'])
  })

  it('breaks ties on repo id ascending so the order is deterministic', () => {
    const stack = foldToTopRepos([point('a', { 'o/b': 5, 'o/a': 5, 'o/c': 5 })], 5)
    expect(stack.repos).toEqual(['o/a', 'o/b', 'o/c'])
  })

  it('keeps the top `limit` and folds the rest into Other', () => {
    const stack = foldToTopRepos(
      [point('a', { 'o/1': 10, 'o/2': 9, 'o/3': 8, 'o/4': 7, 'o/5': 6, 'o/6': 5, 'o/7': 4 })],
      5,
    )
    expect(stack.repos).toEqual(['o/1', 'o/2', 'o/3', 'o/4', 'o/5'])
    expect(stack.hasOther).toBe(true)
    expect(stack.points[0]?.values[OTHER_KEY]).toBe(9)
  })

  it('has no Other segment at exactly the limit', () => {
    const stack = foldToTopRepos([point('a', { 'o/1': 3, 'o/2': 2, 'o/3': 1 })], 3)
    expect(stack.hasOther).toBe(false)
    expect(stack.points[0]?.values).not.toHaveProperty(OTHER_KEY)
  })

  it('writes an explicit zero for a repo absent from a bucket', () => {
    const stack = foldToTopRepos([point('a', { 'o/x': 1 }), point('b', { 'o/y': 1 })], 5)
    expect(stack.points[0]?.values).toEqual({ 'o/x': 1, 'o/y': 0 })
  })

  it('carries key, label and total through unchanged', () => {
    const stack = foldToTopRepos([point('2026-07', { 'o/x': 4 })], 5)
    expect(stack.points[0]).toMatchObject({ key: '2026-07', label: '2026-07', total: 4 })
  })

  it('returns an empty stack for empty input', () => {
    expect(foldToTopRepos([], 5)).toEqual({ repos: [], hasOther: false, points: [] })
  })

  it('names no repos for a window in which nothing happened', () => {
    // Gap-filled buckets are real points with no repos — not the same as no data.
    const stack = foldToTopRepos([point('a', {}), point('b', {})], 5)
    expect(stack.repos).toEqual([])
    expect(stack.hasOther).toBe(false)
    expect(stack.points).toHaveLength(2)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm test src/core/topRepos.test.ts
```

Expected: FAIL — cannot resolve `./topRepos`.

- [ ] **Step 3: Write the implementation**

Create `src/core/topRepos.ts`:

```ts
import type { RepoPoint } from './aggregate'

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
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm test src/core/topRepos.test.ts
```

Expected: PASS, 9 tests.

- [ ] **Step 5: Commit**

```bash
git add src/core/topRepos.ts src/core/topRepos.test.ts
git commit -m "feat(core): fold a windowed repo series to the top N plus Other"
```

---

### Task 3: Window generic over point type

**Files:**
- Modify: `src/ui/range.ts`
- Test: `src/ui/range.test.ts` (append)

**Interfaces:**
- Produces: `function windowSeries<T extends { key: string }>(series: readonly T[], startKey: string | null): T[]` — same runtime behaviour, now usable with `RepoPoint`.

- [ ] **Step 1: Write the failing test**

Append to `src/ui/range.test.ts`:

```ts
import type { RepoPoint } from '../core/aggregate'

describe('windowSeries — repo points', () => {
  const repoPoints = (keys: string[]): RepoPoint[] =>
    keys.map((key) => ({ key, label: key, total: 1, byRepo: { 'o/x': 1 } }))

  it('windows a per-repo series on the same key comparison', () => {
    const s = repoPoints(['2026-01', '2026-02', '2026-03'])
    expect(windowSeries(s, '2026-02').map((p) => p.key)).toEqual(['2026-02', '2026-03'])
  })

  it('preserves the per-repo split through the window', () => {
    const s = repoPoints(['2026-01', '2026-02'])
    expect(windowSeries(s, '2026-02')[0]?.byRepo).toEqual({ 'o/x': 1 })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm test src/ui/range.test.ts
```

Expected: FAIL at typecheck — `RepoPoint` is not assignable to `readonly SeriesPoint[]` (missing `value`). Vitest may still run; confirm with `pnpm build`, which must report the same error.

- [ ] **Step 3: Make it generic**

In `src/ui/range.ts`, replace the `windowSeries` declaration:

```ts
/**
 * Generic over the point type: the total series and the per-repo series are
 * windowed against the same key, and only the sortable `key` is involved.
 */
export function windowSeries<T extends { key: string }>(
  series: readonly T[],
  startKey: string | null,
): T[] {
  return startKey === null ? [...series] : series.filter((p) => p.key >= startKey)
}
```

`windowStartKey` is unchanged — it still takes `SeriesPoint` lists, because the window is always derived from the two total series.

- [ ] **Step 4: Run tests and typecheck**

```bash
pnpm test src/ui/range.test.ts && pnpm build
```

Expected: tests PASS, build clean.

- [ ] **Step 5: Commit**

```bash
git add src/ui/range.ts src/ui/range.test.ts
git commit -m "refactor(ui): make windowSeries generic over the point type"
```

---

### Task 4: Palette tokens and slot assignment

**Files:**
- Modify: `src/styles.css`
- Create: `src/ui/palette.ts`
- Test: `src/ui/palette.test.ts`

**Interfaces:**
- Consumes: `OTHER_KEY` from `../core/topRepos` (Task 2).
- Produces: `MAX_SERIES: number` (5), `function segmentColors(repos: readonly string[], hasOther: boolean): Record<string, string>` — maps each segment key to a `var(--…)` string.

- [ ] **Step 1: Add the tokens**

In `src/styles.css`, inside `@theme`, replace the existing slot-1 block with the full categorical set. Keep the existing comments on `--color-accent` and `--color-accent-wash` exactly as they are.

```css
  /*
   * Categorical slots 1-5, from the dataviz reference palette. Validated as a
   * set in both modes: worst adjacent CVD ΔE 9.1 light / 8.4 dark (>=8 target),
   * worst adjacent normal-vision ΔE 19.6 light / 19.3 dark (>=15 floor).
   *
   * Slots 3, 4 and 5 fall below 3:1 against the light surface, so the relief
   * rule applies — the chart legend and the per-repo tooltip are what discharge
   * it, and neither is optional.
   */
  --color-series-1: #2a78d6;
  --color-series-2: #eb6834;
  --color-series-3: #1baf7a;
  --color-series-4: #eda100;
  --color-series-5: #e87ba4;
  /*
   * "Other" is an absence of identity, not a sixth category, so it is a neutral
   * outside the categorical palette and deliberately recessive. Stepped to stay
   * visible without competing: 2.70:1 light, 3.24:1 dark.
   */
  --color-series-other: #9d9c8e;
```

In the `@media (prefers-color-scheme: dark)` block, replace the `--color-series-1` line with:

```css
    --color-series-1: #3987e5;
    --color-series-2: #d95926;
    --color-series-3: #199e70;
    --color-series-4: #c98500;
    --color-series-5: #d55181;
    --color-series-other: #6b6b63;
```

- [ ] **Step 2: Write the failing test**

Create `src/ui/palette.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { OTHER_KEY } from '../core/topRepos'
import { MAX_SERIES, segmentColors } from './palette'

describe('segmentColors', () => {
  it('assigns the categorical slots in stack order', () => {
    expect(segmentColors(['o/a', 'o/b'], false)).toEqual({
      'o/a': 'var(--color-series-1)',
      'o/b': 'var(--color-series-2)',
    })
  })

  it('gives Other the neutral, never a categorical slot', () => {
    const colors = segmentColors(['o/a'], true)
    expect(colors[OTHER_KEY]).toBe('var(--color-series-other)')
    expect(colors['o/a']).toBe('var(--color-series-1)')
  })

  it('omits Other when there is none', () => {
    expect(segmentColors(['o/a'], false)).not.toHaveProperty(OTHER_KEY)
  })

  it('covers a full stack at the maximum', () => {
    const repos = Array.from({ length: MAX_SERIES }, (_, i) => `o/${i}`)
    const colors = segmentColors(repos, true)
    expect(Object.keys(colors)).toHaveLength(MAX_SERIES + 1)
    expect(colors[`o/${MAX_SERIES - 1}`]).toBe(`var(--color-series-${MAX_SERIES})`)
  })

  it('throws rather than cycling hues past the last slot', () => {
    const repos = Array.from({ length: MAX_SERIES + 1 }, (_, i) => `o/${i}`)
    expect(() => segmentColors(repos, false)).toThrow(/MAX_SERIES/)
  })

  it('is the palette size the fold should be limited to', () => {
    expect(MAX_SERIES).toBe(5)
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

```bash
pnpm test src/ui/palette.test.ts
```

Expected: FAIL — cannot resolve `./palette`.

- [ ] **Step 4: Write the implementation**

Create `src/ui/palette.ts`:

```ts
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
```

- [ ] **Step 5: Run test to verify it passes**

```bash
pnpm test src/ui/palette.test.ts
```

Expected: PASS, 6 tests.

- [ ] **Step 6: Commit**

```bash
git add src/styles.css src/ui/palette.ts src/ui/palette.test.ts
git commit -m "feat(ui): add categorical slots 2-5 and the Other neutral"
```

---

### Task 5: Chart legend

**Files:**
- Create: `src/ui/ChartLegend.tsx`

**Interfaces:**
- Consumes: `segmentColors` output shape (`Record<string, string>`) from Task 4.
- Produces: `function ChartLegend(props: { segments: readonly string[]; colors: Record<string, string> }): JSX.Element`.

There is no test for this task — the project has no component-test setup (no jsdom, no Testing Library), and adding one for a presentational list is out of proportion. It is verified by typecheck and by the browser pass in Task 7.

- [ ] **Step 1: Write the component**

Create `src/ui/ChartLegend.tsx`:

```tsx
interface Props {
  /** Segment keys in stack order, largest first. */
  segments: readonly string[]
  /** Segment key -> CSS colour value. */
  colors: Record<string, string>
}

/**
 * Names every segment beside its swatch, so identity never rests on colour
 * alone — which is what lets the three light-mode slots that sit under 3:1
 * against the surface be used at all.
 *
 * Present only when the chart is split; a single series needs no legend,
 * because the heading above the plot already names it.
 */
export function ChartLegend({ segments, colors }: Props) {
  if (segments.length === 0) return null

  return (
    <ul className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5">
      {segments.map((segment) => (
        <li key={segment} className="flex items-center gap-1.5 text-[11px] text-ink-2">
          <span
            aria-hidden
            className="size-2.5 shrink-0 rounded-[3px]"
            style={{ background: colors[segment] }}
          />
          {segment}
        </li>
      ))}
    </ul>
  )
}
```

- [ ] **Step 2: Typecheck**

```bash
pnpm build
```

Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/ui/ChartLegend.tsx
git commit -m "feat(ui): add the chart legend for split bars"
```

---

### Task 6: Stacked chart mode

**Files:**
- Modify: `src/ui/ActivityChart.tsx`

**Interfaces:**
- Consumes: `RepoStack`, `StackPoint`, `OTHER_KEY` from `../core/topRepos`; `segmentColors` from `./palette`; `ChartLegend` from `./ChartLegend`.
- Produces: `ActivityChart` gains a required `stack: RepoStack | null` prop. `null` renders exactly today's chart; non-null renders the split.

- [ ] **Step 1: Add the tooltip**

Add to `src/ui/ActivityChart.tsx`, above the `ActivityChart` function:

```tsx
const TOOLTIP_SURFACE = {
  fontSize: 12,
  borderRadius: 10,
  background: 'var(--color-surface)',
  border: '1px solid var(--color-hairline)',
  boxShadow: '0 4px 12px rgba(11,11,11,0.08)',
} as const

/**
 * The per-bucket breakdown table. Alongside the legend, this is the relief the
 * palette's light-mode contrast warning obliges — the numbers are readable
 * without resolving a colour.
 */
function RepoTooltip(props: {
  active?: boolean
  payload?: ReadonlyArray<{ payload?: StackPoint }>
  colors: Record<string, string>
}) {
  const point = props.payload?.[0]?.payload
  if (props.active !== true || point === undefined) return null

  // Zero-valued repos are padding for the stack's shape, not part of the
  // bucket's story, so they are dropped here. Other always sorts last.
  const rows = Object.entries(point.values)
    .filter(([, value]) => value > 0)
    .sort(([aKey, aValue], [bKey, bValue]) => {
      if (aKey === OTHER_KEY) return 1
      if (bKey === OTHER_KEY) return -1
      return bValue - aValue
    })

  return (
    <div style={TOOLTIP_SURFACE} className="px-3 py-2">
      <p className="font-semibold text-ink">{point.label}</p>
      <table className="mt-1.5 w-full border-collapse">
        <tbody>
          {rows.map(([segment, value]) => (
            <tr key={segment}>
              <td className="py-0.5 pr-3">
                <span className="flex items-center gap-1.5 text-ink-2">
                  <span
                    aria-hidden
                    className="size-2 shrink-0 rounded-[2px]"
                    style={{ background: props.colors[segment] }}
                  />
                  {segment}
                </span>
              </td>
              <td className="py-0.5 text-right tabular-nums text-ink">{formatExact(value)}</td>
            </tr>
          ))}
          <tr className="border-t border-hairline">
            <td className="pt-1 pr-3 font-semibold text-ink">Total</td>
            <td className="pt-1 text-right font-semibold tabular-nums text-ink">
              {formatExact(point.total)}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  )
}
```

Update the imports at the top of the file:

```tsx
import { OTHER_KEY, type RepoStack, type StackPoint } from '../core/topRepos'
import { segmentColors } from './palette'
import { ChartLegend } from './ChartLegend'
```

- [ ] **Step 2: Add the prop and the split branch**

Add to the `Props` interface:

```tsx
  /**
   * The per-repo split to draw, or null for a single-hue total bar. Ranked and
   * bounded upstream — this component only draws what it is handed.
   */
  stack: RepoStack | null
```

Change the signature to `export function ActivityChart({ series, metric, hasOrgs, stack }: Props)`.

Immediately after the existing `series.length === 0` empty-state block, insert:

```tsx
  if (stack !== null) return <StackedChart stack={stack} />
```

- [ ] **Step 3: Write the stacked renderer**

Add below `ActivityChart` in the same file:

```tsx
function StackedChart({ stack }: { stack: RepoStack }) {
  const segments = stack.hasOther ? [...stack.repos, OTHER_KEY] : stack.repos
  const colors = segmentColors(stack.repos, stack.hasOther)

  return (
    <>
      <div className="h-80 w-full">
        <ResponsiveContainer>
          {/*
            No top margin for value labels: a stack has no single bar to anchor
            them to, so the breakdown lives in the tooltip instead.
          */}
          <BarChart data={stack.points} margin={{ top: 8, right: 22, bottom: 0, left: 0 }}>
            <CartesianGrid vertical={false} stroke="var(--color-grid)" />
            <XAxis
              dataKey="label"
              tick={{ fontSize: 11, fill: 'var(--color-muted)' }}
              stroke="var(--color-baseline)"
              tickLine={false}
              tickMargin={8}
              interval="preserveStartEnd"
              minTickGap={12}
            />
            <YAxis
              tick={{ fontSize: 11, fill: 'var(--color-muted)' }}
              stroke="var(--color-grid)"
              tickLine={false}
              axisLine={false}
              tickFormatter={(v: number) => formatCompact(v)}
              width={44}
            />
            <Tooltip
              cursor={{ fill: 'var(--color-grid)', fillOpacity: 0.45 }}
              content={<RepoTooltip colors={colors} />}
            />
            {/*
              Declared largest-first, which Recharts stacks from the baseline up.
              The rounded cap therefore belongs to the last bar declared; in a
              bucket where that segment is zero the stack simply reads
              flat-topped, which is cosmetic and accepted.

              A function dataKey, not a dotted path: repo names may contain dots,
              which Recharts would read as nesting.
            */}
            {segments.map((segment, i) => (
              <Bar
                key={segment}
                dataKey={(p: StackPoint) => p.values[segment] ?? 0}
                name={segment}
                stackId="a"
                fill={colors[segment]}
                // A 2px surface gap between fills, per the mark specs.
                stroke="var(--color-surface)"
                strokeWidth={2}
                radius={i === segments.length - 1 ? [4, 4, 0, 0] : undefined}
                maxBarSize={24}
                isAnimationActive={false}
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
      <ChartLegend segments={segments} colors={colors} />
    </>
  )
}
```

- [ ] **Step 4: Typecheck**

```bash
pnpm build
```

Expected: FAIL — `App.tsx` does not yet pass `stack`. That is Task 7; confirm the error names only `App.tsx` and nothing in `ActivityChart.tsx`.

- [ ] **Step 5: Commit**

```bash
git add src/ui/ActivityChart.tsx
git commit -m "feat(ui): draw bars as a per-repo stack with a breakdown tooltip"
```

---

### Task 7: Breakdown control and wiring

**Files:**
- Modify: `src/ui/Controls.tsx`
- Modify: `src/App.tsx`

**Interfaces:**
- Consumes: everything from Tasks 1–6.
- Produces: `export type Split = 'none' | 'repo'` in `src/core/types.ts`, beside `Bucket` and `Metric`, where the other view enums live.

- [ ] **Step 1: Add the type**

Append to `src/core/types.ts`, directly below the `Metric` line:

```ts
/** Whether bars are drawn as one total or split by repository. */
export type Split = 'none' | 'repo'
```

- [ ] **Step 2: Add the control**

In `src/ui/Controls.tsx`, extend the import and the `Props` interface:

```ts
import type { Bucket, Metric, Split } from '../core/types'
```

```ts
  split: Split
  onSplit: (s: Split) => void
```

Then add a fourth `Field` immediately after the `Bucket` field and before `Range`:

```tsx
      <Field label="Breakdown">
        <Segmented<Split>
          value={p.split}
          onChange={p.onSplit}
          options={[
            { value: 'none', label: 'Total' },
            { value: 'repo', label: 'By repo' },
          ]}
        />
      </Field>
```

- [ ] **Step 3: Wire the state**

In `src/App.tsx`, extend the imports:

```ts
import { buildRepoSeries, buildSeries } from './core/aggregate'
import { foldToTopRepos } from './core/topRepos'
import type { Bucket, Metric, SeriesPoint, Split } from './core/types'
import { MAX_SERIES } from './ui/palette'
```

Add the state beside the others:

```ts
  const [split, setSplit] = useState<Split>('none')
```

Replace the `view` memo with:

```ts
  const view = useMemo(() => {
    if (state.status !== 'ready') return null
    const commits = buildSeries(state.dataset, { bucket, metric: 'commits', orgs: selectedOrgs })
    const lines = buildSeries(state.dataset, { bucket, metric: 'lines', orgs: selectedOrgs })
    const start = windowStartKey([commits, lines], bucketsInRange(range, bucket))

    // Built for the selected metric only. The two total series are both built
    // because the tiles show commits and churn together; nothing on screen
    // needs the unselected metric's split.
    const stack =
      split === 'repo'
        ? foldToTopRepos(
            windowSeries(
              buildRepoSeries(state.dataset, { bucket, metric, orgs: selectedOrgs }),
              start,
            ),
            MAX_SERIES,
          )
        : null

    return {
      commits: windowSeries(commits, start),
      lines: windowSeries(lines, start),
      stack,
    }
  }, [state, bucket, metric, range, selectedOrgs, split])
```

Pass the two new props. On `<Controls …>` add:

```tsx
              split={split}
              onSplit={setSplit}
```

And on `<ActivityChart …>` add:

```tsx
                  stack={view?.stack ?? null}
```

- [ ] **Step 4: Typecheck and run the full suite**

```bash
pnpm build && pnpm test
```

Expected: both clean.

- [ ] **Step 5: Verify in the browser**

Add `.claude/launch.json` if it does not exist:

```json
{
  "version": "0.0.1",
  "configurations": [
    { "name": "stats", "runtimeExecutable": "pnpm", "runtimeArgs": ["dev"], "port": 5173 }
  ]
}
```

Start the preview with the `preview_start` tool (name `stats`) — never `pnpm dev` in Bash. Then check, reading the console for errors at each step:

1. Default load shows the single-hue chart with its value labels, unchanged.
2. Switching Breakdown to "By repo" gives a stacked chart with a legend beneath it. At 1 year / month you should see `Huub-NL/huub` and `Huub-NL/finview` dominating, plus a grey `Other`.
3. Hovering a bar shows the breakdown table, values descending, `Other` last, total ruled off at the bottom.
4. Switching Range to "All time" re-ranks the legend — expected, per the spec's per-window decision.
5. Deselecting the `Huub-NL` org chip drops those segments and re-ranks.
6. `resize_window` with `colorScheme: 'dark'` — confirm every segment is distinguishable from its neighbours and from the surface.
7. Switching Metric to "Lines changed" keeps the split and re-ranks on churn.

Take a screenshot of the split chart in each colour scheme.

- [ ] **Step 6: Commit**

```bash
git add src/core/types.ts src/ui/Controls.tsx src/App.tsx .claude/launch.json
git commit -m "feat(ui): add the Total / By repo breakdown control"
```

---

## Self-review notes

- **Spec coverage.** Data layer → Tasks 1–3. Palette and the relief rule → Tasks 4, 5, 6 (legend and tooltip are both built and both non-optional). UI controls → Task 7. Testing section → Tasks 1, 2, 3 (component tests deliberately omitted; see Task 5's note, which the spec's testing section does not require).
- **Out-of-scope items stay out.** Stat tiles, org filtering, legend interaction, texture fills and an expandable `Other` are untouched by every task.
- **One naming correction applied.** The spec calls the state field `split: 'none' | 'repo'` and names the type `SplitId`; this plan declares it as `Split` in `src/core/types.ts` alongside `Bucket` and `Metric`, since `RangeId` lives in `ui/range.ts` only because the range options table lives there too. The field name is unchanged.
- **Known intermediate break.** Task 6 leaves `pnpm build` failing on `App.tsx` until Task 7 adds the prop. This is called out in Task 6, Step 4 with the exact expected error so it is not mistaken for a defect.
