import { describe, it, expect, vi } from 'vitest'
import { mkdtemp, writeFile, chmod, readdir, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, dirname, basename } from 'node:path'
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
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const c = await loadCache(path)
      expect(c.commits).toEqual({})
      // The warning must actually reach the user, not be swallowed.
      expect(warnSpy).toHaveBeenCalledTimes(1)
    } finally {
      warnSpy.mockRestore()
    }
  })

  it('discards a wrong-typed field but salvages the rest, warning once', async () => {
    const path = await tmpFile('wrong-type.json')
    // commits is valid; prs is present but the wrong shape (a string, not a record).
    await writeFile(
      path,
      JSON.stringify({
        commits: { abc: { sha: 'abc', repo: 'a/b', authoredAt: '2026-07-01T10:00:00.000+02:00' } },
        prs: 'not-an-object',
      }),
    )
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const c = await loadCache(path)
      // The valid field survives...
      expect(c.commits['abc']?.repo).toBe('a/b')
      // ...but the wrong-typed field is discarded rather than passed through,
      // which would otherwise crash a later `cache.prs[id] = record` write.
      expect(c.prs).toEqual({})
      expect(warnSpy).toHaveBeenCalledTimes(1)
    } finally {
      warnSpy.mockRestore()
    }
  })

  it('discards a wrong-typed doneWindows without crashing', async () => {
    const path = await tmpFile('wrong-donewindows.json')
    await writeFile(path, JSON.stringify({ doneWindows: 'not-an-object' }))
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const c = await loadCache(path)
      expect(c.doneWindows).toEqual({ commits: [], prs: [] })
      expect(warnSpy).toHaveBeenCalledTimes(1)
    } finally {
      warnSpy.mockRestore()
    }
  })

  it('writes atomically so an interrupted save cannot corrupt the cache', async () => {
    const path = await tmpFile('atomic.json')
    await saveCache(path, emptyCache())
    // A temp file must not be left behind.
    const entries = await readdir(dirname(path))
    expect(entries).toEqual([basename(path)])
  })

  it('does not corrupt or silently replace the existing cache file when the atomic swap cannot complete', async () => {
    const path = await tmpFile('swap-fails.json')
    await writeFile(path, 'PRIOR-CONTENT')
    const dir = dirname(path)
    // Block directory-entry mutations (creating the temp file, renaming it into
    // place) while leaving the existing file's own permissions untouched, so a
    // real rename-based swap cannot happen but an in-place overwrite still could.
    await chmod(dir, 0o555)
    try {
      await expect(saveCache(path, emptyCache())).rejects.toThrow()
    } finally {
      await chmod(dir, 0o755)
    }
    // The prior content must still be there — a failed save must not corrupt,
    // truncate, or silently replace what was already on disk.
    expect(await readFile(path, 'utf8')).toBe('PRIOR-CONTENT')
  })

  it('cleans up the temp file when the rename itself fails', async () => {
    const path = await tmpFile('rename-fails.json')
    const { mkdir } = await import('node:fs/promises')
    // Pre-create a directory at the destination so rename(tmp, path) fails
    // with EISDIR after the temp file has already been written successfully.
    await mkdir(path)
    await expect(saveCache(path, emptyCache())).rejects.toThrow()
    const entries = await readdir(dirname(path))
    expect(entries).toEqual([basename(path)])
  })
})
