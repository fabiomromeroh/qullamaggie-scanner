/**
 * Client cache for GET /api/market/idea/:symbol.
 * Server TTL is the same {@link IDEA_LOOKUP_TTL_MS}.
 */
import type { TradingIdea } from '../types'

export const IDEA_LOOKUP_TTL_MS = 10 * 60 * 1000
export const IDEA_LOOKUP_DEBOUNCE_MS = 500

export type ClientIdeaLookupHit =
  | { ok: true; idea: TradingIdea; at: number }
  | { ok: false; at: number }

const cache = new Map<string, ClientIdeaLookupHit>()

export function peekClientIdeaLookup(
  symbol: string,
  now = Date.now(),
): ClientIdeaLookupHit | null {
  const key = symbol.trim().toUpperCase()
  const hit = cache.get(key)
  if (!hit) return null
  if (now - hit.at >= IDEA_LOOKUP_TTL_MS) {
    cache.delete(key)
    return null
  }
  return hit
}

export function rememberClientIdeaLookup(
  symbol: string,
  value: { ok: true; idea: TradingIdea } | { ok: false },
  now = Date.now(),
): void {
  const key = symbol.trim().toUpperCase()
  cache.set(key, { ...value, at: now })
}

export function clearClientIdeaLookupCache(): void {
  cache.clear()
}
