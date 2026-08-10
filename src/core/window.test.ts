import { describe, it, expect } from 'vitest'
import type { RepoPoint } from './aggregate'
import type { SeriesPoint } from './types'
import { windowSeries } from './window'

const months = (keys: string[]): SeriesPoint[] =>
  keys.map((key) => ({ key, label: key, value: 1 }))

describe('windowSeries', () => {
  it('keeps buckets at or after the start key', () => {
    const s = months(['2026-01', '2026-02', '2026-03'])
    expect(windowSeries(s, '2026-02').map((p) => p.key)).toEqual(['2026-02', '2026-03'])
  })

  it('keeps everything for a null start key', () => {
    const s = months(['2026-01', '2026-02'])
    expect(windowSeries(s, null)).toEqual(s)
  })

  it('windows week keys chronologically too', () => {
    const s = months(['2026-W08', '2026-W09', '2026-W10'])
    expect(windowSeries(s, '2026-W09').map((p) => p.key)).toEqual(['2026-W09', '2026-W10'])
  })
})

describe('windowSeries — repo points', () => {
  const repoPoints = (keys: string[]): RepoPoint[] =>
    keys.map((key) => ({ key, label: key, total: 1, byRepo: { 'o/x': 1 } }))

  it('windows a per-repo series on the same key comparison', () => {
    const s = repoPoints(['2026-01', '2026-02', '2026-03'])
    expect(windowSeries(s, '2026-02').map((p) => p.key)).toEqual(['2026-02', '2026-03'])
  })

  it('preserves the per-repo split through the window', () => {
    const s = repoPoints(['2026-01', '2026-02'])
    expect(windowSeries(s, '2026-02')[0]?.byRepo).toEqual({ 'o/x': 1 })
  })
})
