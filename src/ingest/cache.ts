import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { CommitRecord, MergedPrRecord } from '../core/types'

export interface IngestCache {
  /** Keyed by commit SHA, so overlapping bisected windows dedupe for free. */
  commits: Record<string, CommitRecord>
  /** Keyed by GraphQL node id. */
  prs: Record<string, MergedPrRecord>
  /** Fully-collected window keys, enabling resume after an interruption. */
  doneWindows: { commits: string[]; prs: string[] }
  watermark: { commits?: string; prs?: string }
}

export function emptyCache(): IngestCache {
  return { commits: {}, prs: {}, doneWindows: { commits: [], prs: [] }, watermark: {} }
}

/** Loads the cache, falling back to empty on a missing or corrupt file. */
export async function loadCache(path: string): Promise<IngestCache> {
  let raw: string
  try {
    raw = await readFile(path, 'utf8')
  } catch {
    return emptyCache()
  }
  try {
    const parsed = JSON.parse(raw) as Partial<IngestCache>
    const base = emptyCache()
    return {
      commits: parsed.commits ?? base.commits,
      prs: parsed.prs ?? base.prs,
      doneWindows: {
        commits: parsed.doneWindows?.commits ?? [],
        prs: parsed.doneWindows?.prs ?? [],
      },
      watermark: parsed.watermark ?? {},
    }
  } catch {
    // A corrupt cache costs a re-backfill, not a crash.
    console.warn(`Cache at ${path} was unreadable; starting fresh.`)
    return emptyCache()
  }
}

/** Writes via a temp file + rename so an interrupted save cannot corrupt the cache. */
export async function saveCache(path: string, cache: IngestCache): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const tmp = `${path}.tmp`
  await writeFile(tmp, JSON.stringify(cache), 'utf8')
  await rename(tmp, path)
}
