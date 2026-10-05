/**
 * ADR extension from the 50-day SMA.
 *
 * Canonical:
 *   extensionAdr50 = (price - sma50) / (price * (adrPct / 100))
 *
 * Equivalent:
 *   extensionAdr50 = pctAboveSma50 / adrPct
 *   when pctAboveSma50 = ((price - sma50) / price) * 100
 *
 * TradingIdea.pctAboveSma50 is the existing (price / SMA50 − 1) × 100 field
 * (SMA50 in the denominator). It is kept as-is and is not this price-relative
 * percent, so do not compute the ADR multiple as idea.pctAboveSma50 / adrPct.
 *
 * Positive = extended ABOVE the 50 SMA (in ADR multiples).
 * Negative = below the 50 SMA.
 * Zero when price equals sma50.
 * Null when the value cannot be computed (UI shows —).
 */

/** Canonical formula text, interpolated into tooltips and README. */
export const EXTENSION_ADR50_FORMULA =
  '(price - sma50) / (price * (adrPct / 100))'

/** Equivalent form. pctAboveSma50 here is price-relative, not TradingIdea.pctAboveSma50. */
export const EXTENSION_ADR50_FORMULA_EQUIV =
  'pctAboveSma50 / adrPct when pctAboveSma50 = ((price - sma50) / price) * 100'

/** Modest stretch: at or below this many ADRs is greenish. */
export const EXTENSION_ADR50_MODEST = 2

/** Above this many ADRs is treated as a large positive stretch (red). */
export const EXTENSION_ADR50_STRETCHED = 4

function finiteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

/**
 * Canonical ADR-multiple distance of `price` from `sma50`.
 * Returns null when adrPct <= 0, price <= 0, or any input is missing/non-finite.
 */
export function extensionAdrFrom50(
  price: number | null | undefined,
  sma50: number | null | undefined,
  adrPct: number | null | undefined,
): number | null {
  if (!finiteNumber(price) || !finiteNumber(sma50) || !finiteNumber(adrPct)) return null
  if (price <= 0 || adrPct <= 0) return null
  return (price - sma50) / (price * (adrPct / 100))
}

/** Round a computed extension to 2 decimals for the idea payload. Null stays null. */
export function roundExtensionAdr50(value: number | null): number | null {
  if (value == null || !Number.isFinite(value)) return null
  return Math.round(value * 100) / 100
}

/** Signed compact text, e.g. +2.3 / −0.4 / —. */
export function formatExtensionAdr50(
  value: number | null | undefined,
  digits = 1,
): string {
  if (!finiteNumber(value)) return '—'
  const sign = value > 0 ? '+' : ''
  return `${sign}${value.toFixed(digits)}`
}

export type ExtensionAdr50Tone = 'muted' | 'green' | 'amber' | 'red'

/** Green when near/at/below a modest level; amber then red as the positive stretch grows. */
export function extensionAdr50Tone(value: number | null | undefined): ExtensionAdr50Tone {
  if (!finiteNumber(value)) return 'muted'
  if (value <= EXTENSION_ADR50_MODEST) return 'green'
  if (value <= EXTENSION_ADR50_STRETCHED) return 'amber'
  return 'red'
}

export function extensionAdr50Class(value: number | null | undefined): string {
  const tone = extensionAdr50Tone(value)
  if (tone === 'green') return 'text-terminal-green'
  if (tone === 'amber') return 'text-terminal-amber'
  if (tone === 'red') return 'text-terminal-red'
  return 'text-terminal-dim'
}
