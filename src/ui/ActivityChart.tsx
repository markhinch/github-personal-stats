import {
  Bar, BarChart, CartesianGrid, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import type { LabelListEntry } from 'recharts'
import type { Metric, SeriesPoint } from '../core/types'
import { formatCompact, formatExact, formatMetricLabel } from './format'
import { labelledIndices } from './labels'

interface Props {
  series: SeriesPoint[]
  metric: Metric
  /**
   * Whether the dataset has any orgs at all. Distinguishes "you deselected
   * everything" (actionable: select one) from "there is nothing to select"
   * (a well-formed but empty dataset — no commits or merged PRs yet) so the
   * empty state never tells the user to do something the checkbox list
   * doesn't let them do.
   */
  hasOrgs: boolean
}

export function ActivityChart({ series, metric, hasOrgs }: Props) {
  if (series.length === 0) {
    const message = hasOrgs
      ? 'Nothing to show — select at least one organisation.'
      : 'Nothing to show — this dataset has no commits or merged pull requests yet. Run `pnpm sync` to refresh it.'
    return (
      <div className="flex h-80 items-center justify-center rounded-xl border border-dashed border-baseline px-6 text-center text-sm text-muted">
        {message}
      </div>
    )
  }

  const name = metric === 'commits' ? 'Commits' : 'Lines changed'

  // Keyed by bucket, not by position: Recharts omits zero-height bars from the
  // label list, so its label index counts *rendered bars* and drifts from the
  // data index as soon as the series contains an empty bucket.
  const labelledKeys = new Set(
    [...labelledIndices(series.map((p) => p.value))].map((i) => series[i]!.key),
  )

  const valueLabel = (entry: LabelListEntry): string => {
    const point = entry.payload as SeriesPoint | undefined
    if (point === undefined || !labelledKeys.has(point.key)) return ''
    return formatMetricLabel(metric, point.value)
  }

  return (
    <div className="h-80 w-full">
      <ResponsiveContainer>
        {/*
          The top margin clears the value label above the tallest bar; the right
          margin keeps the last bar's label from being clipped by the plot edge.
        */}
        <BarChart data={series} margin={{ top: 24, right: 22, bottom: 0, left: 0 }}>
          <CartesianGrid vertical={false} stroke="var(--color-grid)" />
          <XAxis
            dataKey="label"
            tick={{ fontSize: 11, fill: 'var(--color-muted)' }}
            stroke="var(--color-baseline)"
            tickLine={false}
            tickMargin={8}
            interval="preserveStartEnd"
            // Small enough that a 12-month view labels every month; wide views
            // still thin their ticks, since the labels simply cannot all fit.
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
            formatter={(v) => [formatExact(Number(v)), name]}
            contentStyle={{
              fontSize: 12,
              borderRadius: 10,
              background: 'var(--color-surface)',
              border: '1px solid var(--color-hairline)',
              boxShadow: '0 4px 12px rgba(11,11,11,0.08)',
            }}
            labelStyle={{ color: 'var(--color-ink)', fontWeight: 600 }}
          />
          {/*
            No entry animation: the value labels don't animate with the bars, so
            they hang in mid-air over growing bars, and a chart that exists to be
            screenshotted should be final the moment it paints.
          */}
          <Bar
            dataKey="value"
            name={name}
            fill="var(--color-series-1)"
            radius={[4, 4, 0, 0]}
            maxBarSize={24}
            isAnimationActive={false}
          >
            {/* Text wears an ink token, never the mark's blue. */}
            <LabelList
              valueAccessor={valueLabel}
              position="top"
              offset={8}
              fill="var(--color-ink-2)"
              fontSize={11}
              fontWeight={600}
            />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
