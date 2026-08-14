/** A single commit authored by the user. */
export interface CommitRecord {
  sha: string
  /** "owner/name" */
  repo: string
  /** ISO 8601 retaining the commit's original UTC offset, e.g. "2026-07-22T16:05:11.000+02:00" */
  authoredAt: string
}

/** A merged pull request, used only for the lines-changed metric. */
export interface MergedPrRecord {
  /** "owner/name" */
  repo: string
  /** ISO 8601, always UTC ("...Z") — GraphQL does not expose an offset. */
  mergedAt: string
  additions: number
  deletions: number
}

export interface DatasetMeta {
  syncedAt: string
  rangeStart: string
  rangeEnd: string
}

export interface Dataset {
  commits: CommitRecord[]
  mergedPrs: MergedPrRecord[]
  meta: DatasetMeta
}

export type Bucket = 'day' | 'week' | 'month'
export type Metric = 'commits' | 'lines'
/** Whether bars are drawn as one total or split by repository. */
export type Split = 'none' | 'repo'

/** A timezone-free calendar date. Month is 1-12, day is 1-31. */
export interface LocalDate {
  year: number
  month: number
  day: number
}

export interface SeriesPoint {
  /** Sortable bucket identity, e.g. "2026-W31" or "2026-07". */
  key: string
  /** Human label, e.g. "W31 2026" or "Jul 2026". */
  label: string
  value: number
}
