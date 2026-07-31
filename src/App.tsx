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
