const WINDOW_MS = 60_000

const realSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms))

interface Deps {
  now?: () => number
  sleep?: (ms: number) => Promise<void>
}

/**
 * Sliding-window rate limiter.
 *
 * The GitHub Search API allows 30 requests/min; callers should construct this
 * with 28 to leave headroom for clock skew and retries.
 */
export class RateLimiter {
  private readonly stamps: number[] = []
  private pausedUntil = 0
  private readonly now: () => number
  private readonly sleep: (ms: number) => Promise<void>

  constructor(private readonly perMinute: number, deps: Deps = {}) {
    if (perMinute < 1) throw new Error(`perMinute must be >= 1, got ${perMinute}`)
    this.now = deps.now ?? Date.now
    this.sleep = deps.sleep ?? realSleep
  }

  /** Requests a backoff pause, e.g. in response to a Retry-After header. */
  pauseFor(ms: number): void {
    this.pausedUntil = Math.max(this.pausedUntil, this.now() + ms)
  }

  /** Resolves when it is safe to issue another request. */
  async acquire(): Promise<void> {
    for (;;) {
      const now = this.now()

      if (now < this.pausedUntil) {
        await this.sleep(this.pausedUntil - now)
        continue
      }

      // Drop timestamps that have aged out of the window.
      while (this.stamps.length > 0 && this.stamps[0]! <= now - WINDOW_MS) this.stamps.shift()

      if (this.stamps.length < this.perMinute) {
        this.stamps.push(now)
        return
      }

      // +1ms so the oldest stamp is strictly outside the window on the retry.
      await this.sleep(this.stamps[0]! + WINDOW_MS - now + 1)
    }
  }
}
