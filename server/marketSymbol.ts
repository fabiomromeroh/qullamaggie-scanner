/** Shared ticker path validation for /api/market/{bars,news,profile,quote}/:symbol */

import { MARKET_SYMBOL_RE } from '../src/lib/tickerSymbol.ts'
export { MARKET_SYMBOL_RE, US_EQUITY_SYMBOL_RE } from '../src/lib/tickerSymbol.ts'

/**
 * Upper-case, trim, and accept only `/^[A-Z0-9.\-^]{1,12}$/`.
 * Returns null when the value is missing or invalid.
 */
export function parseMarketSymbol(raw: string | undefined | null): string | null {
  if (raw == null) return null
  let value = String(raw).trim()
  if (!value) return null
  try {
    value = decodeURIComponent(value)
  } catch {
    /* keep original */
  }
  value = value.trim().toUpperCase()
  if (!MARKET_SYMBOL_RE.test(value)) return null
  return value
}

/** `/api/market/<kind>/<symbol>` — null if the path is not that route. */
export function matchMarketSymbolRoute(
  pathname: string,
  kind: 'bars' | 'news' | 'profile' | 'quote',
): string | null {
  const path = pathname.replace(/\/+$/, '') || '/'
  const prefix = `/api/market/${kind}/`
  if (!path.startsWith(prefix)) return null
  const rest = path.slice(prefix.length)
  if (!rest || rest.includes('/')) return null
  return rest
}
