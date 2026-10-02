import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  createConcurrencyPool,
  fetchMarketQuote,
  forgetSessionQuote,
  peekSessionQuote,
  rememberSessionQuote,
  viewFromQuoteError,
  WATCHLIST_QUOTE_CONCURRENCY,
  type QuoteView,
} from '../lib/watchlistQuotes'

export function useWatchlistQuotes(
  tickers: readonly string[],
  inScan: ReadonlyMap<string, unknown> | ReadonlySet<string>,
): { quotes: Record<string, QuoteView>; retry: (ticker: string) => void } {
  const [quotes, setQuotes] = useState<Record<string, QuoteView>>({})
  const quotesRef = useRef(quotes)

  useEffect(() => {
    quotesRef.current = quotes
  }, [quotes])

  const neededKey = useMemo(() => {
    const out: string[] = []
    for (const ticker of tickers) {
      if (!inScan.has(ticker)) out.push(ticker)
    }
    return out.join('\0')
  }, [tickers, inScan])

  useEffect(() => {
    let cancelled = false
    const pool = createConcurrencyPool(WATCHLIST_QUOTE_CONCURRENCY)
    const list = neededKey ? neededKey.split('\0') : []
    const next: Record<string, QuoteView> = { ...quotesRef.current }
    const toFetch: string[] = []

    for (const symbol of list) {
      const cached = peekSessionQuote(symbol)
      if (cached) {
        next[symbol] = { status: 'ok', quote: cached }
        continue
      }
      const current = next[symbol]
      if (current?.status === 'ok' || current?.status === 'loading') continue
      next[symbol] = { status: 'loading' }
      toFetch.push(symbol)
    }

    setQuotes(next)

    for (const symbol of toFetch) {
      void pool.run(async () => {
        try {
          const quote = await fetchMarketQuote(symbol)
          rememberSessionQuote(symbol, quote)
          if (cancelled) return
          setQuotes((prev) => ({ ...prev, [symbol]: { status: 'ok', quote } }))
        } catch (err) {
          if (cancelled) return
          setQuotes((prev) => ({ ...prev, [symbol]: viewFromQuoteError(err) }))
        }
      })
    }

    return () => {
      cancelled = true
    }
  }, [neededKey])

  const retry = useCallback((ticker: string) => {
    const symbol = ticker.toUpperCase()
    forgetSessionQuote(symbol)
    setQuotes((prev) => ({ ...prev, [symbol]: { status: 'loading' } }))
    void fetchMarketQuote(symbol)
      .then((quote) => {
        rememberSessionQuote(symbol, quote)
        setQuotes((prev) => ({ ...prev, [symbol]: { status: 'ok', quote } }))
      })
      .catch((err) => {
        setQuotes((prev) => ({ ...prev, [symbol]: viewFromQuoteError(err) }))
      })
  }, [])

  return { quotes, retry }
}
