import { describe, it, expect } from 'vitest'
import { ghJson, assertGhReady, GhError } from './gh'

/**
 * All tests below drive `gh.ts` through its injectable `exec` seam — none of
 * them spawn the real `gh` binary or touch the network. The seam mirrors
 * `node:child_process`'s `execFile(bin, args, options, callback)` shape.
 */
type FakeExec = (
  bin: string,
  args: string[],
  options: { maxBuffer: number },
  callback: (error: (Error & { code?: string }) | null, stdout: string, stderr: string) => void,
) => void

describe('ghJson', () => {
  it('parses JSON from a successful invocation', async () => {
    const exec: FakeExec = (_bin, _args, _options, cb) => {
      cb(null, JSON.stringify({ resources: { search: { limit: 30 } } }), '')
    }
    const res = await ghJson<{ resources: { search: { limit: number } } }>(['api', 'rate_limit'], { exec })
    expect(res.resources.search.limit).toBe(30)
  })

  it('throws GhError with stderr context on a failed invocation, carrying the stderr text', async () => {
    const exec: FakeExec = (_bin, _args, _options, cb) => {
      cb(new Error('exit status 1'), '', 'gh: Not Found (HTTP 404)')
    }
    await expect(ghJson(['api', 'this/endpoint/does/not/exist'], { exec })).rejects.toThrow(GhError)

    let caught: unknown
    try {
      await ghJson(['api', 'this/endpoint/does/not/exist'], { exec })
    } catch (err) {
      caught = err
    }
    expect(caught).toBeInstanceOf(GhError)
    expect((caught as GhError).stderr).toContain('Not Found')
  })

  it('throws GhError mentioning unparseable JSON when gh exits 0 with garbage stdout', async () => {
    const exec: FakeExec = (_bin, _args, _options, cb) => {
      cb(null, 'not actually json', '')
    }
    await expect(ghJson(['api', 'rate_limit'], { exec })).rejects.toThrow(/unparseable JSON/i)
  })

  it('throws GhError naming the install fix when the binary is missing (ENOENT)', async () => {
    const exec: FakeExec = (_bin, _args, _options, cb) => {
      const enoent = Object.assign(new Error('spawn gh-does-not-exist ENOENT'), { code: 'ENOENT' })
      cb(enoent, '', '')
    }
    await expect(ghJson(['api', 'rate_limit'], { bin: 'gh-does-not-exist', exec }))
      .rejects.toThrow(/install the github cli/i)
  })

  it('passes the argument array to the spawn call as an array, unmodified', async () => {
    const seenArgs: unknown[] = []
    const exec: FakeExec = (_bin, args, _options, cb) => {
      seenArgs.push(args)
      cb(null, '{}', '')
    }
    const args = ['api', 'repos/foo/bar; rm -rf /', '--jq', '.']
    await ghJson(args, { exec })
    expect(seenArgs).toHaveLength(1)
    expect(Array.isArray(seenArgs[0])).toBe(true)
    expect(seenArgs[0]).toEqual(args)
  })
})

describe('GhError transience', () => {
  /** Runs a failing invocation and hands back the GhError it rejected with. */
  async function failWith(stderr: string, code?: string): Promise<GhError> {
    const exec: FakeExec = (_bin, _args, _options, cb) => {
      const err = Object.assign(new Error('exit status 1'), code ? { code } : {})
      cb(err, '', stderr)
    }
    try {
      await ghJson(['api', 'graphql'], { exec })
    } catch (err) {
      return err as GhError
    }
    throw new Error('expected the invocation to reject')
  }

  // Verbatim stderr from the run that motivated this: `gh api graphql` on a
  // deep search cursor. gh reports the status and nothing else machine-readable,
  // so the status has to be recovered from the text.
  it('reads the status out of gh\'s bare `gh: HTTP 502` stderr', async () => {
    const err = await failWith('gh: HTTP 502\n')
    expect(err.status).toBe(502)
    expect(err.transient).toBe(true)
  })

  it('reads the status out of the parenthesised `(HTTP 404)` form', async () => {
    const err = await failWith('gh: Not Found (HTTP 404)')
    expect(err.status).toBe(404)
    expect(err.transient).toBe(false)
  })

  it.each([500, 502, 503, 504, 429])('treats HTTP %i as transient', async (status) => {
    expect((await failWith(`gh: HTTP ${status}`)).transient).toBe(true)
  })

  // These must fail fast. Retrying them burns minutes of backoff to arrive at
  // the same answer, and hides the misconfiguration behind the delay.
  it.each([401, 403, 404, 422])('treats HTTP %i as permanent', async (status) => {
    expect((await failWith(`gh: HTTP ${status}`)).transient).toBe(false)
  })

  it('treats a missing binary as permanent, with no status', async () => {
    const err = await failWith('', 'ENOENT')
    expect(err.status).toBeUndefined()
    expect(err.transient).toBe(false)
  })

  // No status reported at all — a DNS failure, a dropped socket, a gh crash.
  // Deliberately permanent: the fix is narrow to the failure actually observed,
  // and a genuinely broken setup must not be retried into looking like slowness.
  it('treats a failure with no HTTP status as permanent', async () => {
    const err = await failWith('some other gh problem')
    expect(err.status).toBeUndefined()
    expect(err.transient).toBe(false)
  })

  it('does not mistake a digit run inside a message for a status', async () => {
    expect((await failWith('gh: repo 502 not found')).status).toBeUndefined()
  })
})

describe('assertGhReady', () => {
  it('resolves when gh returns an authenticated login', async () => {
    const exec: FakeExec = (_bin, _args, _options, cb) => {
      cb(null, JSON.stringify({ login: 'markhinch' }), '')
    }
    await expect(assertGhReady({ exec })).resolves.toBeUndefined()
  })

  it('throws GhError naming `gh auth login` when the underlying call fails', async () => {
    const exec: FakeExec = (_bin, _args, _options, cb) => {
      cb(new Error('exit status 1'), '', 'gh: not logged in')
    }
    await expect(assertGhReady({ exec })).rejects.toThrow(GhError)
    await expect(assertGhReady({ exec })).rejects.toThrow(/gh auth login/i)
  })

  it('throws GhError when gh succeeds but returns no authenticated user', async () => {
    const exec: FakeExec = (_bin, _args, _options, cb) => {
      cb(null, JSON.stringify({ login: '' }), '')
    }
    await expect(assertGhReady({ exec })).rejects.toThrow(/no authenticated user/i)
  })
})
