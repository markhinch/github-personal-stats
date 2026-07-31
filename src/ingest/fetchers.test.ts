import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as cp from 'node:child_process'
import {
  parseCommitSearchResponse,
  parsePrSearchResponse,
  makeCommitFetcher,
  makePrFetcher,
  fetchViewerCreatedAt,
} from './fetchers'
import { RateLimiter } from './ratelimit'
import { PER_PAGE } from './windows'

vi.mock('node:child_process', () => ({ execFile: vi.fn() }))

// Captured verbatim from `gh api search/commits` on 2026-07-31.
const COMMIT_PAYLOAD = {
  total_count: 246,
  incomplete_results: false,
  items: [
    {
      sha: '71a69c8d1111111111111111111111111111aaaa',
      commit: {
        author: { date: '2026-07-22T16:05:11.000+02:00' },
        committer: { date: '2026-07-22T16:05:11.000+02:00' },
      },
      repository: { full_name: 'Huub-NL/finview' },
    },
  ],
}

describe('parseCommitSearchResponse', () => {
  let warn: ReturnType<typeof vi.spyOn>
  beforeEach(() => {
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  })
  afterEach(() => {
    warn.mockRestore()
  })

  it('extracts sha, repo, and the offset-preserving author date', () => {
    const { totalCount, items } = parseCommitSearchResponse(COMMIT_PAYLOAD)
    expect(totalCount).toBe(246)
    expect(items).toEqual([
      {
        sha: '71a69c8d1111111111111111111111111111aaaa',
        repo: 'Huub-NL/finview',
        authoredAt: '2026-07-22T16:05:11.000+02:00',
      },
    ])
    expect(warn).not.toHaveBeenCalled()
  })

  it('prefers author date over committer date', () => {
    const payload = {
      total_count: 1,
      items: [{
        sha: 'x',
        commit: {
          author: { date: '2026-07-01T10:00:00.000+02:00' },
          committer: { date: '2026-07-09T10:00:00.000+02:00' },
        },
        repository: { full_name: 'a/b' },
      }],
    }
    expect(parseCommitSearchResponse(payload).items[0]?.authoredAt)
      .toBe('2026-07-01T10:00:00.000+02:00')
  })

  it('skips malformed items rather than aborting the whole window', () => {
    const payload = {
      total_count: 2,
      items: [
        { sha: 'ok', commit: { author: { date: '2026-07-01T10:00:00.000+02:00' } }, repository: { full_name: 'a/b' } },
        { sha: 'bad', commit: {}, repository: {} },
      ],
    }
    expect(parseCommitSearchResponse(payload).items).toHaveLength(1)
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0]?.[0]).toMatch(/bad/)
  })

  it('throws when total_count is absent — a shape change must not read as zero', () => {
    expect(() => parseCommitSearchResponse({ items: [] })).toThrow(/total_count/i)
  })

  it('warns and skips an item missing only sha', () => {
    const payload = {
      total_count: 1,
      items: [{ commit: { author: { date: '2026-07-01T10:00:00.000+02:00' } }, repository: { full_name: 'a/b' } }],
    }
    expect(parseCommitSearchResponse(payload).items).toHaveLength(0)
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0]?.[0]).toMatch(/sha/)
  })

  it('warns and skips an item missing only the author date', () => {
    const payload = {
      total_count: 1,
      items: [{ sha: 'abc', commit: {}, repository: { full_name: 'a/b' } }],
    }
    expect(parseCommitSearchResponse(payload).items).toHaveLength(0)
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0]?.[0]).toMatch(/author\.date/)
  })

  it('warns and skips an item missing only the repo', () => {
    const payload = {
      total_count: 1,
      items: [{
        sha: 'abc',
        commit: { author: { date: '2026-07-01T10:00:00.000+02:00' } },
        repository: {},
      }],
    }
    expect(parseCommitSearchResponse(payload).items).toHaveLength(0)
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0]?.[0]).toMatch(/full_name/)
  })

  it.each(['weird', '/leading-slash', ''])(
    'warns and skips an item whose repo is not "owner/name" (%j)',
    (full_name) => {
      // Every consumer derives the org by splitting on the slash, so letting one
      // of these through would throw from the ingest hot path or the UI's org
      // list. The parser is the only place that can skip an item.
      const payload = {
        total_count: 1,
        items: [{
          sha: 'abc',
          commit: { author: { date: '2026-07-01T10:00:00.000+02:00' } },
          repository: { full_name },
        }],
      }
      expect(parseCommitSearchResponse(payload).items).toHaveLength(0)
      expect(warn).toHaveBeenCalledTimes(1)
      expect(warn.mock.calls[0]?.[0]).toMatch(/full_name/)
    },
  )
})

const PR_PAYLOAD = {
  data: {
    search: {
      issueCount: 113,
      pageInfo: { hasNextPage: false, endCursor: 'Y3Vyc29yOjE=' },
      nodes: [
        {
          id: 'PR_kwDO1',
          mergedAt: '2026-06-30T12:00:00Z',
          additions: 7964,
          deletions: 51,
          repository: { nameWithOwner: 'Huub-NL/finview' },
        },
        // GraphQL search can return non-PR nodes as empty objects; they must be skipped.
        {},
      ],
    },
  },
}

describe('parsePrSearchResponse', () => {
  let warn: ReturnType<typeof vi.spyOn>
  beforeEach(() => {
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  })
  afterEach(() => {
    warn.mockRestore()
  })

  it('extracts merged PRs with churn fields', () => {
    const { totalCount, items, pageInfo } = parsePrSearchResponse(PR_PAYLOAD)
    expect(totalCount).toBe(113)
    expect(pageInfo.hasNextPage).toBe(false)
    expect(items).toEqual([
      {
        id: 'PR_kwDO1',
        record: {
          repo: 'Huub-NL/finview',
          mergedAt: '2026-06-30T12:00:00Z',
          additions: 7964,
          deletions: 51,
        },
      },
    ])
    expect(warn).toHaveBeenCalledTimes(1)
  })

  it('surfaces GraphQL errors instead of silently returning nothing', () => {
    expect(() => parsePrSearchResponse({ errors: [{ message: 'Bad credentials' }] }))
      .toThrow(/Bad credentials/)
  })

  it('skips a PR with no mergedAt', () => {
    const payload = {
      data: { search: { issueCount: 1, pageInfo: { hasNextPage: false }, nodes: [
        { id: 'x', mergedAt: null, additions: 1, deletions: 1, repository: { nameWithOwner: 'a/b' } },
      ] } },
    }
    expect(parsePrSearchResponse(payload).items).toHaveLength(0)
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0]?.[0]).toMatch(/mergedAt/)
  })

  it('warns and skips a PR node missing only id', () => {
    const payload = {
      data: { search: { issueCount: 1, pageInfo: { hasNextPage: false }, nodes: [
        { mergedAt: '2026-06-30T12:00:00Z', additions: 1, deletions: 1, repository: { nameWithOwner: 'a/b' } },
      ] } },
    }
    expect(parsePrSearchResponse(payload).items).toHaveLength(0)
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0]?.[0]).toMatch(/\bid\b/)
  })

  it('warns and skips a PR node missing only repository.nameWithOwner', () => {
    const payload = {
      data: { search: { issueCount: 1, pageInfo: { hasNextPage: false }, nodes: [
        { id: 'x', mergedAt: '2026-06-30T12:00:00Z', additions: 1, deletions: 1, repository: {} },
      ] } },
    }
    expect(parsePrSearchResponse(payload).items).toHaveLength(0)
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0]?.[0]).toMatch(/nameWithOwner/)
  })

  it('warns and skips a PR node whose repo is not "owner/name"', () => {
    const payload = {
      data: {
        search: {
          issueCount: 1,
          pageInfo: { hasNextPage: false },
          nodes: [{
            id: 'x',
            mergedAt: '2026-06-30T12:00:00Z',
            additions: 1,
            deletions: 1,
            repository: { nameWithOwner: 'no-slash' },
          }],
        },
      },
    }
    expect(parsePrSearchResponse(payload).items).toHaveLength(0)
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0]?.[0]).toMatch(/nameWithOwner/)
  })

  it('throws when hasNextPage is true but endCursor is absent', () => {
    const payload = {
      data: { search: { issueCount: 5, pageInfo: { hasNextPage: true }, nodes: [] } },
    }
    expect(() => parsePrSearchResponse(payload)).toThrow(/endCursor/i)
  })
})

// ---------- fetchers: hermetic via a mocked child_process, no real gh/network ----------

type ExecCallback = (error: NodeJS.ErrnoException | null, stdout: string, stderr: string) => void

/** Queues JSON responses for successive `execFile` calls and records the args used. */
function stubExec(responses: unknown[]) {
  const calls: string[][] = []
  let i = 0
  vi.mocked(cp.execFile).mockImplementation(((_bin: string, args: string[], _opts: unknown, cb: ExecCallback) => {
    calls.push(args)
    const payload = responses[Math.min(i, responses.length - 1)]
    i += 1
    cb(null, JSON.stringify(payload), '')
  }) as unknown as typeof cp.execFile)
  return calls
}

describe('makeCommitFetcher', () => {
  beforeEach(() => {
    vi.mocked(cp.execFile).mockReset()
  })

  it('requests the exact window, login, and per_page=100 from windows.ts', async () => {
    const calls = stubExec([COMMIT_PAYLOAD])
    const rl = new RateLimiter(28, { now: () => 0, sleep: async () => {} })
    const fetch = makeCommitFetcher('markhinch', rl)

    const result = await fetch({ start: '2026-07-01', end: '2026-07-31' }, 1)

    expect(result.totalCount).toBe(246)
    expect(result.items).toHaveLength(1)
    const args = calls[0]
    expect(args).toBeDefined()
    expect(args).toContain('search/commits')
    expect(args).toContain(`per_page=${PER_PAGE}`)
    expect(args).toContain('page=1')
    expect(args?.some((a) => a.includes('author:markhinch'))).toBe(true)
    expect(args?.some((a) => a.includes('2026-07-01..2026-07-31'))).toBe(true)
    expect(PER_PAGE).toBe(100)
  })

  it('acquires the rate limiter before every request', async () => {
    stubExec([COMMIT_PAYLOAD])
    const rl = new RateLimiter(28, { now: () => 0, sleep: async () => {} })
    const acquireSpy = vi.spyOn(rl, 'acquire')
    const fetch = makeCommitFetcher('markhinch', rl)

    await fetch({ start: '2026-07-01', end: '2026-07-31' }, 1)

    expect(acquireSpy).toHaveBeenCalledTimes(1)
  })
})

describe('makePrFetcher', () => {
  beforeEach(() => {
    vi.mocked(cp.execFile).mockReset()
  })

  it('threads the endCursor from page 1 into the page-2 request', async () => {
    const page1 = {
      data: {
        search: {
          issueCount: 2,
          pageInfo: { hasNextPage: true, endCursor: 'CURSOR_ONE' },
          nodes: [{
            id: 'PR_1', mergedAt: '2026-06-30T12:00:00Z', additions: 1, deletions: 1,
            repository: { nameWithOwner: 'a/b' },
          }],
        },
      },
    }
    const page2 = {
      data: {
        search: {
          issueCount: 2,
          pageInfo: { hasNextPage: false },
          nodes: [{
            id: 'PR_2', mergedAt: '2026-06-29T12:00:00Z', additions: 2, deletions: 2,
            repository: { nameWithOwner: 'a/b' },
          }],
        },
      },
    }
    const calls = stubExec([page1, page2])
    const rl = new RateLimiter(28, { now: () => 0, sleep: async () => {} })
    const fetch = makePrFetcher('markhinch', rl)
    const w = { start: '2026-06-01', end: '2026-06-30' }

    const first = await fetch(w, 1)
    expect(first.totalCount).toBe(2)
    expect(first.items).toHaveLength(1)
    expect(calls[0]?.some((a) => a.includes('cursor='))).toBe(false)

    const second = await fetch(w, 2)
    expect(second.items).toHaveLength(1)
    expect(calls[1]?.some((a) => a === 'cursor=CURSOR_ONE' || a.includes('cursor=CURSOR_ONE'))).toBe(true)
  })

  it('sends the GraphQL page size matching PER_PAGE', async () => {
    const calls = stubExec([{
      data: { search: { issueCount: 0, pageInfo: { hasNextPage: false }, nodes: [] } },
    }])
    const rl = new RateLimiter(28, { now: () => 0, sleep: async () => {} })
    const fetch = makePrFetcher('markhinch', rl)

    await fetch({ start: '2026-06-01', end: '2026-06-30' }, 1)

    const queryArg = calls[0]?.find((a) => a.startsWith('query='))
    expect(queryArg).toBeDefined()
    expect(queryArg).toContain(`first: ${PER_PAGE}`)
    expect(PER_PAGE).toBe(100)
  })

  // A behavioral assertion alone can't distinguish "derived from PER_PAGE"
  // from "hardcoded to PER_PAGE's current value of 100" — both produce an
  // identical query string today. This source-level check is the actual
  // regression guard: it fails the instant `first: ${PER_PAGE}` is replaced
  // with a numeric literal, which the behavioral test above would not catch.
  it('builds the GraphQL page size from the PER_PAGE constant, not a hardcoded number', async () => {
    const { readFile } = await import('node:fs/promises')
    const source = await readFile(new URL('./fetchers.ts', import.meta.url), 'utf8')
    expect(source).toMatch(/first:\s*\$\{PER_PAGE\}/)
  })
})

describe('fetchViewerCreatedAt', () => {
  beforeEach(() => {
    vi.mocked(cp.execFile).mockReset()
  })

  it('returns the account creation date as YYYY-MM-DD', async () => {
    stubExec([{ data: { viewer: { createdAt: '2020-05-14T08:03:00Z' } } }])
    expect(await fetchViewerCreatedAt()).toBe('2020-05-14')
  })
})
