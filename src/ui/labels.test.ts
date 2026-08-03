import { describe, it, expect } from 'vitest'
import { labelledIndices } from './labels'

const sorted = (s: Set<number>): number[] => [...s].sort((a, b) => a - b)

/** More buckets than labels fit, so these exercise the dense fallback. */
const dense = (values: number[]): number[] => [...Array(40).fill(1), ...values]

describe('labelledIndices — every bar fits', () => {
  it('labels every bar', () => {
    expect(sorted(labelledIndices([5, 3, 9, 1]))).toEqual([0, 1, 2, 3])
  })

  it('skips empty buckets', () => {
    expect(sorted(labelledIndices([5, 0, 9]))).toEqual([0, 2])
  })

  it('labels nothing for an empty series', () => {
    expect(labelledIndices([]).size).toBe(0)
  })

  it('labels nothing when every bucket is empty', () => {
    expect(labelledIndices([0, 0, 0]).size).toBe(0)
  })
})

describe('labelledIndices — too many bars to label', () => {
  it('falls back to the peak and the latest bucket', () => {
    const values = dense([999, 2, 3])
    expect(sorted(labelledIndices(values))).toEqual([40, 42])
  })

  it('labels one bar when the peak is also the latest', () => {
    const values = dense([2, 3, 999])
    expect(sorted(labelledIndices(values))).toEqual([42])
  })

  it('walks back past trailing empty buckets to the last real one', () => {
    const values = dense([999, 7, 0, 0])
    expect(sorted(labelledIndices(values))).toEqual([40, 41])
  })

  it('labels the first of two equal peaks', () => {
    const values = dense([500, 500, 1])
    expect(sorted(labelledIndices(values))).toEqual([40, 42])
  })

  it('labels nothing when every bucket is empty', () => {
    expect(labelledIndices(Array(40).fill(0)).size).toBe(0)
  })
})
