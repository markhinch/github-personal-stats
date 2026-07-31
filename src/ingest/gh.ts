import { execFile, type ExecFileException } from 'node:child_process'

export class GhError extends Error {
  constructor(message: string, readonly stderr = '') {
    super(message)
    this.name = 'GhError'
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
