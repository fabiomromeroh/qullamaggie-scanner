/**
 * Session cache + fetch for watchlist quotes (tickers not in the current scan).
 * Concurrency is capped by {@link WATCHLIST_QUOTE_CONCURRENCY}.
 */
import {
  shapeQuotePayload,
  WATCHLIST_QUOTE_CONCURRENCY,
  type QuotePayload,
} from './marketQuote'

export { WATCHLIST_QUOTE_CONCURRENCY }

export type QuoteView =
  | { status: 'loading' }
  | { status: 'ok'; quote: QuotePayload }
  | { status: 'error'; message: string }
  | { status: 'nodata' }

export class QuoteFetchError extends Error {
  readonly kind: 'nodata' | 'unavailable'
  constructor(message: string, kind: 'nodata' | 'unavailable') {
    super(message)
    this.kind = kind
  }
}

const sessionQuotes = new Map<string, QuotePayload>()

export function peekSessionQuote(symbol: string): QuotePayload | undefined {
  return sessionQuotes.get(symbol.toUpperCase())
}

export function rememberSessionQuote(symbol: string, quote: QuotePayload): void {
  sessionQuotes.set(symbol.toUpperCase(), quote)
}

export function forgetSessionQuote(symbol: string): void {
  sessionQuotes.delete(symbol.toUpperCase())
}

export function clearSessionQuotes(): void {
  sessionQuotes.clear()
}

function errorMessage(body: unknown): string | null {
  if (!body || typeof body !== 'object') return null
  const error = (body as { error?: unknown }).error
  return typeof error === 'string' && error.trim() ? error.trim() : null
}

export async function fetchMarketQuote(
  symbol: string,
  fetcher: typeof fetch = fetch,
): Promise<QuotePayload> {
  const url = `/api/market/quote/${encodeURIComponent(symbol)}`
  let res: Response
  try {
    res = await fetcher(url)
  } catch (err) {
    throw new QuoteFetchError(
      err instanceof Error ? err.message : 'Network error',
      'unavailable',
    )
  }

  let body: unknown = null
  try {
    body = await res.json()
  } catch {
    body = null
  }

  if (res.status === 400 || res.status === 404) {
    throw new QuoteFetchError(errorMessage(body) ?? 'No data', 'nodata')
  }
  if (!res.ok) {
    throw new QuoteFetchError(
      errorMessage(body) ?? `HTTP ${res.status}`,
      'unavailable',
    )
  }
  const shaped = shapeQuotePayload(body)
  if (!shaped) {
    throw new QuoteFetchError('Malformed quote', 'unavailable')
  }
  return shaped
}

export function viewFromQuoteError(err: unknown): QuoteView {
  if (err instanceof QuoteFetchError && err.kind === 'nodata') {
    return { status: 'nodata' }
  }
  const message = err instanceof Error && err.message.trim() ? err.message : 'Unavailable'
  return { status: 'error', message }
}

export function createConcurrencyPool(limit: number) {
  let active = 0
  const waiting: Array<() => void> = []

  async function run<T>(fn: () => Promise<T>): Promise<T> {
    if (active >= limit) {
      await new Promise<void>((resolve) => waiting.push(resolve))
    }
    active += 1
    try {
      return await fn()
    } finally {
      active -= 1
      const next = waiting.shift()
      if (next) next()
    }
  }

  return { run }
}
