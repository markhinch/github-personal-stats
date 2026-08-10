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
