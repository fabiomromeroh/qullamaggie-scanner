import {
  liquidityFilterLabels,
  type LiquidityFilters,
} from './liquidityFilters'

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
  shown: number
  total: number
  filters: LiquidityFilters
}

/**
 * Theme Tracker member line. Counts reflect the client-side liquidity toggles
 * (Price > $5, Avg vol > 100K, $Vol > $20M), not a hard-coded rebuild filter.
 */
export function membershipFilterFootnote(input: MembershipFootnoteInput): string {
  const labels = liquidityFilterLabels(input.filters)
  const filterText = labels.length ? labels.join(', ') : 'none'
  return `${input.shown} of ${input.total} shown · filters: ${filterText}`
}
