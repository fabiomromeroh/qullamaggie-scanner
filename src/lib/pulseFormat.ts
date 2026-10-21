export function fmtPct(v: number | null | undefined, digits = 2): string {
  if (v == null || !Number.isFinite(v)) return '—'
  return `${v > 0 ? '+' : ''}${v.toFixed(digits)}%`
}

export function pctClass(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v) || v === 0) return 'text-terminal-muted'
  return v > 0 ? 'text-terminal-green' : 'text-terminal-red'
}

export function fmtPrice(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return '—'
  return v >= 1000 ? v.toLocaleString('en-US', { maximumFractionDigits: 2 }) : v.toFixed(2)
}

/** 1234567 → "1.23M", 2.5e9 → "2.50B". */
export function fmtCompact(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return '—'
  const a = Math.abs(v)
  if (a >= 1e12) return `${(v / 1e12).toFixed(2)}T`
  if (a >= 1e9) return `${(v / 1e9).toFixed(2)}B`
  if (a >= 1e6) return `${(v / 1e6).toFixed(2)}M`
  if (a >= 1e3) return `${(v / 1e3).toFixed(1)}K`
  return v.toFixed(0)
}
