/**
 * Shared quote payload for watchlist rows that are not in the current scan.
 * Server caches GET /api/market/quote/:symbol for {@link QUOTE_CACHE_TTL_MS}.
 */
import { MARKET_SYMBOL_RE } from './tickerSymbol'

export const QUOTE_CACHE_TTL_MS = 60_000
export const WATCHLIST_QUOTE_CONCURRENCY = 3

export interface QuotePayload {
  symbol: string
  price: number
  prevClose: number
  dayPct: number
  asOf: string
  source: string
}

function finitePositive(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

/** Day % from last price vs previous regular-session close. Null when either is unusable. */
export function dayPctFromQuote(price: number, prevClose: number): number | null {
  if (!(price > 0) || !(prevClose > 0)) return null
  return round2((price / prevClose - 1) * 100)
}

export interface QuoteShapeInput {
  symbol: string
  price: number
  prevClose: number
  source: string
  asOf?: string
}

/**
 * Build a quote payload. Computes dayPct from price / prevClose.
 * Returns null when required fields are missing or non-positive — never invents numbers.
 */
export function buildQuotePayload(
  input: QuoteShapeInput,
  asOf: () => string = () => new Date().toISOString(),
): QuotePayload | null {
  const symbol = input.symbol.trim().toUpperCase()
  if (!MARKET_SYMBOL_RE.test(symbol)) return null
  const price = finitePositive(input.price)
  const prevClose = finitePositive(input.prevClose)
  const source = input.source.trim()
  if (price == null || prevClose == null || !source) return null
  const dayPct = dayPctFromQuote(price, prevClose)
  if (dayPct == null) return null
  const stamp = input.asOf?.trim() || asOf()
  return { symbol, price, prevClose, dayPct, asOf: stamp, source }
}

/** Validate a JSON body (server response or test fixture). Wrong shape → null. */
export function shapeQuotePayload(raw: unknown): QuotePayload | null {
  if (!raw || typeof raw !== 'object') return null
  const row = raw as Record<string, unknown>
  if (typeof row.symbol !== 'string') return null
  if (typeof row.price !== 'number') return null
  if (typeof row.prevClose !== 'number') return null
  if (typeof row.source !== 'string') return null
  return buildQuotePayload({
    symbol: row.symbol,
    price: row.price,
    prevClose: row.prevClose,
    source: row.source,
    asOf: typeof row.asOf === 'string' ? row.asOf : undefined,
  })
}
