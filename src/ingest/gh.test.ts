import { describe, it, expect } from 'vitest'
import { ghJson, GhError } from './gh'

describe('ghJson', () => {
  it('parses JSON from a successful gh invocation', async () => {
    // `gh api rate_limit` is a cheap, always-available endpoint.
    const res = await ghJson<{ resources: { search: { limit: number } } }>(['api', 'rate_limit'])
    expect(res.resources.search.limit).toBeGreaterThan(0)
  })

  it('throws GhError with stderr context on a failed invocation', async () => {
    await expect(ghJson(['api', 'this/endpoint/does/not/exist'])).rejects.toThrow(GhError)
  })

  it('throws GhError when the binary is missing', async () => {
    await expect(ghJson(['api', 'rate_limit'], { bin: 'gh-does-not-exist' }))
      .rejects.toThrow(/not found|ENOENT/i)
  })
})
