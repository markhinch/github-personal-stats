import { orgOf } from '../core/orgs'

/**
 * The authenticated user's own owner names, used to decide which repository a
 * commit should be filed under.
 *
 * Discovered at runtime by the caller (login + `gh api user/orgs`) rather than
 * hardcoded, so the ranking follows the human's real memberships as they join
 * and leave orgs.
 */
export interface OwnedIdentity {
  /** The authenticated user's login. */
  login: string
  /** Orgs the authenticated user is a member of. */
  orgs: string[]
}

/** Lower is better. Kept as named constants so the ordering reads at the call site. */
const RANK_OWN_LOGIN = 0
const RANK_MEMBER_ORG = 1
const RANK_FOREIGN = 2

/**
 * How strongly a repo's owner suggests this is "our" copy of a commit.
 *
 * GitHub logins are case-insensitive, so the comparison is too — otherwise
 * `Huub-NL/huub` and `huub-nl/huub` would rank differently.
 */
export function ownerRank(repo: string, identity: OwnedIdentity): number {
  const owner = orgOf(repo).toLowerCase()
  if (owner === identity.login.toLowerCase()) return RANK_OWN_LOGIN
  if (identity.orgs.some((o) => o.toLowerCase() === owner)) return RANK_MEMBER_ORG
  return RANK_FOREIGN
}

/**
 * Chooses which repository a commit seen under several repositories should be
 * attributed to.
 *
 * GitHub's commit search returns one row per (commit x repository), so a commit
 * in a fork network arrives once per copy. Keeping whichever arrived last made
 * the attribution depend on page order, which surfaced strangers' forks as
 * phantom organisations in the org filter — the UI's primary control.
 *
 * The rule: prefer our own login, then an org we belong to, then anything else;
 * within a rank prefer the lexicographically smallest `repo`. A foreign-only
 * commit is still kept — it is real work, and dropping it would lose a commit.
 *
 * Deterministic and order-independent by construction: the result is a
 * minimum under a total ordering, so any arrival order yields the same answer,
 * including across separate runs where `current` came from the cache.
 */
export function preferRepo<T extends { repo: string }>(
  current: T | undefined,
  candidate: T,
  identity: OwnedIdentity,
): T {
  if (current === undefined) return candidate
  if (current.repo === candidate.repo) return current

  const currentRank = ownerRank(current.repo, identity)
  const candidateRank = ownerRank(candidate.repo, identity)
  if (candidateRank !== currentRank) return candidateRank < currentRank ? candidate : current

  // Same rank: a stable tiebreak, so re-running never shifts the org split.
  return candidate.repo < current.repo ? candidate : current
}
