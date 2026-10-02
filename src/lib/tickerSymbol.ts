/**
 * Ticker patterns shared by the manual watchlist and `/api/market/*` routes.
 *
 * {@link US_EQUITY_SYMBOL_RE} is the watchlist add/pin rule (US-style equities).
 * {@link MARKET_SYMBOL_RE} is the API path validator and a strict superset of
 * that rule (digits, `^` indexes, up to 12 characters).
 */

/** `/api/market/{bars,news,profile,quote}/:symbol` path token. */
export const MARKET_SYMBOL_RE = /^[A-Z0-9.^-]{1,12}$/

/**
 * Manual watchlist tickers: 1–5 letters, optional class suffix
 * (`BRK.B` / `BRK-B` / `PBR-A` — one `.` or `-` plus 1–2 letters).
 */
export const US_EQUITY_SYMBOL_RE = /^[A-Z]{1,5}(?:[.-][A-Z]{1,2})?$/

/** Human-readable form of {@link US_EQUITY_SYMBOL_RE} for tooltips and README. */
export const US_EQUITY_SYMBOL_PATTERN =
  '1-5 letters, optional class suffix (BRK.B / BRK-B / PBR-A)'

/**
 * Upper-case, trim, strip one leading `$`. Returns the ticker when it matches
 * {@link US_EQUITY_SYMBOL_RE}, otherwise null.
 */
export function parseUsEquitySymbol(raw: string | undefined | null): string | null {
  if (raw == null) return null
  let value = String(raw).trim()
  if (!value) return null
  if (value.startsWith('$')) value = value.slice(1).trim()
  value = value.toUpperCase()
  if (!US_EQUITY_SYMBOL_RE.test(value)) return null
  return value
}
