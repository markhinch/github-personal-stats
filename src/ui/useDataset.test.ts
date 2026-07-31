import { describe, it, expect } from 'vitest'
import { datasetErrorMessage, parseDataset } from './useDataset'

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

describe('datasetErrorMessage', () => {
  // Regression coverage for the bug found during manual verification: renaming
  // away public/data.json made a dev server's SPA fallback return index.html
  // with a 200, so `r.ok` was true and only the JSON parse blew up — the
  // original catch handler let that raw SyntaxError ("Unexpected token '<'...")
  // reach the user instead of the actionable message. useDataset.ts now
  // classifies every failure into a DatasetLoadFailure *before* this function
  // ever sees it, so there is no path left that can hand it raw error text.

  it('names pnpm sync for a network-level failure (fetch itself rejected)', () => {
    expect(datasetErrorMessage({ kind: 'network' })).toMatch(/pnpm sync/i)
  })

  it('names pnpm sync for a non-200 response', () => {
    expect(datasetErrorMessage({ kind: 'http', status: 404 })).toMatch(/pnpm sync/i)
  })

  it('names pnpm sync for a 200 response that is not valid JSON (e.g. a dev-server SPA fallback serving index.html)', () => {
    expect(datasetErrorMessage({ kind: 'parse' })).toMatch(/pnpm sync/i)
  })

  it('names pnpm sync for well-formed JSON that is the wrong shape', () => {
    expect(datasetErrorMessage({ kind: 'schema' })).toMatch(/pnpm sync/i)
  })
})
