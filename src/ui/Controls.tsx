import type { Bucket, Metric } from '../core/types'

// dataviz skill palette (references/palette.md) — the same blue family
// ActivityChart uses for the bars, so the toggles/checkboxes read as one
// system rather than a stock Tailwind blue beside a validated chart blue.
//
// The active-segment fill uses the *sequential* blue ramp's step 500
// (#256abf), not the categorical mark hex (#2a78d6/#3987e5) the bars use:
// white text on the mark hex measures 4.42:1 (light) / 3.64:1 (dark) against
// WCAG's 4.5:1 text-contrast floor — the mark was only validated for
// mark-vs-chart-surface contrast (>=3:1), not for carrying white UI-label
// text. Step 500 is the same hue, one step darker, at 5.39:1 in both modes.
// The checkbox accent uses the mark hex directly — a small tick mark, not
// text, so it can match the bars exactly.
const ACTIVE_SEGMENT_BG = 'bg-[#256abf]'
const CHECKBOX_ACCENT = 'accent-[#2a78d6] dark:accent-[#3987e5]'

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
              ? `${ACTIVE_SEGMENT_BG} font-semibold text-white`
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
      <div className="flex flex-col gap-1">
        <Segmented<Metric>
          value={p.metric}
          onChange={p.onMetric}
          options={[
            { value: 'commits', label: 'Commits' },
            { value: 'lines', label: 'Lines changed' },
          ]}
        />
        {p.metric === 'lines' && (
          <p className="max-w-xs text-xs text-neutral-500 dark:text-neutral-400">
            Lines changed is additions + deletions from merged pull requests, credited to
            the merge date — so a PR merged this month may contain earlier work. Commit
            counts are exact; this metric is an approximation.
          </p>
        )}
      </div>
      <fieldset className="flex flex-wrap items-center gap-3">
        <legend className="sr-only">Organisations</legend>
        {p.orgs.map((org) => (
          <label key={org} className="flex cursor-pointer items-center gap-1.5 text-sm">
            <input
              type="checkbox"
              checked={p.selectedOrgs.has(org)}
              onChange={() => p.onToggleOrg(org)}
              className={`size-4 ${CHECKBOX_ACCENT}`}
            />
            {org}
          </label>
        ))}
      </fieldset>
    </div>
  )
}
