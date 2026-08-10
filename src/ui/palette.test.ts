import { describe, it, expect } from 'vitest'
import { OTHER_KEY } from '../core/topRepos'
import { MAX_SERIES, segmentColors } from './palette'

describe('segmentColors', () => {
  it('assigns the categorical slots in stack order', () => {
    expect(segmentColors(['o/a', 'o/b'], false)).toEqual({
      'o/a': 'var(--color-series-1)',
      'o/b': 'var(--color-series-2)',
    })
  })

  it('gives Other the neutral, never a categorical slot', () => {
    const colors = segmentColors(['o/a'], true)
    expect(colors[OTHER_KEY]).toBe('var(--color-series-other)')
    expect(colors['o/a']).toBe('var(--color-series-1)')
  })

  it('omits Other when there is none', () => {
    expect(segmentColors(['o/a'], false)).not.toHaveProperty(OTHER_KEY)
  })

  it('covers a full stack at the maximum', () => {
    const repos = Array.from({ length: MAX_SERIES }, (_, i) => `o/${i}`)
    const colors = segmentColors(repos, true)
    expect(Object.keys(colors)).toHaveLength(MAX_SERIES + 1)
    expect(colors[`o/${MAX_SERIES - 1}`]).toBe(`var(--color-series-${MAX_SERIES})`)
  })

  it('throws rather than cycling hues past the last slot', () => {
    const repos = Array.from({ length: MAX_SERIES + 1 }, (_, i) => `o/${i}`)
    expect(() => segmentColors(repos, false)).toThrow(/MAX_SERIES/)
  })

  it('is the palette size the fold should be limited to', () => {
    expect(MAX_SERIES).toBe(5)
  })
})
