import { describe, it, expect } from 'vitest'
import { RateLimiter } from './ratelimit'

/** Deterministic fake clock: sleeping advances virtual time instantly. */
function fakeClock() {
  let t = 0
  return {
    now: () => t,
    sleep: async (ms: number) => { t += ms },
    advance: (ms: number) => { t += ms },
    get time() { return t },
  }
}

describe('RateLimiter', () => {
  it('allows the first burst up to the limit without waiting', async () => {
    const c = fakeClock()
    const rl = new RateLimiter(28, c)
    for (let i = 0; i < 28; i++) await rl.acquire()
    expect(c.time).toBe(0)
  })

  it('delays the request that would exceed the limit', async () => {
    const c = fakeClock()
    const rl = new RateLimiter(3, c)
    await rl.acquire()
    await rl.acquire()
    await rl.acquire()
    expect(c.time).toBe(0)
    await rl.acquire()
    // Must wait until the oldest of the 3 timestamps falls outside the window.
    expect(c.time).toBeGreaterThanOrEqual(60_000)
  })

  it('never exceeds the limit in any 60s window', async () => {
    const c = fakeClock()
    const rl = new RateLimiter(5, c)
    const stamps: number[] = []
    for (let i = 0; i < 20; i++) {
      await rl.acquire()
      stamps.push(c.time)
    }
    for (const s of stamps) {
      const inWindow = stamps.filter((o) => o > s - 60_000 && o <= s).length
      expect(inWindow).toBeLessThanOrEqual(5)
    }
  })

  it('honours an externally requested pause', async () => {
    const c = fakeClock()
    const rl = new RateLimiter(28, c)
    rl.pauseFor(5_000)
    await rl.acquire()
    expect(c.time).toBeGreaterThanOrEqual(5_000)
  })
})
