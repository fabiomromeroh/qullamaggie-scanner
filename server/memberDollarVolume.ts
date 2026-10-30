/**
 * Attach 20-day dollar volume (and derived 20-day share volume) to group members.
 * Nobody is dropped here — Price > $5 / Avg vol > 100K / $Vol > $20M live in the
 * client liquidity toggles. Unknown values stay unknown (never guessed).
 */
import { deriveAvgVolume, finiteNumber } from '../src/lib/liquidityFilters.ts'

/** Default UI $vol floor. Request handlers no longer cut on this. */
export const MEMBER_MIN_DOLLAR_VOLUME_20 = 20_000_000

export interface DollarVolumeQuote {
  price?: number | null
  avgVolume?: number | null
  dollarVolume20?: number | null
}

export interface LiquidityEnrichResult<T> {
  members: T[]
  totalMembers: number
}

function indexQuotes(quotes: ReadonlyMap<string, DollarVolumeQuote>): Map<string, DollarVolumeQuote> {
  const indexed = new Map<string, DollarVolumeQuote>()
  for (const [ticker, quote] of quotes) indexed.set(ticker.toUpperCase(), quote)
  return indexed
}

/**
 * Overlay known price / 20d $vol / 20d shares onto every member.
 * A member with no quote is returned unchanged. When the quote map itself is
 * missing, the input list is copied as-is.
 */
export function enrichMembersWithLiquidity<T extends { ticker: string }>(
  members: readonly T[],
  quotes: ReadonlyMap<string, DollarVolumeQuote> | null,
): LiquidityEnrichResult<T & { price?: number; avgVolume?: number; dollarVolume20?: number }> {
  const totalMembers = members.length
  type Enriched = T & { price?: number; avgVolume?: number; dollarVolume20?: number }
  if (!quotes) {
    return {
      members: members.map((member) => ({ ...member })),
      totalMembers,
    }
  }

  const indexed = indexQuotes(quotes)
  const enriched: Enriched[] = []
  for (const member of members) {
    const existing = member as T & DollarVolumeQuote
    const quote = indexed.get(member.ticker.toUpperCase())
    const price = finiteNumber(existing.price) ?? finiteNumber(quote?.price)
    const dollarVolume20 = finiteNumber(existing.dollarVolume20) ?? finiteNumber(quote?.dollarVolume20)
    // Prefer 20d shares (dollarVolume20 / price) over a 3-month Yahoo average.
    const avgVolume =
      deriveAvgVolume(price, dollarVolume20) ??
      finiteNumber(existing.avgVolume) ??
      finiteNumber(quote?.avgVolume)
    enriched.push({
      ...member,
      ...(price != null ? { price } : {}),
      ...(avgVolume != null ? { avgVolume } : {}),
      ...(dollarVolume20 != null ? { dollarVolume20 } : {}),
    })
  }
  return { members: enriched, totalMembers }
}
