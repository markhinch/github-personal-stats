import { realpathSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/**
 * True when the module identified by `moduleUrl` is the process entry point,
 * rather than something a test or another module imported.
 *
 * Exists so a CLI module can be imported without running its `main()`. Both
 * inputs are injected (`process.argv[1]`, `import.meta.url`) so this can be
 * tested directly — importing the CLI itself to test its guard would mean the
 * test's safety depended on the very thing under test, and here that thing
 * guards ~104 live API requests against a real account.
 *
 * Compares real paths so a symlinked invocation still matches. A path that
 * cannot be resolved is not the entry point.
 */
export function isEntryPoint(argv1: string | undefined, moduleUrl: string): boolean {
  if (!argv1) return false
  try {
    return realpathSync(argv1) === realpathSync(fileURLToPath(moduleUrl))
  } catch {
    return false
  }
}
