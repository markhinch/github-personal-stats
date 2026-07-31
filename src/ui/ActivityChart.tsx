import { useEffect, useState } from 'react'
import {
  Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import type { Metric, SeriesPoint } from '../core/types'

const compact = new Intl.NumberFormat('en-GB', { notation: 'compact' })
const full = new Intl.NumberFormat('en-GB')

// dataviz skill palette (references/palette.md): categorical slot 1 (blue), the
// hairline gridline/axis tokens, and the chart surface — swapped per color-scheme
// since Recharts takes literal color props rather than CSS custom properties.
const PALETTE = {
  light: { mark: '#2a78d6', grid: '#e1e0d9', axis: '#898781', surface: '#fcfcfb', border: 'rgba(11,11,11,0.10)' },
  dark: { mark: '#3987e5', grid: '#2c2c2a', axis: '#898781', surface: '#1a1a19', border: 'rgba(255,255,255,0.10)' },
} as const

function usePrefersDark(): boolean {
  const [dark, setDark] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches,
  )
  useEffect(() => {
    const mql = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = (e: MediaQueryListEvent): void => setDark(e.matches)
    mql.addEventListener('change', onChange)
    return () => mql.removeEventListener('change', onChange)
  }, [])
  return dark
}

export function ActivityChart({ series, metric }: { series: SeriesPoint[]; metric: Metric }) {
  const colors = usePrefersDark() ? PALETTE.dark : PALETTE.light

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
          <CartesianGrid vertical={false} stroke={colors.grid} />
          <XAxis
            dataKey="label"
            tick={{ fontSize: 11, fill: colors.axis }}
            stroke={colors.grid}
            interval="preserveStartEnd"
            minTickGap={24}
          />
          <YAxis
            tick={{ fontSize: 11, fill: colors.axis }}
            stroke={colors.grid}
            tickFormatter={(v: number) => compact.format(v)}
            width={44}
          />
          <Tooltip
            formatter={(v) => [full.format(Number(v)), name]}
            contentStyle={{
              fontSize: 12,
              borderRadius: 8,
              background: colors.surface,
              border: `1px solid ${colors.border}`,
            }}
          />
          <Bar dataKey="value" name={name} fill={colors.mark} radius={[4, 4, 0, 0]} maxBarSize={24} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
