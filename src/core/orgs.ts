import type { Dataset } from './types'

/**
 * True when `repo` is a well-formed "owner/name" identifier, i.e. one that
 * `orgOf` will accept. Exported so ingest can reject a malformed repo at the
 * parser — the one place that can skip an item — rather than letting it reach
 * `orgOf` and throw from somewhere with no way to recover.
 */
export function isRepoId(repo: string): boolean {
  return repo.indexOf('/') > 0
}

/** Extracts the owner segment from an "owner/name" repo identifier. */
export function orgOf(repo: string): string {
  if (!isRepoId(repo)) throw new Error(`Malformed repo identifier: ${JSON.stringify(repo)}`)
  return repo.slice(0, repo.indexOf('/'))
}

/**
 * Every org present in the dataset, sorted case-insensitively.
 * Derived from the data rather than configured, so the checkbox list
 * stays correct as orgs come and go.
 */
export function listOrgs(ds: Dataset): string[] {
  const seen = new Set<string>()
  for (const c of ds.commits) seen.add(orgOf(c.repo))
  for (const p of ds.mergedPrs) seen.add(orgOf(p.repo))
  return [...seen].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()))
}
