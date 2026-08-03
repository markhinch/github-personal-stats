export interface Tile {
  label: string
  value: string
  caption: string
}

interface Props {
  /**
   * The one number the view leads with — big, and exactly one per view, so the
   * eye has a single entry point. The rest are supporting tiles.
   */
  hero: Tile
  tiles: readonly Tile[]
}

const CARD = 'rounded-2xl border border-hairline bg-surface px-5 py-4'
const LABEL = 'text-[11px] font-medium uppercase tracking-[0.08em] text-muted'

export function StatTiles({ hero, tiles }: Props) {
  return (
    <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <div className={CARD}>
        <p className={LABEL}>{hero.label}</p>
        {/* Proportional figures: tabular-nums looks loose at display sizes. */}
        <p className="mt-1.5 text-[44px] font-semibold leading-none tracking-tight">{hero.value}</p>
        <p className="mt-2 text-xs text-ink-2">{hero.caption}</p>
      </div>

      {tiles.map((t) => (
        <div key={t.label} className={CARD}>
          <p className={LABEL}>{t.label}</p>
          <p className="mt-1.5 text-2xl font-semibold leading-tight tracking-tight">{t.value}</p>
          <p className="mt-2 text-xs text-ink-2">{t.caption}</p>
        </div>
      ))}
    </section>
  )
}
