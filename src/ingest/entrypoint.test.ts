import { describe, it, expect } from 'vitest'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { isEntryPoint } from './entrypoint'

const thisFile = fileURLToPath(import.meta.url)

describe('isEntryPoint', () => {
  it('is true when the module is the script being run', () => {
    expect(isEntryPoint(thisFile, import.meta.url)).toBe(true)
  })

  it('is false for a different script — the import case', () => {
    // What matters: under vitest, or any other importer, a CLI module guarded by
    // this must not run its main().
    expect(isEntryPoint(process.argv[1], import.meta.url)).toBe(false)
  })

  it('is false when there is no script argument at all (e.g. `node -e`)', () => {
    expect(isEntryPoint(undefined, import.meta.url)).toBe(false)
    expect(isEntryPoint('', import.meta.url)).toBe(false)
  })

  it('is false, not throwing, for a path that does not exist', () => {
    expect(isEntryPoint('/nonexistent/definitely-not-here.ts', import.meta.url)).toBe(false)
  })

  it('accepts a file:// URL form of the same path', () => {
    expect(isEntryPoint(thisFile, pathToFileURL(thisFile).href)).toBe(true)
  })
})
