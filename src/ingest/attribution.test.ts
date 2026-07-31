import { describe, it, expect } from 'vitest'
import { ownerRank, preferRepo, type OwnedIdentity } from './attribution'

const identity: OwnedIdentity = { login: 'markhinch', orgs: ['Huub-NL', 'modem-works'] }

/** A commit record reduced to the field attribution cares about. */
const at = (repo: string) => ({ sha: 'abc', repo, authoredAt: '2025-04-10T12:00:00.000+02:00' })

describe('ownerRank', () => {
  it('ranks own login above member orgs above strangers', () => {
    expect(ownerRank('markhinch/dotfiles', identity)).toBeLessThan(
      ownerRank('Huub-NL/huub', identity),
    )
    expect(ownerRank('Huub-NL/huub', identity)).toBeLessThan(
      ownerRank('sparshgaur369/Dream-Recorder', identity),
    )
  })

  it('compares owners case-insensitively, as GitHub logins are', () => {
    expect(ownerRank('huub-nl/huub', identity)).toBe(ownerRank('Huub-NL/huub', identity))
    expect(ownerRank('MarkHinch/x', identity)).toBe(ownerRank('markhinch/x', identity))
  })

  it('treats an unknown owner as foreign', () => {
    expect(ownerRank('Verity9939/dream-recorder', identity)).toBeGreaterThan(
      ownerRank('modem-works/dream-recorder', identity),
    )
  })
})

describe('preferRepo', () => {
  it('keeps a single candidate unchanged', () => {
    expect(preferRepo(undefined, at('modem-works/dream-recorder'), identity).repo)
      .toBe('modem-works/dream-recorder')
  })

  it('prefers a member org over a stranger fork', () => {
    const kept = preferRepo(
      at('modem-works/dream-recorder'),
      at('sparshgaur369/Dream-Recorder'),
      identity,
    )
    expect(kept.repo).toBe('modem-works/dream-recorder')
  })

  it('prefers a member org over a stranger fork regardless of arrival order', () => {
    // The order-independence property: page order varies between runs, so the
    // stranger arriving first must not win.
    const kept = preferRepo(
      at('sparshgaur369/Dream-Recorder'),
      at('modem-works/dream-recorder'),
      identity,
    )
    expect(kept.repo).toBe('modem-works/dream-recorder')
  })

  it('prefers the own login over a member org, both ways round', () => {
    expect(preferRepo(at('Huub-NL/tool'), at('markhinch/tool'), identity).repo)
      .toBe('markhinch/tool')
    expect(preferRepo(at('markhinch/tool'), at('Huub-NL/tool'), identity).repo)
      .toBe('markhinch/tool')
  })

  it('breaks a same-rank tie by smallest repo, asserted both ways round', () => {
    const a = at('Huub-NL/alpha')
    const b = at('modem-works/beta')
    expect(preferRepo(a, b, identity).repo).toBe('Huub-NL/alpha')
    expect(preferRepo(b, a, identity).repo).toBe('Huub-NL/alpha')
  })

  it('breaks a tie between two stranger forks stably, asserted both ways round', () => {
    const a = at('Verity9939/dream-recorder')
    const b = at('sparshgaur369/Dream-Recorder')
    expect(preferRepo(a, b, identity).repo).toBe('Verity9939/dream-recorder')
    expect(preferRepo(b, a, identity).repo).toBe('Verity9939/dream-recorder')
  })

  it('keeps a commit that exists only under a stranger fork', () => {
    // Dropping it would lose real authored work; only the count of copies is
    // ambiguous, never whether the commit happened.
    const kept = preferRepo(undefined, at('someone-else/private-fork'), identity)
    expect(kept.repo).toBe('someone-else/private-fork')
  })

  it('is order-independent across every permutation of a fork network', () => {
    // The real dream-recorder case: three copies, one of them ours.
    const repos = [
      'modem-works/dream-recorder',
      'sparshgaur369/Dream-Recorder',
      'Verity9939/dream-recorder',
    ]
    const permutations = [
      [0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0],
    ]
    for (const order of permutations) {
      const kept = order.reduce<ReturnType<typeof at> | undefined>(
        (acc, i) => preferRepo(acc, at(repos[i]!), identity),
        undefined,
      )
      expect(kept?.repo).toBe('modem-works/dream-recorder')
    }
  })

  it('is idempotent when the same repo arrives twice', () => {
    const first = at('Huub-NL/huub')
    expect(preferRepo(first, at('Huub-NL/huub'), identity)).toBe(first)
  })

  it('falls back to the deterministic tiebreak when the user belongs to no orgs', () => {
    const soloIdentity: OwnedIdentity = { login: 'markhinch', orgs: [] }
    const kept = preferRepo(
      at('modem-works/dream-recorder'),
      at('Verity9939/dream-recorder'),
      soloIdentity,
    )
    // Both foreign now, so the smallest repo wins — still never arrival order.
    expect(kept.repo).toBe('Verity9939/dream-recorder')
    expect(
      preferRepo(at('Verity9939/dream-recorder'), at('modem-works/dream-recorder'), soloIdentity)
        .repo,
    ).toBe('Verity9939/dream-recorder')
  })
})
