import { useEffect, useState, type Dispatch, type SetStateAction } from 'react'
import { browserStore, readPrefs, writePrefs, type Prefs } from './prefs'

// Resolved once per page load rather than per render: whether localStorage is
// reachable cannot change while the tab is open.
const store = browserStore()

/**
 * The control state, seeded from localStorage on first render and written back
 * whenever it changes. Reading during the initial `useState` (not in an effect)
 * means the first paint already shows the restored options — the chart never
 * flashes the defaults and then re-renders.
 *
 * All the reading, validating, and writing lives in prefs.ts, where it is
 * covered directly; this hook is only the React plumbing around it.
 */
export function usePrefs(): [Prefs, Dispatch<SetStateAction<Prefs>>] {
  const [prefs, setPrefs] = useState<Prefs>(() => readPrefs(store))

  useEffect(() => {
    writePrefs(store, prefs)
  }, [prefs])

  return [prefs, setPrefs]
}
