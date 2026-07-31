import type { Dataset } from './types'

/** Extracts the owner segment from an "owner/name" repo identifier. */
export function orgOf(repo: string): string {
  const slash = repo.indexOf('/')
  if (slash <= 0) throw new Error(`Malformed repo identifier: ${JSON.stringify(repo)}`)
  return repo.slice(0, slash)
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
