/**
 * Request-time liquidity cut for group member lists.
 * Breadth chart quotes carry a 20-session average of close × volume.
 * A member with no quote is kept: the dollar-volume floor was not applied to it.
 * When the quote map itself is missing, nobody is removed and the filter is reported as not applied.
 */
export const MEMBER_MIN_DOLLAR_VOLUME_20 = 20_000_000

export interface DollarVolumeQuote {
  dollarVolume20?: number | null
}

export interface DollarVolumeFilterResult<T> {
  members: T[]
  totalMembers: number
  filteredOut: number
  dollarVolumeFilterApplied: boolean
  minDollarVolume20: number
}

function knownDollarVolume(quote: DollarVolumeQuote | undefined): number | null {
  const value = quote?.dollarVolume20
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  return value
}

function indexQuotes(quotes: ReadonlyMap<string, DollarVolumeQuote>): Map<string, DollarVolumeQuote> {
  const indexed = new Map<string, DollarVolumeQuote>()
  for (const [ticker, quote] of quotes) indexed.set(ticker.toUpperCase(), quote)
  return indexed
}

export function filterMembersByDollarVolume<T extends { ticker: string }>(
  members: readonly T[],
  quotes: ReadonlyMap<string, DollarVolumeQuote> | null,
  min = MEMBER_MIN_DOLLAR_VOLUME_20,
): DollarVolumeFilterResult<T & { dollarVolume20?: number }> {
  const totalMembers = members.length
  if (!quotes) {
    return {
      members: members.map((member) => ({ ...member })),
      totalMembers,
      filteredOut: 0,
      dollarVolumeFilterApplied: false,
      minDollarVolume20: min,
    }
  }

  const indexed = indexQuotes(quotes)
  const kept: (T & { dollarVolume20?: number })[] = []
  let filteredOut = 0
  for (const member of members) {
    const dollarVolume20 = knownDollarVolume(indexed.get(member.ticker.toUpperCase()))
    if (dollarVolume20 == null) {
      kept.push({ ...member })
      continue
    }
    if (dollarVolume20 < min) {
      filteredOut += 1
      continue
    }
    kept.push({ ...member, dollarVolume20 })
  }
  return {
    members: kept,
    totalMembers,
    filteredOut,
    dollarVolumeFilterApplied: true,
    minDollarVolume20: min,
  }
}
