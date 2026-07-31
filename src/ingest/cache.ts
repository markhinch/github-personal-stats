import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
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

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Returns `value` typed as `T` when it satisfies `isValid`. A missing field
 * (`undefined`) is not corruption — just an older or partial cache — and
 * quietly takes `fallback`. A field that is *present but wrong-shaped* also
 * takes `fallback`, but is reported via `discarded` so the caller can warn.
 */
function validated<T>(
  value: unknown,
  isValid: (v: unknown) => v is T,
  fallback: T,
): { value: T; discarded: boolean } {
  if (value === undefined) return { value: fallback, discarded: false }
  if (isValid(value)) return { value, discarded: false }
  return { value: fallback, discarded: true }
}

/**
 * Loads the cache, falling back to empty (or, for a partially-malformed
 * file, per-field defaults) on a missing or corrupt file. Salvaging the
 * good fields of a partially-malformed cache costs less re-backfill than
 * discarding the whole thing.
 */
export async function loadCache(path: string): Promise<IngestCache> {
  let raw: string
  try {
    raw = await readFile(path, 'utf8')
  } catch {
    return emptyCache()
  }

  const base = emptyCache()
  const warnCorrupt = (): void => console.warn(`Cache at ${path} was unreadable; starting fresh.`)

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    // A corrupt cache costs a re-backfill, not a crash.
    warnCorrupt()
    return base
  }

  if (!isPlainObject(parsed)) {
    warnCorrupt()
    return base
  }

  const commits = validated(parsed.commits, isPlainObject, base.commits)
  const prs = validated(parsed.prs, isPlainObject, base.prs)
  const doneWindowsField = validated(parsed.doneWindows, isPlainObject, {} as Record<string, unknown>)
  const doneWindowsCommits = validated(doneWindowsField.value.commits, Array.isArray, base.doneWindows.commits)
  const doneWindowsPrs = validated(doneWindowsField.value.prs, Array.isArray, base.doneWindows.prs)
  const watermark = validated(parsed.watermark, isPlainObject, base.watermark)

  const anyDiscarded =
    commits.discarded ||
    prs.discarded ||
    doneWindowsField.discarded ||
    doneWindowsCommits.discarded ||
    doneWindowsPrs.discarded ||
    watermark.discarded
  if (anyDiscarded) warnCorrupt()

  return {
    commits: commits.value as Record<string, CommitRecord>,
    prs: prs.value as Record<string, MergedPrRecord>,
    doneWindows: {
      commits: doneWindowsCommits.value as string[],
      prs: doneWindowsPrs.value as string[],
    },
    watermark: watermark.value as { commits?: string; prs?: string },
  }
}

/** Writes via a temp file + rename so an interrupted save cannot corrupt the cache. */
export async function saveCache(path: string, cache: IngestCache): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const tmp = `${path}.tmp`
  await writeFile(tmp, JSON.stringify(cache), 'utf8')
  try {
    await rename(tmp, path)
  } catch (err) {
    // Don't leave a stray temp file behind; the caller must still learn the save failed.
    await unlink(tmp).catch(() => {})
    throw err
  }
}
