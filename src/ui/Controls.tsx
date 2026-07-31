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
