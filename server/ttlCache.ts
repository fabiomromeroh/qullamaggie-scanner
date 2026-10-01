/** Pure TTL helpers plus a small in-memory per-key cache with in-flight de-dup. */

export function isFresh(at: number, ttlMs: number, now = Date.now()): boolean {
  return now - at < ttlMs
}

export interface SymbolCacheOptions<T> {
  ttlMs: number
  /** Used when `isNegative(value)` is true. */
  negativeTtlMs?: number
  isNegative?: (value: T) => boolean
  /** If a refresh throws and a previous value exists, return that value. */
  staleOnError?: boolean
}

export function createSymbolCache<T>(opts: SymbolCacheOptions<T>) {
  const map = new Map<string, { at: number; value: T }>()
  const inflight = new Map<string, Promise<T>>()

  function ttlFor(value: T): number {
    if (opts.isNegative?.(value) && opts.negativeTtlMs != null) return opts.negativeTtlMs
    return opts.ttlMs
  }

  async function get(
    key: string,
    loader: () => Promise<T>,
    now: () => number = Date.now,
  ): Promise<T> {
    const hit = map.get(key)
    if (hit && isFresh(hit.at, ttlFor(hit.value), now())) return hit.value
    const existing = inflight.get(key)
    if (existing) return existing

    const pending = (async () => {
      try {
        const value = await loader()
        map.set(key, { at: now(), value })
        return value
      } catch (err) {
        if (opts.staleOnError && hit) return hit.value
        throw err
      } finally {
        inflight.delete(key)
      }
    })()
    inflight.set(key, pending)
    return pending
  }

  return {
    get,
    peek: (key: string) => map.get(key),
    size: () => map.size,
    clear: () => {
      map.clear()
      inflight.clear()
    },
  }
}
