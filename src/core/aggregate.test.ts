import { describe, it, expect } from 'vitest'
import { buildLinesSeries, buildRepoSeries, buildSeries } from './aggregate'
import type { Dataset } from './types'

const ds: Dataset = {
  commits: [
    { sha: 'a', repo: 'Huub-NL/finview', authoredAt: '2026-05-04T10:00:00.000+02:00' },
    { sha: 'b', repo: 'Huub-NL/finview', authoredAt: '2026-05-04T11:00:00.000+02:00' },
    { sha: 'c', repo: 'markhinch/zen', authoredAt: '2026-05-05T09:00:00.000+02:00' },
    // Three-month gap, then July.
    { sha: 'd', repo: 'Huub-NL/finview', authoredAt: '2026-08-03T09:00:00.000+02:00' },
  ],
  mergedPrs: [
    { repo: 'Huub-NL/finview', mergedAt: '2026-05-04T12:00:00Z', additions: 100, deletions: 20 },
    { repo: 'markhinch/zen', mergedAt: '2026-05-06T12:00:00Z', additions: 5, deletions: 1 },
  ],
  meta: { syncedAt: '2026-08-31T00:00:00Z', rangeStart: '2026-01-01', rangeEnd: '2026-08-31' },
}

const allOrgs = new Set(['Huub-NL', 'markhinch'])

describe('buildSeries — commits', () => {
  it('counts commits per month', () => {
    const s = buildSeries(ds, { bucket: 'month', metric: 'commits', orgs: allOrgs })
    expect(s.map((p) => [p.key, p.value])).toEqual([
      ['2026-05', 3],
      ['2026-06', 0],
      ['2026-07', 0],
      ['2026-08', 1],
    ])
  })

  it('fills empty buckets with zero rather than omitting them', () => {
    const s = buildSeries(ds, { bucket: 'month', metric: 'commits', orgs: allOrgs })
    expect(s.map((p) => p.key)).toContain('2026-06')
    expect(s.find((p) => p.key === '2026-06')?.value).toBe(0)
  })

  it('counts commits per ISO week', () => {
    const s = buildSeries(ds, { bucket: 'week', metric: 'commits', orgs: allOrgs })
    // 4 and 5 May 2026 are both in ISO week 19; 3 Aug 2026 is in week 32.
    expect(s[0]).toMatchObject({ key: '2026-W19', value: 3 })
    expect(s[s.length - 1]).toMatchObject({ key: '2026-W32', value: 1 })
    expect(s).toHaveLength(14)
  })

  it('excludes orgs that are not selected', () => {
    const s = buildSeries(ds, { bucket: 'month', metric: 'commits', orgs: new Set(['markhinch']) })
    expect(s.find((p) => p.key === '2026-05')?.value).toBe(1)
  })

  it('returns an empty series when no orgs are selected', () => {
    expect(buildSeries(ds, { bucket: 'month', metric: 'commits', orgs: new Set() })).toEqual([])
  })

  it('returns an empty series for an empty dataset', () => {
    const empty: Dataset = { ...ds, commits: [], mergedPrs: [] }
    expect(buildSeries(empty, { bucket: 'month', metric: 'commits', orgs: allOrgs })).toEqual([])
  })

  it('attaches a human label', () => {
    const s = buildSeries(ds, { bucket: 'month', metric: 'commits', orgs: allOrgs })
    expect(s[0]?.label).toBe('May 2026')
  })
})

describe('buildSeries — lines', () => {
  it('sums additions and deletions as churn', () => {
    const s = buildSeries(ds, { bucket: 'month', metric: 'lines', orgs: allOrgs })
    expect(s).toEqual([{ key: '2026-05', label: 'May 2026', value: 126 }])
  })

  it('respects org selection', () => {
    const s = buildSeries(ds, { bucket: 'month', metric: 'lines', orgs: new Set(['markhinch']) })
    expect(s).toEqual([{ key: '2026-05', label: 'May 2026', value: 6 }])
  })
})

describe('buildLinesSeries', () => {
  it('keeps additions and deletions separate while carrying their total', () => {
    const s = buildLinesSeries(ds, { bucket: 'month', orgs: allOrgs })
    expect(s).toEqual([
      {
        key: '2026-05',
        label: 'May 2026',
        additions: 105,
        deletions: 21,
        total: 126,
      },
    ])
  })

  it('filters organisations and gap-fills buckets', () => {
    const withGap: Dataset = {
      ...ds,
      mergedPrs: [
        ...ds.mergedPrs,
        { repo: 'markhinch/zen', mergedAt: '2026-07-06T12:00:00Z', additions: 3, deletions: 2 },
      ],
    }
    const s = buildLinesSeries(withGap, { bucket: 'month', orgs: new Set(['markhinch']) })
    expect(s.map((p) => [p.key, p.additions, p.deletions, p.total])).toEqual([
      ['2026-05', 5, 1, 6],
      ['2026-06', 0, 0, 0],
      ['2026-07', 3, 2, 5],
    ])
  })

  it('returns an empty series when no organisation is selected', () => {
    expect(buildLinesSeries(ds, { bucket: 'month', orgs: new Set() })).toEqual([])
  })

  it.each(['week', 'month'] as const)('totals match Lines changed for the %s bucket', (bucket) => {
    const split = buildLinesSeries(ds, { bucket, orgs: allOrgs })
    const total = buildSeries(ds, { bucket, metric: 'lines', orgs: allOrgs })
    expect(split.map((p) => [p.key, p.total])).toEqual(total.map((p) => [p.key, p.value]))
  })
})

describe('buildRepoSeries', () => {
  it('splits each bucket by repo', () => {
    const s = buildRepoSeries(ds, { bucket: 'month', metric: 'commits', orgs: allOrgs })
    expect(s.find((p) => p.key === '2026-05')?.byRepo).toEqual({
      'Huub-NL/finview': 2,
      'markhinch/zen': 1,
    })
  })

  it('carries a total alongside the split', () => {
    const s = buildRepoSeries(ds, { bucket: 'month', metric: 'commits', orgs: allOrgs })
    expect(s.find((p) => p.key === '2026-05')?.total).toBe(3)
  })

  it('splits line churn by repo', () => {
    const s = buildRepoSeries(ds, { bucket: 'month', metric: 'lines', orgs: allOrgs })
    expect(s.find((p) => p.key === '2026-05')?.byRepo).toEqual({
      'Huub-NL/finview': 120,
      'markhinch/zen': 6,
    })
  })

  it('gives empty buckets a zero total and no repos', () => {
    const s = buildRepoSeries(ds, { bucket: 'month', metric: 'commits', orgs: allOrgs })
    const june = s.find((p) => p.key === '2026-06')
    expect(june?.total).toBe(0)
    expect(june?.byRepo).toEqual({})
  })

  it('excludes repos whose org is deselected', () => {
    const s = buildRepoSeries(ds, {
      bucket: 'month', metric: 'commits', orgs: new Set(['Huub-NL']),
    })
    expect(s.find((p) => p.key === '2026-05')?.byRepo).toEqual({ 'Huub-NL/finview': 2 })
  })

  it('returns nothing when no org is selected', () => {
    expect(buildRepoSeries(ds, { bucket: 'month', metric: 'commits', orgs: new Set() })).toEqual([])
  })

  // Guards the bucketKeysBetween extraction: if the shared walk changes
  // behaviour, the two builders stop agreeing.
  it.each(['commits', 'lines'] as const)('totals agree with buildSeries for %s', (metric) => {
    for (const bucket of ['week', 'month'] as const) {
      const flat = buildSeries(ds, { bucket, metric, orgs: allOrgs })
      const split = buildRepoSeries(ds, { bucket, metric, orgs: allOrgs })
      expect(split.map((p) => [p.key, p.total])).toEqual(flat.map((p) => [p.key, p.value]))
    }
  })
})
