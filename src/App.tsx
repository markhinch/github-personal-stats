import { useMemo, useState } from 'react'
import { buildSeries } from './core/aggregate'
import { listOrgs } from './core/orgs'
import type { Bucket, Metric, SeriesPoint } from './core/types'
import { ActivityChart } from './ui/ActivityChart'
import { Controls } from './ui/Controls'
import { StatTiles, type Tile } from './ui/StatTiles'
import { formatExact, formatMetric, metricNoun } from './ui/format'
import { bucketsInRange, windowSeries, windowStartKey, type RangeId } from './ui/range'
import { useDataset } from './ui/useDataset'

const syncedOn = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric', month: 'short', year: 'numeric',
})

const sum = (s: readonly SeriesPoint[]): number => s.reduce((total, p) => total + p.value, 0)

const peakOf = (s: readonly SeriesPoint[]): SeriesPoint | null =>
  s.reduce<SeriesPoint | null>((best, p) => (best === null || p.value > best.value ? p : best), null)

export default function App() {
  const state = useDataset()
  const [bucket, setBucket] = useState<Bucket>('month')
  const [metric, setMetric] = useState<Metric>('commits')
  const [range, setRange] = useState<RangeId>('1y')
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

  // Both metrics are built and windowed together: the tiles show commits *and*
  // churn whichever one the chart is plotting, and sharing one window keeps
  // every number on screen describing the same stretch of time.
  const view = useMemo(() => {
    if (state.status !== 'ready') return null
    const commits = buildSeries(state.dataset, { bucket, metric: 'commits', orgs: selectedOrgs })
    const lines = buildSeries(state.dataset, { bucket, metric: 'lines', orgs: selectedOrgs })
    const start = windowStartKey([commits, lines], bucketsInRange(range, bucket))
    return { commits: windowSeries(commits, start), lines: windowSeries(lines, start) }
  }, [state, bucket, range, selectedOrgs])

  const series = view === null ? [] : view[metric === 'commits' ? 'commits' : 'lines']

  const stats = useMemo(() => {
    if (view === null || series.length === 0) return null
    const peak = peakOf(series)
    const span = [series[0]?.label, series[series.length - 1]?.label]
    return {
      commits: sum(view.commits),
      lines: sum(view.lines),
      peak,
      average: sum(series) / series.length,
      span: span[0] === span[1] ? String(span[0]) : `${span[0]} – ${span[1]}`,
      buckets: series.length,
    }
  }, [view, series])

  const toggleOrg = (org: string): void => {
    setDeselected((prev) => {
      const next = new Set(prev)
      if (next.has(org)) next.delete(org)
      else next.add(org)
      return next
    })
  }

  const noun = metricNoun(metric)
  const bucketWord = bucket === 'week' ? 'week' : 'month'

  const hero: Tile | null =
    stats === null
      ? null
      : {
          label: metric === 'commits' ? 'Commits' : 'Lines changed',
          value: formatMetric(metric, metric === 'commits' ? stats.commits : stats.lines),
          caption: `${stats.span} · ${stats.buckets} ${bucketWord}s`,
        }

  const tiles: Tile[] =
    stats === null
      ? []
      : [
          metric === 'commits'
            ? {
                label: 'Lines changed',
                value: formatMetric('lines', stats.lines),
                caption: 'Additions + deletions, merged PRs',
              }
            : {
                label: 'Commits',
                value: formatExact(stats.commits),
                caption: 'Distinct commits, deduped by SHA',
              },
          {
            label: `Busiest ${bucketWord}`,
            value: stats.peak?.label ?? '—',
            caption: `${formatMetric(metric, stats.peak?.value ?? 0)} ${noun}`,
          },
          {
            label: `Per ${bucketWord}, average`,
            value: formatMetric(metric, stats.average),
            caption: `${noun} per ${bucketWord}`,
          },
        ]

  return (
    <main className="mx-auto max-w-5xl px-6 py-10 sm:py-14">
      <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
        <div>
          <h1 className="text-[26px] font-semibold tracking-tight">GitHub activity</h1>
          <p className="mt-1 text-sm text-ink-2">
            Commits and merged-pull-request churn across every repository I work in, public
            and private.
          </p>
        </div>
        {state.status === 'ready' && state.dataset.meta.syncedAt && (
          <p className="text-xs text-muted">
            Synced {syncedOn.format(new Date(state.dataset.meta.syncedAt))}
          </p>
        )}
      </header>

      {state.status === 'loading' && (
        <p className="mt-10 text-sm text-muted">Loading…</p>
      )}

      {state.status === 'error' && (
        <p className="mt-10 rounded-xl border border-amber-400 bg-amber-50 p-4 text-sm text-ink dark:bg-amber-950/30">
          {state.message}
        </p>
      )}

      {state.status === 'ready' && (
        <>
          {hero !== null && (
            <div className="mt-8">
              <StatTiles hero={hero} tiles={tiles} />
            </div>
          )}

          <div className="mt-8 rounded-2xl border border-hairline bg-surface p-5 sm:p-6">
            <Controls
              bucket={bucket}
              metric={metric}
              range={range}
              orgs={orgs}
              selectedOrgs={selectedOrgs}
              onBucket={setBucket}
              onMetric={setMetric}
              onRange={setRange}
              onToggleOrg={toggleOrg}
            />

            <div className="mt-6 border-t border-hairline pt-5">
              <h2 className="text-sm font-semibold">
                {metric === 'commits' ? 'Commits' : 'Lines changed'} per {bucketWord}
              </h2>
              <p className="mt-0.5 text-xs text-muted">{stats?.span ?? 'No data in range'}</p>

              <div className="mt-4">
                <ActivityChart series={series} metric={metric} hasOrgs={orgs.length > 0} />
              </div>
            </div>

            {metric === 'lines' && (
              <p className="mt-4 max-w-2xl border-t border-hairline pt-4 text-xs text-ink-2">
                Lines changed is additions + deletions from merged pull requests, credited to
                the merge date — so a PR merged this month may contain earlier work. Commit
                counts are exact; this metric is an approximation.
              </p>
            )}
          </div>
        </>
      )}
    </main>
  )
}
