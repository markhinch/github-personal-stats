import type { ReactNode } from 'react'
import type { Bucket, Metric, Split } from '../core/types'
import { RANGE_OPTIONS, supportsDayBucket, type RangeId } from './range'

const BUCKET_OPTIONS: ReadonlyArray<{ value: Bucket; label: string }> = [
  { value: 'week', label: 'Week' },
  { value: 'month', label: 'Month' },
]
const DAY_OPTION = { value: 'day' as const, label: 'Day' }

interface Props {
  bucket: Bucket
  metric: Metric
  range: RangeId
  split: Split
  orgs: string[]
  selectedOrgs: Set<string>
  onBucket: (b: Bucket) => void
  onMetric: (m: Metric) => void
  onRange: (r: RangeId) => void
  onSplit: (s: Split) => void
  onToggleOrg: (org: string) => void
}

const FIELD_LABEL = 'text-[11px] font-medium uppercase tracking-[0.08em] text-muted'

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className={FIELD_LABEL}>{label}</span>
      {children}
    </div>
  )
}

function Segmented<T extends string>(props: {
  value: T
  options: ReadonlyArray<{ value: T; label: string }>
  onChange: (v: T) => void
}) {
  return (
    <div className="inline-flex rounded-lg border border-hairline bg-surface p-0.5">
      {props.options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => props.onChange(o.value)}
          aria-pressed={props.value === o.value}
          className={
            'rounded-[6px] px-3 py-1.5 text-sm transition-colors ' +
            (props.value === o.value
              ? 'bg-accent font-semibold text-white'
              : 'text-ink-2 hover:bg-grid/50 hover:text-ink')
          }
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

function OrgChip(props: { org: string; checked: boolean; onToggle: () => void }) {
  return (
    <label className="cursor-pointer">
      <input
        type="checkbox"
        checked={props.checked}
        onChange={props.onToggle}
        className="peer sr-only"
      />
      <span
        className={
          'flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm transition-colors ' +
          'peer-focus-visible:ring-2 peer-focus-visible:ring-accent peer-focus-visible:ring-offset-2 ' +
          'peer-focus-visible:ring-offset-plane ' +
          (props.checked
            ? 'border-transparent bg-accent-wash font-medium text-ink'
            : 'border-hairline bg-surface text-muted hover:text-ink-2')
        }
      >
        <span
          aria-hidden
          className={
            'size-2 rounded-full ' + (props.checked ? 'bg-series-1' : 'bg-baseline')
          }
        />
        {props.org}
      </span>
    </label>
  )
}

export function Controls(p: Props) {
  return (
    <div className="flex flex-wrap items-end gap-x-8 gap-y-4">
      <Field label="Metric">
        <Segmented<Metric>
          value={p.metric}
          onChange={p.onMetric}
          options={[
            { value: 'commits', label: 'Commits' },
            { value: 'lines', label: 'Lines changed' },
          ]}
        />
      </Field>

      <Field label="Bucket">
        <Segmented<Bucket>
          value={p.bucket}
          onChange={p.onBucket}
          options={supportsDayBucket(p.range) ? [DAY_OPTION, ...BUCKET_OPTIONS] : BUCKET_OPTIONS}
        />
      </Field>

      <Field label="Breakdown">
        <Segmented<Split>
          value={p.split}
          onChange={p.onSplit}
          options={[
            { value: 'none', label: 'Total' },
            { value: 'repo', label: 'By repo' },
            ...(p.metric === 'lines' ? [{ value: 'lines' as const, label: 'Lines' }] : []),
          ]}
        />
      </Field>

      <Field label="Range">
        <Segmented<RangeId> value={p.range} onChange={p.onRange} options={RANGE_OPTIONS} />
      </Field>

      {p.orgs.length > 0 && (
        // The visible group heading *is* the legend, so it isn't announced twice.
        <fieldset className="flex flex-col gap-1.5">
          <legend className={FIELD_LABEL}>Organisations</legend>
          <div className="flex flex-wrap items-center gap-2">
            {p.orgs.map((org) => (
              <OrgChip
                key={org}
                org={org}
                checked={p.selectedOrgs.has(org)}
                onToggle={() => p.onToggleOrg(org)}
              />
            ))}
          </div>
        </fieldset>
      )}
    </div>
  )
}
