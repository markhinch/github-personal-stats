import type { Bucket, Metric, Split } from '../core/types'
import { RANGE_OPTIONS, type RangeId } from './range'

/** Every control on the page, in the shape it survives a reload in. */
export interface Prefs {
  bucket: Bucket
  metric: Metric
  range: RangeId
  split: Split
  /**
   * Organisations explicitly switched off, mirroring how App tracks them:
   * storing the *excluded* set rather than the selected one means an org that
   * only shows up in a later `pnpm sync` is visible by default instead of
   * silently filtered out by prefs written before it existed.
   */
  deselectedOrgs: string[]
}

/** What the page opens on with nothing stored. */
export const DEFAULT_PREFS: Prefs = {
  bucket: 'month',
  metric: 'commits',
  range: '1y',
  split: 'none',
  deselectedOrgs: [],
}

/**
 * Versioned so a future rename of an option value can't be misread as a valid
 * pref — bump the suffix and every browser starts from the defaults rather
 * than from a payload this code no longer understands.
 */
export const PREFS_KEY = 'github-personal-stats:prefs:v1'

const BUCKETS: readonly Bucket[] = ['week', 'month']
const METRICS: readonly Metric[] = ['commits', 'lines']
const SPLITS: readonly Split[] = ['none', 'repo']
// Straight from the control's own option list, so a range the UI can't offer
// can't be restored either.
const RANGES: readonly RangeId[] = RANGE_OPTIONS.map((o) => o.value)

const oneOf = <T extends string>(allowed: readonly T[], value: unknown, fallback: T): T =>
  allowed.includes(value as T) ? (value as T) : fallback

/**
 * Reads a stored payload, field by field: anything missing, corrupt, or
 * outside a control's option list falls back to that control's default while
 * the rest are kept. localStorage is user-writable, so this treats its
 * contents as untrusted input rather than as something this code wrote.
 */
export function parsePrefs(raw: string | null): Prefs {
  if (raw === null) return DEFAULT_PREFS

  let json: unknown
  try {
    json = JSON.parse(raw)
  } catch {
    return DEFAULT_PREFS
  }
  if (typeof json !== 'object' || json === null || Array.isArray(json)) return DEFAULT_PREFS

  const o = json as Record<string, unknown>
  return {
    bucket: oneOf(BUCKETS, o.bucket, DEFAULT_PREFS.bucket),
    metric: oneOf(METRICS, o.metric, DEFAULT_PREFS.metric),
    range: oneOf(RANGES, o.range, DEFAULT_PREFS.range),
    split: oneOf(SPLITS, o.split, DEFAULT_PREFS.split),
    deselectedOrgs: Array.isArray(o.deselectedOrgs)
      ? o.deselectedOrgs.filter((v): v is string => typeof v === 'string')
      : DEFAULT_PREFS.deselectedOrgs,
  }
}

export const serializePrefs = (prefs: Prefs): string => JSON.stringify(prefs)

/** The slice of `Storage` this uses — small enough for tests to supply directly. */
export interface PrefStore {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

/**
 * `localStorage` when it is usable, null otherwise. Merely *touching* it
 * throws in some privacy configurations, so even the lookup is guarded.
 */
export function browserStore(): PrefStore | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

export function readPrefs(store: PrefStore | null): Prefs {
  if (store === null) return DEFAULT_PREFS
  try {
    return parsePrefs(store.getItem(PREFS_KEY))
  } catch {
    return DEFAULT_PREFS
  }
}

export function writePrefs(store: PrefStore | null, prefs: Prefs): void {
  if (store === null) return
  try {
    store.setItem(PREFS_KEY, serializePrefs(prefs))
  } catch {
    // Full quota or denied access: the options just don't outlive the tab.
    // Nothing on screen depends on the write having landed.
  }
}
