import {
  Bar, BarChart, CartesianGrid, Cell, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import type { LabelListEntry } from 'recharts'
import type { Bucket, LinesPoint, Metric, SeriesPoint } from '../core/types'
import { breakdownRows, stackSegments, type RepoStack, type StackPoint } from '../core/topRepos'
import { formatCompact, formatExact, formatMetricLabel } from './format'
import { labelledIndices } from './labels'
import { segmentColors } from './palette'
import { ChartLegend } from './ChartLegend'

/**
 * Shared tooltip chrome for every chart mode: the total mode hands this to
 * Recharts' `contentStyle`, the breakdown modes spread it onto their custom
 * tooltip element. One const so the two never drift apart the way two
 * hand-copied literals would.
 */
const TOOLTIP_SURFACE = {
  fontSize: 12,
  borderRadius: 10,
  background: 'var(--color-surface)',
  border: '1px solid var(--color-hairline)',
  boxShadow: '0 4px 12px rgba(11,11,11,0.08)',
} as const

/** A colour-preserving diagonal hatch used only for the unfinished final bar. */
function ProgressPattern(props: { id: string; color: string }) {
  return (
    <pattern id={props.id} width="8" height="8" patternUnits="userSpaceOnUse">
      <rect width="8" height="8" fill={props.color} />
      <path
        d="M-2 2L2-2M0 8L8 0M6 10L10 6"
        fill="none"
        stroke="var(--color-ink)"
        strokeOpacity={0.24}
        strokeWidth={1.5}
      />
    </pattern>
  )
}

const progressLabel = (label: string, finalLabel: string | undefined, inProgress: boolean): string =>
  inProgress && label === finalLabel ? `${label} · so far` : label

/**
 * The per-bucket breakdown table. Alongside the legend, this is the relief the
 * palette's light-mode contrast warning obliges — the numbers are readable
 * without resolving a colour.
 */
function BreakdownTooltip(props: {
  active?: boolean
  payload?: ReadonlyArray<{ payload?: StackPoint }>
  colors: Record<string, string>
  inProgressKey?: string
}) {
  const point = props.payload?.[0]?.payload
  if (props.active !== true || point === undefined) return null

  const rows = breakdownRows(point.values)

  return (
    <div style={TOOLTIP_SURFACE} className="px-3 py-2">
      <p className="font-semibold text-ink">
        {point.label}
        {point.key === props.inProgressKey && (
          <span className="font-normal text-muted"> · In progress</span>
        )}
      </p>
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

interface Props {
  series: SeriesPoint[]
  metric: Metric
  bucket: Bucket
  /**
   * Whether the dataset has any orgs at all. Distinguishes "you deselected
   * everything" (actionable: select one) from "there is nothing to select"
   * (a well-formed but empty dataset — no commits or merged PRs yet) so the
   * empty state never tells the user to do something the checkbox list
   * doesn't let them do.
   */
  hasOrgs: boolean
  /**
   * The per-repo split to draw, or null for a single-hue total bar. Ranked and
   * bounded upstream — this component only draws what it is handed.
   */
  stack: RepoStack | null
  /** Additions/deletions for the Lines breakdown, or null for another mode. */
  lineBreakdown: LinesPoint[] | null
}

export function ActivityChart({ series, metric, bucket, hasOrgs, stack, lineBreakdown }: Props) {
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

  const showProgress = bucket !== 'day'

  if (lineBreakdown !== null) {
    const segments = ['Lines added', 'Lines removed']
    const colors = {
      'Lines added': 'var(--color-lines-added)',
      'Lines removed': 'var(--color-lines-removed)',
    }
    const points: StackPoint[] = lineBreakdown.map((point) => ({
      key: point.key,
      label: point.label,
      total: point.total,
      values: {
        'Lines added': point.additions,
        'Lines removed': point.deletions,
      },
    }))
    return (
      <StackedChart
        points={points}
        segments={segments}
        colors={colors}
        showProgress={showProgress}
      />
    )
  }

  if (stack !== null) {
    const segments = stackSegments(stack)
    return (
      <StackedChart
        points={stack.points}
        segments={segments}
        colors={segmentColors(stack.repos, stack.hasOther)}
        showProgress={showProgress}
      />
    )
  }

  const name = metric === 'commits' ? 'Commits' : 'Lines changed'
  const finalLabel = series.at(-1)?.label
  const progressPatternId = 'activity-progress-total'

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
          {showProgress && (
            <defs>
              <ProgressPattern id={progressPatternId} color="var(--color-series-1)" />
            </defs>
          )}
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
            tickFormatter={(label: string) => progressLabel(label, finalLabel, showProgress)}
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
            labelFormatter={(label) => progressLabel(String(label), finalLabel, showProgress)}
            contentStyle={TOOLTIP_SURFACE}
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
            {series.map((point, index) => (
              <Cell
                key={point.key}
                fill={
                  showProgress && index === series.length - 1
                    ? `url(#${progressPatternId})`
                    : 'var(--color-series-1)'
                }
              />
            ))}
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

function StackedChart(props: {
  points: StackPoint[]
  segments: string[]
  colors: Record<string, string>
  showProgress: boolean
}) {
  const finalPoint = props.points.at(-1)

  return (
    <>
      <div className="h-80 w-full">
        <ResponsiveContainer>
          {/*
            No top margin for value labels: a stack has no single bar to anchor
            them to, so the breakdown lives in the tooltip instead.
          */}
          <BarChart data={props.points} margin={{ top: 8, right: 22, bottom: 0, left: 0 }}>
            {props.showProgress && (
              <defs>
                {props.segments.map((segment, index) => (
                  <ProgressPattern
                    key={segment}
                    id={`activity-progress-stack-${index}`}
                    color={props.colors[segment]!}
                  />
                ))}
              </defs>
            )}
            <CartesianGrid vertical={false} stroke="var(--color-grid)" />
            <XAxis
              dataKey="label"
              tick={{ fontSize: 11, fill: 'var(--color-muted)' }}
              stroke="var(--color-baseline)"
              tickLine={false}
              tickMargin={8}
              interval="preserveStartEnd"
              minTickGap={12}
              tickFormatter={(label: string) =>
                progressLabel(label, finalPoint?.label, props.showProgress)
              }
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
              content={
                <BreakdownTooltip
                  colors={props.colors}
                  inProgressKey={props.showProgress ? finalPoint?.key : undefined}
                />
              }
            />
            {/*
              Recharts stacks segments from the baseline in declaration order.
              The rounded cap belongs to the final segment; when that segment is
              zero, the visible stack is intentionally flat-topped.

              A function dataKey, not a dotted path: repo names may contain dots,
              which Recharts would read as nesting.
            */}
            {props.segments.map((segment, i) => (
              <Bar
                key={segment}
                dataKey={(p: StackPoint) => p.values[segment] ?? 0}
                name={segment}
                stackId="a"
                fill={props.colors[segment]}
                // A 2px surface gap between fills, per the mark specs.
                stroke="var(--color-surface)"
                strokeWidth={2}
                radius={i === props.segments.length - 1 ? [4, 4, 0, 0] : undefined}
                maxBarSize={24}
                isAnimationActive={false}
              >
                {props.points.map((point, pointIndex) => (
                  <Cell
                    key={point.key}
                    fill={
                      props.showProgress && pointIndex === props.points.length - 1
                        ? `url(#activity-progress-stack-${i})`
                        : props.colors[segment]
                    }
                  />
                ))}
              </Bar>
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
      <ChartLegend segments={props.segments} colors={props.colors} />
    </>
  )
}
