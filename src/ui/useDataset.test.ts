import { describe, it, expect } from 'vitest'
import { parseDataset } from './useDataset'

describe('parseDataset', () => {
  it('accepts a well-formed dataset', () => {
    const ds = parseDataset({
      commits: [{ sha: 'a', repo: 'a/b', authoredAt: '2026-07-01T10:00:00.000+02:00' }],
      mergedPrs: [],
      meta: { syncedAt: '2026-07-31T00:00:00Z', rangeStart: '2026-01-01', rangeEnd: '2026-07-31' },
    })
    expect(ds.commits).toHaveLength(1)
  })

  it('rejects a payload missing commits with an actionable message', () => {
    expect(() => parseDataset({ mergedPrs: [] })).toThrow(/pnpm sync/i)
  })

  it('rejects a null payload', () => {
    expect(() => parseDataset(null)).toThrow(/pnpm sync/i)
  })
})
