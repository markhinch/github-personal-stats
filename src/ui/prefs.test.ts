import { describe, it, expect } from 'vitest'
import {
  DEFAULT_PREFS,
  PREFS_KEY,
  parsePrefs,
  readPrefs,
  serializePrefs,
  writePrefs,
  type PrefStore,
  type Prefs,
} from './prefs'

/** An in-memory stand-in for localStorage; the test env has no DOM. */
function memoryStore(seed: Record<string, string> = {}): PrefStore & { items: Map<string, string> } {
  const items = new Map(Object.entries(seed))
  return {
    items,
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => void items.set(key, value),
  }
}

/** A store that throws on every access, like Safari's private mode. */
const hostileStore: PrefStore = {
  getItem: () => {
    throw new Error('storage denied')
  },
  setItem: () => {
    throw new Error('quota exceeded')
  },
}

const nonDefault: Prefs = {
  bucket: 'week',
  metric: 'lines',
  range: 'all',
  split: 'repo',
  deselectedOrgs: ['acme'],
}

describe('DEFAULT_PREFS', () => {
  it('matches the options the page opens on with no stored state', () => {
    expect(DEFAULT_PREFS).toEqual({
      bucket: 'month',
      metric: 'commits',
      range: '1y',
      split: 'none',
      deselectedOrgs: [],
    })
  })
})

describe('parsePrefs', () => {
  it('restores every control from a stored payload', () => {
    expect(parsePrefs(serializePrefs(nonDefault))).toEqual(nonDefault)
  })

  it('falls back to defaults when nothing is stored', () => {
    expect(parsePrefs(null)).toEqual(DEFAULT_PREFS)
  })

  it('falls back to defaults for a payload that is not JSON', () => {
    expect(parsePrefs('not json {')).toEqual(DEFAULT_PREFS)
  })

  it('falls back to defaults for JSON that is not an object', () => {
    expect(parsePrefs('42')).toEqual(DEFAULT_PREFS)
    expect(parsePrefs('null')).toEqual(DEFAULT_PREFS)
    expect(parsePrefs('["week"]')).toEqual(DEFAULT_PREFS)
  })

  // Each field is validated on its own so a payload written by an older
  // version — or hand-edited in devtools — degrades one control at a time
  // instead of discarding the whole set.
  it('keeps the valid fields of a partial payload', () => {
    expect(parsePrefs('{"metric":"lines"}')).toEqual({ ...DEFAULT_PREFS, metric: 'lines' })
  })

  it('rejects values outside each control‘s option list', () => {
    const junk = JSON.stringify({
      bucket: 'day',
      metric: 'stars',
      range: '5y',
      split: 'author',
      deselectedOrgs: 'acme',
    })
    expect(parsePrefs(junk)).toEqual(DEFAULT_PREFS)
  })

  it('drops non-string entries from the deselected orgs', () => {
    expect(parsePrefs('{"deselectedOrgs":["acme",7,null,"globex"]}').deselectedOrgs).toEqual([
      'acme',
      'globex',
    ])
  })
})

describe('readPrefs / writePrefs', () => {
  it('round-trips through a store', () => {
    const store = memoryStore()
    writePrefs(store, nonDefault)
    expect(readPrefs(store)).toEqual(nonDefault)
  })

  it('writes under a versioned key', () => {
    const store = memoryStore()
    writePrefs(store, nonDefault)
    expect([...store.items.keys()]).toEqual([PREFS_KEY])
  })

  it('reads defaults when there is no store at all', () => {
    expect(readPrefs(null)).toEqual(DEFAULT_PREFS)
  })

  it('ignores a write when there is no store', () => {
    expect(() => writePrefs(null, nonDefault)).not.toThrow()
  })

  // Storage can be present but unusable — private browsing, a full quota, a
  // blocked third-party context. Losing persistence is acceptable; taking the
  // dashboard down with it is not.
  it('survives a store that throws on read', () => {
    expect(readPrefs(hostileStore)).toEqual(DEFAULT_PREFS)
  })

  it('survives a store that throws on write', () => {
    expect(() => writePrefs(hostileStore, nonDefault)).not.toThrow()
  })
})
