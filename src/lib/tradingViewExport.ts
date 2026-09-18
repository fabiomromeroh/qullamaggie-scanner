/** Format filtered idea tickers for TradingView watchlist paste (comma-separated). */
export function formatTickersForTradingView(tickers: string[]): string {
  return tickers
    .map((t) => t.trim())
    .filter(Boolean)
    .join(',')
}

/** Try Clipboard API; returns false if unavailable or denied. */
export async function copyTextToClipboard(text: string): Promise<boolean> {
  if (!text) return false
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // fall through
  }
  return false
}
