import { useEffect, useState } from 'react'
import type { Dataset } from '../core/types'

const MISSING =
  'No dataset found. Run `pnpm sync` to fetch your GitHub activity, then reload.'

export function parseDataset(json: unknown): Dataset {
  const o = json as Partial<Dataset> | null
  if (!o || !Array.isArray(o.commits) || !Array.isArray(o.mergedPrs)) {
    throw new Error(MISSING)
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
    fetch('/data.json')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(MISSING))))
      .then((json) => {
        if (!cancelled) setState({ status: 'ready', dataset: parseDataset(json) })
      })
      .catch(() => {
        // Every failure here — network error, non-200, a dev-server SPA
        // fallback serving index.html with a 200 that then fails to parse
        // as JSON, or a malformed dataset shape — has the same one remedy.
        // Surfacing the raw error (a JSON SyntaxError, say) would be noise.
        if (!cancelled) setState({ status: 'error', message: MISSING })
      })
    return () => {
      cancelled = true
    }
  }, [])

  return state
}
