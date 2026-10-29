/** Large-cap line used by the ticker header badge. */
export const MARKET_CAP_TAG_USD = 10_000_000_000

export type MarketCapTag = '>$10B' | '<$10B'

/**
 * Header badge. At or above $10B is ">$10B"; a smaller positive cap is "<$10B".
 * Missing, non-finite, or non-positive values return null so the UI shows no badge.
 */
export function marketCapTag(marketCap: number | null | undefined): MarketCapTag | null {
  if (typeof marketCap !== 'number' || !Number.isFinite(marketCap) || marketCap <= 0) return null
  return marketCap >= MARKET_CAP_TAG_USD ? '>$10B' : '<$10B'
}

/** First positive finite market cap. Never invents a number when every source is unknown. */
export function resolveSummaryMarketCap(...sources: (number | null | undefined)[]): number | null {
  for (const value of sources) {
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value
  }
  return null
}
