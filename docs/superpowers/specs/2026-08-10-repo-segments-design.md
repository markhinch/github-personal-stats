# Per-repo bar segments

Date: 2026-08-10

## Problem

The activity chart draws one bar per bucket in a single hue. It answers "how
much did I commit" but not "where did that work go". The dataset spans 37
repositories across 4 orgs, and the only repo-level control today is the org
checkbox row, which is coarser than the question — `Huub-NL/huub` and
`Huub-NL/finview` are the same org but different work.

Goal: let a bar be split into coloured segments showing which repositories made
it up, so the divide between repos is readable at a glance.

## Constraints that shaped the design

**37 repos, heavily long-tailed.** `Huub-NL/huub` (4317 commits) and
`Huub-NL/finview` (2092) are 72% of the 8842 total. No categorical palette stays
readable past ~6 colours, and the dataviz skill forbids cycling hues for a 9th
series. So "one colour per repo" cannot be literal: the top 5 by volume get
hues, everything else folds into a single neutral `Other`.

**The breakdown is additive, not a replacement.** The existing single-hue chart
stays the default. The breakdown is a mode you switch on.

**Ranking is per-window, and this knowingly bends a dataviz rule.** The skill's
non-negotiable is "colour follows the entity, never its rank — a filter that
changes the series count must not repaint the survivors." Ranking within the
visible window violates that: switching 1y → all-time can move
`modem-works/dream-recorder` from orange to aqua.

The alternative — rank once globally so each repo owns its colour forever — was
considered and rejected. It would permanently bury any repo outside the all-time
top 5 in `Other`, so a 1-year view could show `markhinch/github-personal-stats`
as a grey `Other` segment in a period where it dominated. With 5 slots and 37
repos there is no option that satisfies both; segments describing what is
actually on screen won.

The mitigation is that the legend sits directly under the plot, in stack order,
and updates with the ranking — so slot 1 always reads as "biggest in this view"
and identity is never inferred from memory of a previous view.

## Data layer

`buildSeries` in `src/core/aggregate.ts` is **unchanged**. Total-mode bars and
every stat tile keep using it, so this change is additive and the existing tests
stand.

### `buildRepoSeries(ds, opts): RepoPoint[]`

New export in `src/core/aggregate.ts`. Same signature as `buildSeries` — same
`bucket` / `metric` / `orgs` options, same org filtering, same contiguous
gap-filled output — but each point carries the per-repo split:

```ts
export interface RepoPoint {
  /** Sortable bucket identity, e.g. "2026-W31" or "2026-07". */
  key: string
  /** Human label, e.g. "W31 2026" or "Jul 2026". */
  label: string
  /** Sum of every value in byRepo. */
  total: number
  /** Repo id -> value. Repos with no activity in this bucket are absent. */
  byRepo: Record<string, number>
}
```

Empty buckets are emitted with `total: 0` and an empty `byRepo`, matching
`buildSeries`'s existing behaviour of showing a quiet stretch as quiet.

The day-stepping bucket-key walk currently inline in `buildSeries` is extracted
to a module-private helper (`bucketKeysBetween`) and used by both builders, so
the logic that keeps bucket enumeration correct across month lengths, leap
years, and ISO week-year boundaries exists in one place rather than two.

`buildRepoSeries` re-scans the dataset rather than being derived from
`buildSeries`. At 8842 commits the second pass is not worth the risk of
restructuring the gap-fill.

### `foldToTopRepos(points, limit): RepoStack`

New module `src/core/topRepos.ts`. One purpose: turn full per-repo detail into a
bounded, stackable set.

```ts
export interface RepoStack {
  /** Stack order, largest first. At most `limit` entries. */
  repos: string[]
  /** Whether an "Other" segment is present. */
  hasOther: boolean
  /** One row per bucket, flattened for Recharts stacking. */
  points: StackPoint[]
}

/** `{ key, label, total }` plus one numeric field per repo id, and "Other". */
export type StackPoint = { key: string; label: string; total: number } & Record<string, number>
```

Rules:

- Rank repos by their summed value **across the points passed in** — which are
  already windowed, so the ranking reflects the visible range.
- Keep the top `limit` (5). Sum every remaining repo into `Other`.
- Ties break on repo id ascending, so the ranking is deterministic.
- A repo absent from a given bucket is written as `0`, not omitted, so every
  stack row has the same fields.
- `hasOther` is false when the window holds `limit` or fewer repos — no empty
  grey segment, no dead legend entry.
- Empty input yields `{ repos: [], hasOther: false, points: [] }`.

`OTHER_KEY` is exported as a named constant. It is a reserved field name in
`StackPoint`; a repo id can never collide with it because every repo id contains
a `/` (enforced by `isRepoId` at ingest).

### Ordering

Build across all time → window → *then* rank:

```
buildRepoSeries(dataset)  ->  windowSeries(points, startKey)  ->  foldToTopRepos(windowed, 5)
```

Ranking after windowing is what makes the segments describe what is on screen.
`windowSeries` in `src/ui/range.ts` becomes generic over `{ key: string }` so it
serves `SeriesPoint` and `RepoPoint` alike; its behaviour is unchanged.

This runs inside the existing `view` memo in `App.tsx`, which passes `limit: 5`.
The memo builds a repo series for **the selected metric only** — unlike the two
total series, which are both built so the stat tiles can show commits and churn
together. Nothing on screen needs the other metric's split.

`windowStartKey` continues to be computed from the two total series, so the
chart and the stat tiles keep describing the same stretch of time regardless of
which mode the chart is in. The repo points are windowed against that same key.

## Palette

Slots 1–5 from the dataviz reference palette (`references/palette.md`), added to
`src/styles.css` beside the existing `--color-series-1`, which keeps its current
value and stays slot 1.

| Slot | Hue | Light | Dark |
|---|---|---|---|
| 1 | blue | `#2a78d6` | `#3987e5` |
| 2 | orange | `#eb6834` | `#d95926` |
| 3 | aqua | `#1baf7a` | `#199e70` |
| 4 | yellow | `#eda100` | `#c98500` |
| 5 | magenta | `#e87ba4` | `#d55181` |
| — | `Other` | `#9d9c8e` | `#6b6b63` |

Token names: `--color-series-1` … `--color-series-5`, `--color-series-other`.
As with the existing tokens, the dark column is *selected* for the dark surface,
not an automatic flip.

Validated with `scripts/validate_palette.js` on slots 1–5 in both modes — all
checks pass. Worst adjacent CVD ΔE 9.1 light / 8.4 dark (≥8 target); worst
adjacent normal-vision ΔE 19.6 light / 19.3 dark (≥15 floor).

`Other` is deliberately a neutral rather than a hue: it represents an absence of
identity and should read as recessive. It sits outside the categorical palette
and is not part of the validated set. Its two steps were chosen to be visible
against their surfaces without competing (2.70:1 light, 3.24:1 dark).

### The relief rule

Aqua, yellow and magenta fall below 3:1 against the light surface (2.74, 2.11,
2.62). The validator issues a contrast WARN, which is **not dismissable** — it
obligates visible labels or a table view.

This is discharged by two things, both of which are load-bearing rather than
polish:

- the legend, which pairs every swatch with its repo name, so identity never
  rests on colour alone; and
- the tooltip breakdown, which is a per-bucket table of repo and value.

Neither may be dropped from the implementation.

## UI

### Controls

`src/ui/Controls.tsx` gains a fourth `Segmented` control using the existing
component:

```
Breakdown:  [ Total ] [ By repo ]
```

State lives in `App.tsx` as `split: 'none' | 'repo'`, defaulting to `'none'`.
`SplitId` is declared alongside the other view types.

### Chart

`src/ui/ActivityChart.tsx` takes `split` and renders one of two shapes.

`split === 'none'` — unchanged from today, including the selective direct value
labels and their `labelledKeys` handling.

`split === 'repo'` — one `<Bar stackId="a">` per entry in `repos`, declared
largest-first so the largest sits at the bottom of the stack, then `Other` last
when `hasOther`. Per the mark specs: a 2px stroke in `--color-surface` on each
segment to give the required gap between stacked fills, and the `[4,4,0,0]`
radius only on the topmost declared bar.

Recharts stacks in declaration order from the bottom up, so declaring
largest-first puts the largest segment on the baseline. The rounded cap
therefore belongs to whichever bar is declared last — `Other` when `hasOther`,
otherwise the fifth repo. In a bucket where that particular series is zero the
cap is simply absent and the stack reads flat-topped. This is cosmetic and
accepted; the alternative is per-bucket `Cell` radius logic for a rounding
detail.

**Direct value labels are dropped in repo mode.** Recharts anchors a `LabelList`
to the bar it is declared on; on a stack the only sane anchor is the topmost
bar, which floats at the wrong height in any bucket where that repo has zero
activity. This is the same class of bug as the existing `labelledKeys` comment
in `ActivityChart.tsx` — Recharts label indices tracking rendered bars rather
than data. The tooltip carries the numbers instead. This is a deliberate trade:
it costs a screenshot some annotation, and the alternative is a label that is
sometimes wrong.

The empty state and its `hasOrgs` distinction are unchanged and apply to both
modes.

### Tooltip

In repo mode the tooltip becomes a small table via a custom `content` renderer:
one row per repo present in that bucket, value descending, `Other` always last,
then a rule and a total row. Repos with zero in the bucket are omitted from the
tooltip (unlike the stack data, where they are `0`). Values use `formatExact`,
matching the current tooltip. Chrome — radius, surface, hairline border, shadow
— matches the existing `contentStyle` so both modes look like one component.

In total mode the tooltip is unchanged.

### Legend

New `src/ui/ChartLegend.tsx`, rendered under the plot in repo mode only. A
swatch plus `owner/name`, in stack order. A single series needs no legend, so
total mode renders none.

Repo ids are shown in full. They are long, so the legend is a wrapping flex row
with the same type scale as the axis labels. Text wears `--color-ink-2`, never
the series colour.

No interaction — no click-to-isolate, no hover-to-highlight.

## Testing

New tests:

- `src/core/topRepos.test.ts` — ranking order; tie-break on repo id; the fold of
  a >5-repo window into top-5 + `Other`; `hasOther` false at exactly 5 and
  fewer; zero-filling of absent repos; empty input; an all-zero window.
- `src/core/aggregate.test.ts` (extended) — `buildRepoSeries` per-repo
  attribution for both metrics; org filtering; gap-filled buckets carrying
  `total: 0` and empty `byRepo`; agreement between `buildRepoSeries` totals and
  `buildSeries` values for the same options.
- `src/ui/range.test.ts` (extended) — `windowSeries` over `RepoPoint`.

The `buildSeries` agreement test is the one that protects the extraction of
`bucketKeysBetween`: if the shared helper changes behaviour, the two builders
disagree and it fails.

## Out of scope

- Stat tiles stay total-only. They describe the window, not the split.
- No per-repo filtering. Org checkboxes remain the only filter.
- No legend interaction.
- No texture or pattern fills for the CVD/print case. The legend and tooltip
  are the secondary encoding.
- `Other` is not expandable.
