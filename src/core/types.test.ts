import { describe, it, expect } from 'vitest'
import type { Dataset } from './types'

describe('test harness', () => {
  it('constructs an empty dataset', () => {
    const ds: Dataset = {
      commits: [],
      mergedPrs: [],
      meta: { syncedAt: '2026-07-31T00:00:00Z', rangeStart: '2010-12-07', rangeEnd: '2026-07-31' },
    }
    expect(ds.commits).toHaveLength(0)
  })
})
