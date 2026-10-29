/** Compact share-volume floor: 100_000 → "100K", 750_000 → "750K", 2_000_000 → "2M". */
export function formatShareVolume(n: number): string {
  if (!Number.isFinite(n)) return String(n)
  if (n >= 1_000_000 && n % 1_000 === 0) {
    const millions = n / 1_000_000
    return `${Number.isInteger(millions) ? millions : millions.toFixed(1)}M`
  }
  if (n >= 1_000 && n % 1_000 === 0) return `${n / 1_000}K`
  return n.toLocaleString('en-US')
}

/** Compact dollar floor: 20_000_000 → "$20M". */
export function formatDollarFloor(n: number): string {
  if (!Number.isFinite(n)) return String(n)
  if (n >= 1_000_000 && n % 1_000_000 === 0) return `$${n / 1_000_000}M`
  if (n >= 1_000 && n % 1_000 === 0) return `$${n / 1_000}K`
  return `$${n.toLocaleString('en-US')}`
}

export interface MembershipFootnoteInput {
  filters?: { minPrice?: number; minAvgVolume?: number } | null
  dollarVolumeFilterApplied?: boolean
  filteredOut?: number
  minDollarVolume20?: number
}

/**
 * Theme Tracker member line. Price and average-volume floors come from the
 * snapshot's own `filters` when the response includes them. The 20-day dollar
 * volume clause says how many names were hidden, or that the cut is still pending.
 */
export function membershipFilterFootnote(input: MembershipFootnoteInput): string {
  const price = input.filters?.minPrice
  const volume = input.filters?.minAvgVolume
  const priceText = typeof price === 'number' && Number.isFinite(price) ? `price > $${price}` : 'price filter unknown'
  const volumeText =
    typeof volume === 'number' && Number.isFinite(volume) ? `avg vol > ${formatShareVolume(volume)}` : 'avg vol unknown'
  const dollarText = input.dollarVolumeFilterApplied
    ? `20d $vol ≥ ${formatDollarFloor(input.minDollarVolume20 ?? 20_000_000)} (${input.filteredOut ?? 0} hidden)`
    : '20d $vol filter pending'
  return `${priceText}, ${volumeText}, ${dollarText}`
}
