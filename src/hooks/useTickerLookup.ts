import { useEffect, useState } from 'react'
import { fetchIdeaBySymbol, IdeaLookupNotFoundError } from '../adapters/providers/liveFetch'
import {
  IDEA_LOOKUP_DEBOUNCE_MS,
  peekClientIdeaLookup,
  rememberClientIdeaLookup,
} from '../lib/ideaLookup'
import { parseTickerLikeSearch } from '../lib/tickerSymbol'
import type { TradingIdea } from '../types'

export type TickerLookupStatus = 'idle' | 'loading' | 'ok' | 'not-found'

export interface TickerLookupState {
  symbol: string | null
  status: TickerLookupStatus
  idea: TradingIdea | null
}

const IDLE: TickerLookupState = { symbol: null, status: 'idle', idea: null }

function fromCache(symbol: string): TickerLookupState | null {
  const cached = peekClientIdeaLookup(symbol)
  if (!cached) return null
  return cached.ok
    ? { symbol, status: 'ok', idea: { ...cached.idea, outsideScan: true } }
    : { symbol, status: 'not-found', idea: null }
}

/**
 * When the search box looks like a ticker and that exact symbol is not in the
 * scanned pool, debounce then GET /api/market/idea/:symbol.
 * Demo mode sets `enabled` false.
 */
export function useTickerLookup(opts: {
  search: string
  poolTickers: ReadonlySet<string>
  enabled: boolean
}): TickerLookupState {
  const symbol = parseTickerLikeSearch(opts.search)
  const inPool = Boolean(symbol && opts.poolTickers.has(symbol))
  const active = Boolean(opts.enabled && symbol && !inPool)
  const cached = active && symbol ? fromCache(symbol) : null
  const [fetched, setFetched] = useState<TickerLookupState>(IDLE)

  useEffect(() => {
    if (!active || !symbol) return
    if (peekClientIdeaLookup(symbol)) return
    const ac = new AbortController()
    let cancelled = false
    const timer = setTimeout(() => {
      if (cancelled) return
      setFetched({ symbol, status: 'loading', idea: null })
      void fetchIdeaBySymbol(symbol, { signal: ac.signal })
        .then((body) => {
          rememberClientIdeaLookup(symbol, { ok: true, idea: body.idea })
          if (cancelled) return
          setFetched({
            symbol,
            status: 'ok',
            idea: { ...body.idea, outsideScan: true },
          })
        })
        .catch((err) => {
          if (cancelled) return
          if (err instanceof Error && err.name === 'AbortError') return
          const notFound = err instanceof IdeaLookupNotFoundError
          if (notFound) rememberClientIdeaLookup(symbol, { ok: false })
          setFetched({
            symbol,
            status: notFound ? 'not-found' : 'idle',
            idea: null,
          })
        })
    }, IDEA_LOOKUP_DEBOUNCE_MS)

    return () => {
      cancelled = true
      clearTimeout(timer)
      ac.abort()
    }
  }, [active, symbol])

  if (!active || !symbol) return IDLE
  if (cached) return cached
  if (fetched.symbol === symbol) return fetched
  return { symbol, status: 'idle', idea: null }
}
