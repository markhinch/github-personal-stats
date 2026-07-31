import { useEffect, useState } from 'react'
import type { Dataset } from '../core/types'

/**
 * Every way loading `/data.json` can fail. `public/data.json` has no producer
 * other than `pnpm sync` — it is never hand-written, never fetched from
 * anywhere else — so every one of these kinds resolves to the same remedy.
 * Kept as a closed set (rather than passing the raw Error/Response through)
 * so the failure message can never leak internals like a JSON parser's
 * "Unexpected token '<'" (the actual bug this shape replaced: a dev server's
 * SPA fallback returns index.html with a 200, so `r.ok` is true and only
 * `r.json()` fails).
 */
export type DatasetLoadFailure =
  | { kind: 'network' }
  | { kind: 'http'; status: number }
  | { kind: 'parse' }
  | { kind: 'schema' }

/**
 * Maps a load failure to the one user-facing message. Pure and exported so
 * every failure shape is regression-tested directly, without a fetch/DOM
 * harness — see useDataset.test.ts.
 */
export function datasetErrorMessage(_failure: DatasetLoadFailure): string {
  return "Couldn't load your GitHub activity. Run `pnpm sync` to (re)generate it, then reload."
}

export function parseDataset(json: unknown): Dataset {
  const o = json as Partial<Dataset> | null
  if (!o || !Array.isArray(o.commits) || !Array.isArray(o.mergedPrs)) {
    throw new Error(datasetErrorMessage({ kind: 'schema' }))
  }
  return {
    commits: o.commits,
    mergedPrs: o.mergedPrs,
    meta: o.meta ?? { syncedAt: '', rangeStart: '', rangeEnd: '' },
  }
}

export type DatasetState =
  | { status: 'loading' }
  | { status: 'ready'; dataset: Dataset }
  | { status: 'error'; message: string }

export function useDataset(): DatasetState {
  const [state, setState] = useState<DatasetState>({ status: 'loading' })

  useEffect(() => {
    let cancelled = false

    const fail = (failure: DatasetLoadFailure): void => {
      if (!cancelled) setState({ status: 'error', message: datasetErrorMessage(failure) })
    }

    async function load(): Promise<void> {
      let response: Response
      try {
        response = await fetch('/data.json')
      } catch {
        fail({ kind: 'network' })
        return
      }

      if (!response.ok) {
        fail({ kind: 'http', status: response.status })
        return
      }

      let json: unknown
      try {
        json = await response.json()
      } catch {
        fail({ kind: 'parse' })
        return
      }

      try {
        const dataset = parseDataset(json)
        if (!cancelled) setState({ status: 'ready', dataset })
      } catch {
        fail({ kind: 'schema' })
      }
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [])

  return state
}
