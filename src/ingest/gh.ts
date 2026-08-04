import { execFile, type ExecFileException } from 'node:child_process'

/**
 * How many times a transient failure is re-attempted before the run gives up.
 *
 * Three is enough for the observed failure — a search-backend 502 that clears in
 * seconds — while staying bounded, so a sustained outage still ends the run with
 * an error instead of stalling behind minutes of backoff.
 */
export const TRANSIENT_RETRIES = 3

/**
 * The HTTP status `gh` reported, if any.
 *
 * `gh api` exits non-zero with the status only in prose — `gh: HTTP 502` for a
 * GraphQL call, `gh: Not Found (HTTP 404)` for REST — and offers nothing
 * machine-readable, so the text is the only source. The `HTTP` literal is
 * required: without it any three-digit run in an error message would parse as a
 * status, and a misread status decides whether we retry.
 */
export function parseHttpStatus(stderr: string): number | undefined {
  const m = /\bHTTP (\d{3})\b/.exec(stderr)
  return m ? Number(m[1]) : undefined
}

/**
 * Whether a status is worth re-attempting: server-side 5xx, plus 429.
 *
 * Deliberately narrow. 401/403/404/422 mean the request itself is wrong, and
 * retrying them spends minutes of backoff to reach the same answer while making
 * a misconfiguration look like slowness. A failure that reports no status at all
 * (DNS, a dropped socket, a missing binary) is likewise treated as permanent —
 * this exists for the failure actually observed, not for every way gh can fail.
 */
export function isTransientStatus(status: number | undefined): boolean {
  if (status === undefined) return false
  return status === 429 || (status >= 500 && status < 600)
}

export class GhError extends Error {
  /** The HTTP status gh reported, when its stderr named one. */
  readonly status: number | undefined

  constructor(message: string, readonly stderr = '') {
    super(message)
    this.name = 'GhError'
    this.status = parseHttpStatus(stderr)
  }

  /** Whether re-running the identical request could plausibly succeed. */
  get transient(): boolean {
    return isTransientStatus(this.status)
  }
}

/** The shape of `node:child_process`'s `execFile` that we depend on — swappable for tests. */
type ExecFileFn = (
  bin: string,
  args: string[],
  options: { maxBuffer: number },
  callback: (error: ExecFileException | null, stdout: string, stderr: string) => void,
) => void

interface GhOptions {
  /** Overridable for tests. */
  bin?: string
  /** Response bodies can be large; default 64 MB. */
  maxBuffer?: number
  /** Process-spawning seam, overridable for tests. Defaults to the real `execFile`. */
  exec?: ExecFileFn
}

/**
 * Runs `gh` with the given args and parses stdout as JSON.
 *
 * Auth is delegated entirely to the gh CLI, so no token is ever handled here.
 */
export function ghJson<T>(args: string[], opts: GhOptions = {}): Promise<T> {
  const bin = opts.bin ?? 'gh'
  const exec = opts.exec ?? execFile
  return new Promise<T>((resolve, reject) => {
    exec(bin, args, { maxBuffer: opts.maxBuffer ?? 64 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        const enoent = (err as NodeJS.ErrnoException).code === 'ENOENT'
        reject(
          new GhError(
            enoent
              ? `\`${bin}\` not found. Install the GitHub CLI: https://cli.github.com`
              : `\`${bin} ${args.join(' ')}\` failed: ${err.message}`,
            stderr,
          ),
        )
        return
      }
      try {
        resolve(JSON.parse(stdout) as T)
      } catch {
        reject(new GhError(`\`${bin} ${args.join(' ')}\` returned unparseable JSON`, stdout.slice(0, 500)))
      }
    })
  })
}

/** Fails fast with an actionable message if gh is missing or unauthenticated. */
export async function assertGhReady(opts: GhOptions = {}): Promise<void> {
  let login: string
  try {
    const viewer = await ghJson<{ login: string }>(['api', 'user', '--jq', '{login: .login}'], opts)
    login = viewer.login
  } catch (err) {
    const detail = err instanceof GhError ? `${err.message}\n${err.stderr}` : String(err)
    throw new GhError(
      `Cannot reach the GitHub API via gh. Run \`gh auth login\` and try again.\n\n${detail}`,
    )
  }
  if (!login) throw new GhError('gh returned no authenticated user. Run `gh auth login`.')
}
