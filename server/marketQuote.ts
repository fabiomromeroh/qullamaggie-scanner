/**
 * GET /api/market/quote/:symbol — last price, prior close, 1D %.
 * Uses fetchSymbolSnapshot (existing cascade) and resolvePrevClose via the
 * snapshot's prevClose. Cache {@link QUOTE_CACHE_TTL_MS} (~60s).
 */
import {
  buildQuotePayload,
  QUOTE_CACHE_TTL_MS,
  type QuotePayload,
} from '../src/lib/marketQuote.ts'
import { createSymbolCache } from './ttlCache.ts'

export { QUOTE_CACHE_TTL_MS, buildQuotePayload, shapeQuotePayload } from '../src/lib/marketQuote.ts'
export type { QuotePayload } from '../src/lib/marketQuote.ts'

export interface QuoteSnapshotLike {
  symbol: string
  price: number
  prevClose: number
  provider: string
}

const quoteCache = createSymbolCache<QuotePayload>({ ttlMs: QUOTE_CACHE_TTL_MS })

export type QuoteSnapshotLoader = (symbol: string) => Promise<QuoteSnapshotLike>

export async function getQuoteForSymbol(
  symbol: string,
  loadSnapshot: QuoteSnapshotLoader,
  asOf: () => string = () => new Date().toISOString(),
): Promise<QuotePayload> {
  return quoteCache.get(symbol, async () => {
    const snap = await loadSnapshot(symbol)
    const payload = buildQuotePayload(
      {
        symbol: snap.symbol,
        price: snap.price,
        prevClose: snap.prevClose,
        source: snap.provider,
      },
      asOf,
    )
    if (!payload) {
      throw new Error(`No quote for ${symbol}`)
    }
    return payload
  })
}

export function clearQuoteCache(): void {
  quoteCache.clear()
}
