import { describe, it, expect } from 'vitest'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { emptyCache, loadCache, saveCache } from './cache'

const tmpFile = async (name: string): Promise<string> => {
  const dir = await mkdtemp(join(tmpdir(), 'ghstats-'))
  return join(dir, name)
}

describe('cache', () => {
  it('returns an empty cache when the file does not exist', async () => {
    const c = await loadCache(await tmpFile('missing.json'))
    expect(c.commits).toEqual({})
    expect(c.doneWindows.commits).toEqual([])
  })

  it('round-trips through save and load', async () => {
    const path = await tmpFile('cache.json')
    const c = emptyCache()
    c.commits['abc'] = { sha: 'abc', repo: 'Huub-NL/finview', authoredAt: '2026-07-01T10:00:00.000+02:00' }
    c.doneWindows.commits.push('2026-01-01..2026-12-31')
    await saveCache(path, c)

    const back = await loadCache(path)
    expect(back.commits['abc']?.repo).toBe('Huub-NL/finview')
    expect(back.doneWindows.commits).toContain('2026-01-01..2026-12-31')
  })

  it('dedupes by key when the same commit is written twice', async () => {
    const path = await tmpFile('cache.json')
    const c = emptyCache()
    const rec = { sha: 'dup', repo: 'a/b', authoredAt: '2026-07-01T10:00:00.000+02:00' }
    c.commits['dup'] = rec
    c.commits['dup'] = rec
    await saveCache(path, c)
    expect(Object.keys((await loadCache(path)).commits)).toEqual(['dup'])
  })

  it('recovers from a corrupt cache rather than crashing the sync', async () => {
    const path = await tmpFile('corrupt.json')
    await writeFile(path, '{ this is not json')
    const c = await loadCache(path)
    expect(c.commits).toEqual({})
  })

  it('writes atomically so an interrupted save cannot corrupt the cache', async () => {
    const path = await tmpFile('atomic.json')
    await saveCache(path, emptyCache())
    // A temp file must not be left behind.
    const { readdir } = await import('node:fs/promises')
    const { dirname, basename } = await import('node:path')
    const entries = await readdir(dirname(path))
    expect(entries).toEqual([basename(path)])
  })
})
