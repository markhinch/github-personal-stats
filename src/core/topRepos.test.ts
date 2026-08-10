import { describe, it, expect } from 'vitest'
import type { RepoPoint } from './aggregate'
import { OTHER_KEY, foldToTopRepos } from './topRepos'

/** Builds one bucket from a repo -> value map. */
const point = (key: string, byRepo: Record<string, number>): RepoPoint => ({
  key,
  label: key,
  total: Object.values(byRepo).reduce((a, b) => a + b, 0),
  byRepo,
})

describe('foldToTopRepos', () => {
  it('ranks repos by their total across the window, largest first', () => {
    const stack = foldToTopRepos(
      [point('a', { 'o/small': 1, 'o/big': 10 }), point('b', { 'o/small': 2, 'o/big': 1 })],
      5,
    )
    expect(stack.repos).toEqual(['o/big', 'o/small'])
  })

  it('ranks on the window total, not on any single bucket', () => {
    // o/steady never wins a bucket outright but wins the window.
    const stack = foldToTopRepos(
      [point('a', { 'o/spike': 9, 'o/steady': 5 }), point('b', { 'o/steady': 5 })],
      5,
    )
    expect(stack.repos).toEqual(['o/steady', 'o/spike'])
  })

  it('breaks ties on repo id ascending so the order is deterministic', () => {
    const stack = foldToTopRepos([point('a', { 'o/b': 5, 'o/a': 5, 'o/c': 5 })], 5)
    expect(stack.repos).toEqual(['o/a', 'o/b', 'o/c'])
  })

  it('keeps the top `limit` and folds the rest into Other', () => {
    const stack = foldToTopRepos(
      [point('a', { 'o/1': 10, 'o/2': 9, 'o/3': 8, 'o/4': 7, 'o/5': 6, 'o/6': 5, 'o/7': 4 })],
      5,
    )
    expect(stack.repos).toEqual(['o/1', 'o/2', 'o/3', 'o/4', 'o/5'])
    expect(stack.hasOther).toBe(true)
    expect(stack.points[0]?.values[OTHER_KEY]).toBe(9)
  })

  it('has no Other segment at exactly the limit', () => {
    const stack = foldToTopRepos([point('a', { 'o/1': 3, 'o/2': 2, 'o/3': 1 })], 3)
    expect(stack.hasOther).toBe(false)
    expect(stack.points[0]?.values).not.toHaveProperty(OTHER_KEY)
  })

  it('writes an explicit zero for a repo absent from a bucket', () => {
    const stack = foldToTopRepos([point('a', { 'o/x': 1 }), point('b', { 'o/y': 1 })], 5)
    expect(stack.points[0]?.values).toEqual({ 'o/x': 1, 'o/y': 0 })
  })

  it('carries key, label and total through unchanged', () => {
    const stack = foldToTopRepos([point('2026-07', { 'o/x': 4 })], 5)
    expect(stack.points[0]).toMatchObject({ key: '2026-07', label: '2026-07', total: 4 })
  })

  it('returns an empty stack for empty input', () => {
    expect(foldToTopRepos([], 5)).toEqual({ repos: [], hasOther: false, points: [] })
  })

  it('names no repos for a window in which nothing happened', () => {
    // Gap-filled buckets are real points with no repos — not the same as no data.
    const stack = foldToTopRepos([point('a', {}), point('b', {})], 5)
    expect(stack.repos).toEqual([])
    expect(stack.hasOther).toBe(false)
    expect(stack.points).toHaveLength(2)
  })
})
