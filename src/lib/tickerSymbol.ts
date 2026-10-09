/**
 * Ticker patterns shared by the manual watchlist and `/api/market/*` routes.
 *
 * {@link US_EQUITY_SYMBOL_RE} is the watchlist add/pin rule (US-style equities).
 * {@link MARKET_SYMBOL_RE} is the API path validator and a strict superset of
 * that rule (digits, `^` indexes, up to 12 characters).
 */

/** `/api/market/{bars,news,profile,quote,idea}/:symbol` path token. */
export const MARKET_SYMBOL_RE = /^[A-Z0-9.^-]{1,12}$/

/**
 * Server `GET /api/market/idea/:symbol` after trim + uppercase.
 * First character is a letter; then up to 9 letters, digits, `.`, or `-`.
 */
export const IDEA_LOOKUP_SYMBOL_RE = /^[A-Z][A-Z0-9.-]{0,9}$/

/**
 * Client search box: treat the trimmed text as a ticker lookup when it is
 * 1–6 letters, digits, `.`, or `-`.
 */
export const TICKER_LIKE_SEARCH_RE = /^[A-Za-z0-9.-]{1,6}$/

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

/**
 * Trim, uppercase, and accept {@link TICKER_LIKE_SEARCH_RE}.
 * Returns null when the box is empty or not ticker-shaped.
 */
export function parseTickerLikeSearch(raw: string | undefined | null): string | null {
  if (raw == null) return null
  const value = String(raw).trim()
  if (!value) return null
  if (!TICKER_LIKE_SEARCH_RE.test(value)) return null
  return value.toUpperCase()
}

/**
 * Upper-case, trim, decode, and accept {@link IDEA_LOOKUP_SYMBOL_RE}.
 * Returns null when the value is missing or invalid.
 */
export function parseIdeaLookupSymbol(raw: string | undefined | null): string | null {
  if (raw == null) return null
  let value = String(raw).trim()
  if (!value) return null
  try {
    value = decodeURIComponent(value)
  } catch {
    /* keep original */
  }
  value = value.trim().toUpperCase()
  if (!IDEA_LOOKUP_SYMBOL_RE.test(value)) return null
  return value
}
