import { ghJson } from './gh'
import { isRepoId } from '../core/orgs'
import type { RateLimiter } from './ratelimit'
import { PER_PAGE, windowKey, type DateWindow, type PageFetcher } from './windows'
import type { CommitRecord, MergedPrRecord } from '../core/types'

// ---------- commits (REST search) ----------

export function parseCommitSearchResponse(json: unknown): {
  totalCount: number
  items: CommitRecord[]
} {
  const o = json as { total_count?: number; items?: unknown[] }
  if (typeof o.total_count !== 'number') {
    throw new Error('Commit search response has no numeric total_count — API shape may have changed')
  }
  const items: CommitRecord[] = []
  for (const raw of o.items ?? []) {
    const it = raw as {
      sha?: string
      commit?: { author?: { date?: string } }
      repository?: { full_name?: string }
    }
    const sha = it.sha
    const authoredAt = it.commit?.author?.date
    const repo = it.repository?.full_name
    // Skip rather than abort: one odd item must not cost a whole window. But
    // never silently — a response shape change would otherwise quietly drop
    // items and render as "less work done" with nothing to explain why.
    //
    // "owner/name" is required, not merely non-empty: every consumer derives the
    // org by splitting on the slash, so a slash-less repo would throw from the
    // ingest hot path (aborting a multi-minute backfill) or from the UI's org
    // list. The parser is the one place that can skip an item, so it decides.
    if (!sha || !authoredAt || !repo || !isRepoId(repo)) {
      const missing = [
        !sha && 'sha',
        !authoredAt && 'commit.author.date',
        !repo && 'repository.full_name',
        repo && !isRepoId(repo) && `repository.full_name is not "owner/name" (${repo})`,
      ].filter((v): v is string => Boolean(v)).join(', ')
      console.warn(`Skipping malformed commit search item (sha=${sha ?? 'unknown'}): missing ${missing}`)
      continue
    }
    items.push({ sha, repo, authoredAt })
  }
  return { totalCount: o.total_count, items }
}

/** A rate-limited page fetcher for commits authored by `login`. */
export function makeCommitFetcher(login: string, rl: RateLimiter): PageFetcher<CommitRecord> {
  return async (w: DateWindow, page: number) => {
    await rl.acquire()
    const json = await ghJson<unknown>([
      'api', '-X', 'GET', 'search/commits',
      '-f', `q=author:${login} author-date:${w.start}..${w.end}`,
      '-f', `per_page=${PER_PAGE}`,
      '-f', `page=${page}`,
    ])
    return parseCommitSearchResponse(json)
  }
}

// ---------- merged PRs (GraphQL search) ----------

export interface ParsedPr {
  id: string
  record: MergedPrRecord
}

export function parsePrSearchResponse(json: unknown): {
  totalCount: number
  items: ParsedPr[]
  pageInfo: { hasNextPage: boolean; endCursor?: string }
} {
  const o = json as {
    errors?: Array<{ message?: string }>
    data?: {
      search?: {
        issueCount?: number
        pageInfo?: { hasNextPage?: boolean; endCursor?: string }
        nodes?: unknown[]
      }
    }
  }
  if (o.errors?.length) {
    throw new Error(`GraphQL error: ${o.errors.map((e) => e.message ?? '?').join('; ')}`)
  }
  const search = o.data?.search
  if (!search || typeof search.issueCount !== 'number') {
    throw new Error('PR search response has no issueCount — API shape may have changed')
  }
  if (search.pageInfo?.hasNextPage && !search.pageInfo?.endCursor) {
    // Without a cursor to resume from, the caller has no way to fetch the
    // next page and would otherwise silently re-request page 1 forever.
    throw new Error(
      'PR search reports hasNextPage but no endCursor to resume from — API shape may have changed',
    )
  }
  const items: ParsedPr[] = []
  for (const raw of search.nodes ?? []) {
    const n = raw as {
      id?: string
      mergedAt?: string | null
      additions?: number
      deletions?: number
      repository?: { nameWithOwner?: string }
    }
    const repo = n.repository?.nameWithOwner
    // Skip rather than abort — see the commit parser above for why silence
    // isn't acceptable here either. Non-PR search nodes surface as empty
    // objects (the `... on PullRequest` fragment simply doesn't match), so
    // this also catches that expected case, not just malformed ones.
    if (!n.id || !n.mergedAt || !repo || !isRepoId(repo)) {
      const missing = [
        !n.id && 'id',
        !n.mergedAt && 'mergedAt',
        !repo && 'repository.nameWithOwner',
        repo && !isRepoId(repo) && `repository.nameWithOwner is not "owner/name" (${repo})`,
      ].filter((v): v is string => Boolean(v)).join(', ')
      console.warn(`Skipping malformed PR search item (id=${n.id ?? 'unknown'}): missing ${missing}`)
      continue
    }
    items.push({
      id: n.id,
      record: {
        repo,
        mergedAt: n.mergedAt,
        additions: n.additions ?? 0,
        deletions: n.deletions ?? 0,
      },
    })
  }
  return {
    totalCount: search.issueCount,
    items,
    pageInfo: {
      hasNextPage: search.pageInfo?.hasNextPage ?? false,
      endCursor: search.pageInfo?.endCursor,
    },
  }
}

const PR_QUERY = `
query($q: String!, $cursor: String) {
  search(query: $q, type: ISSUE, first: ${PER_PAGE}, after: $cursor) {
    issueCount
    pageInfo { hasNextPage endCursor }
    nodes {
      ... on PullRequest {
        id
        mergedAt
        additions
        deletions
        repository { nameWithOwner }
      }
    }
  }
}`

/**
 * A page fetcher for merged PRs. GraphQL search shares the same 1000-result
 * cap, so this plugs into collectWindow exactly like the commit fetcher.
 *
 * Cursor pagination is mapped onto page numbers by walking cursors internally.
 */
export function makePrFetcher(login: string, rl: RateLimiter): PageFetcher<ParsedPr> {
  // Cursors per window, so repeated page-N requests stay coherent.
  const cursors = new Map<string, string[]>()

  return async (w: DateWindow, page: number) => {
    const key = windowKey(w)
    const known = cursors.get(key) ?? []
    const args = [
      'api', 'graphql',
      '-f', `query=${PR_QUERY}`,
      '-f', `q=type:pr author:${login} is:merged merged:${w.start}..${w.end}`,
    ]
    const cursor = page > 1 ? known[page - 2] : undefined
    if (cursor) args.push('-f', `cursor=${cursor}`)

    await rl.acquire()
    const parsed = parsePrSearchResponse(await ghJson<unknown>(args))
    if (parsed.pageInfo.endCursor) {
      known[page - 1] = parsed.pageInfo.endCursor
      cursors.set(key, known)
    }
    return { totalCount: parsed.totalCount, items: parsed.items }
  }
}

// ---------- viewer metadata ----------

/**
 * Orgs the authenticated user belongs to, used to attribute a commit that
 * appears in several repos of a fork network to our own copy.
 *
 * Discovered rather than configured: a hardcoded list would rot the moment the
 * human joins or leaves an org. One request, no pagination — `per_page=100` is
 * far beyond any realistic membership count, and `gh api --paginate` would
 * concatenate pages into invalid JSON.
 */
export async function fetchViewerOrgs(): Promise<string[]> {
  const json = await ghJson<unknown>(['api', '-X', 'GET', 'user/orgs', '-f', 'per_page=100'])
  if (!Array.isArray(json)) {
    throw new Error('Expected an array from user/orgs — API shape may have changed')
  }
  const logins: string[] = []
  for (const raw of json) {
    const login = (raw as { login?: string }).login
    // Warn rather than abort: a nameless org would only weaken attribution,
    // but silence would make a wrong org split impossible to explain.
    if (!login) {
      console.warn('Skipping an org from user/orgs with no login field')
      continue
    }
    logins.push(login)
  }
  return logins
}

/** The account creation date, used as the default backfill start. */
export async function fetchViewerCreatedAt(): Promise<string> {
  const json = await ghJson<{ data: { viewer: { createdAt: string } } }>([
    'api', 'graphql', '-f', 'query={ viewer { createdAt } }',
  ])
  return json.data.viewer.createdAt.slice(0, 10)
}
