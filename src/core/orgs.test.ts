import { describe, it, expect } from 'vitest'
import { orgOf, listOrgs } from './orgs'
import type { Dataset } from './types'

describe('orgOf', () => {
  it('extracts the owner segment', () => {
    expect(orgOf('Huub-NL/finview')).toBe('Huub-NL')
    expect(orgOf('markhinch/zen_fatale')).toBe('markhinch')
  })

  it('rejects a malformed identifier rather than guessing', () => {
    expect(() => orgOf('finview')).toThrow(/malformed/i)
    expect(() => orgOf('/finview')).toThrow(/malformed/i)
  })
})

describe('listOrgs', () => {
  const ds: Dataset = {
    commits: [
      { sha: 'a', repo: 'Huub-NL/finview', authoredAt: '2026-07-01T10:00:00.000+02:00' },
      { sha: 'b', repo: 'Huub-NL/huub', authoredAt: '2026-07-01T11:00:00.000+02:00' },
      { sha: 'c', repo: 'markhinch/zen_fatale', authoredAt: '2026-07-02T11:00:00.000+02:00' },
    ],
    mergedPrs: [
      { repo: 'modem-works/site', mergedAt: '2026-07-03T09:00:00Z', additions: 10, deletions: 2 },
    ],
    meta: { syncedAt: '2026-07-31T00:00:00Z', rangeStart: '2026-01-01', rangeEnd: '2026-07-31' },
  }

  it('returns unique orgs from both commits and PRs, sorted case-insensitively', () => {
    expect(listOrgs(ds)).toEqual(['Huub-NL', 'markhinch', 'modem-works'])
  })

  it('returns an empty array for an empty dataset', () => {
    expect(listOrgs({ ...ds, commits: [], mergedPrs: [] })).toEqual([])
  })
})
