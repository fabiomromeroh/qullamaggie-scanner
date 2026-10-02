/**
 * Pure rate-limit helpers. The catalyst fetcher uses the same classes so
 * tests can drive a fake clock without opening sockets.
 */

export class TokenBucket {
  private stamps: number[] = []
  private readonly maxPerWindow: number
  private readonly windowMs: number

  constructor(maxPerWindow: number, windowMs: number) {
    this.maxPerWindow = maxPerWindow
    this.windowMs = windowMs
  }

  /** Drop stamps whose age is >= windowMs (half-open window). */
  private prune(now: number): void {
    const cutoff = now - this.windowMs
    this.stamps = this.stamps.filter((stamp) => stamp > cutoff)
  }

  /** 0 when a token is available. Otherwise ms until the oldest stamp expires. */
  delayMs(now: number): number {
    this.prune(now)
    if (this.stamps.length < this.maxPerWindow) return 0
    const oldest = this.stamps[0] ?? now
    return Math.max(0, oldest + this.windowMs - now)
  }

  /** Take a token at `now` only when {@link delayMs} is 0. */
  tryTake(now: number): boolean {
    if (this.delayMs(now) !== 0) return false
    this.stamps.push(now)
    return true
  }

  countAt(now: number): number {
    this.prune(now)
    return this.stamps.length
  }
}

/**
 * Largest number of stamps inside any half-open window of `windowMs`.
 * A pair whose difference is >= windowMs is not in the same window.
 */
export function maxInAnyWindow(stamps: readonly number[], windowMs: number): number {
  if (!stamps.length) return 0
  const sorted = [...stamps].sort((a, b) => a - b)
  let best = 0
  let left = 0
  for (let right = 0; right < sorted.length; right += 1) {
    while ((sorted[right] ?? 0) - (sorted[left] ?? 0) >= windowMs) left += 1
    best = Math.max(best, right - left + 1)
  }
  return best
}

export interface JobQueue {
  acquire(): Promise<void>
  release(): void
  readonly active: number
}

/**
 * Concurrency gate. The permit is incremented synchronously before the first
 * await when a slot is free, and a released slot is reserved for the next
 * waiter before that waiter resumes, so two callers cannot both pass.
 */
export function createJobQueue(concurrency: number): JobQueue {
  let active = 0
  const waiters: Array<() => void> = []
  return {
    async acquire() {
      if (active >= concurrency) {
        await new Promise<void>((resolve) => {
          waiters.push(resolve)
        })
        return
      }
      active += 1
    },
    release() {
      active -= 1
      const next = waiters.shift()
      if (next) {
        active += 1
        next()
      }
    },
    get active() {
      return active
    },
  }
}
