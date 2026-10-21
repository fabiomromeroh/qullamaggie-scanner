import type { PerfBar } from './perfWindows'

/** Qullamaggie-style ADR%: mean of (high / low − 1) over the last `n` daily bars, in percent. */
export function adrPct(bars: readonly PerfBar[], n = 20): number | null {
  const slice = bars.slice(-n).filter((b) => b.l > 0 && b.h >= b.l)
  if (slice.length < Math.min(n, 5)) return null
  const sum = slice.reduce((acc, b) => acc + (b.h / b.l - 1), 0)
  return (sum / slice.length) * 100
}

/** Average daily dollar volume (close × volume) over the last `n` bars. */
export function avgDollarVolume(bars: readonly PerfBar[], n = 20): number | null {
  const slice = bars.slice(-n)
  if (!slice.length) return null
  return slice.reduce((acc, b) => acc + b.c * b.v, 0) / slice.length
}

export interface FilingRow {
  form: string
  filingDate: string
  reportDate?: string
  accessionNumber: string
  primaryDocument?: string
  description?: string
  url: string
}

/** Forms surfaced by the Filings tab (amendments included, e.g. 10-K/A). */
export const FILING_FORMS = ['8-K', '10-Q', '10-K', 'S-1', '4', '6-K', '20-F', 'S-3', 'DEF 14A', 'SC 13D', 'SC 13G'] as const

export function isTrackedForm(form: string): boolean {
  const base = form.replace(/\/A$/, '')
  return (FILING_FORMS as readonly string[]).includes(base)
}

/** Archive URL for a filing document (or the filing index when no document). */
export function filingUrl(cik: number, accession: string, primaryDocument?: string): string {
  const noDash = accession.replace(/-/g, '')
  return primaryDocument
    ? `https://www.sec.gov/Archives/edgar/data/${cik}/${noDash}/${primaryDocument}`
    : `https://www.sec.gov/Archives/edgar/data/${cik}/${noDash}/${accession}-index.htm`
}

/** Parse `data.sec.gov/submissions/CIK##########.json` `filings.recent` columns. */
export function parseRecentFilings(submissions: unknown, cik: number, limit = 40): FilingRow[] {
  const recent = (submissions as { filings?: { recent?: Record<string, unknown[]> } })?.filings?.recent
  if (!recent) return []
  const forms = (recent.form ?? []) as string[]
  const out: FilingRow[] = []
  for (let i = 0; i < forms.length && out.length < limit; i++) {
    const form = forms[i]
    const accession = (recent.accessionNumber?.[i] ?? '') as string
    if (!form || !accession || !isTrackedForm(form)) continue
    const primaryDocument = (recent.primaryDocument?.[i] as string) || undefined
    out.push({
      form,
      filingDate: (recent.filingDate?.[i] as string) ?? '',
      reportDate: (recent.reportDate?.[i] as string) || undefined,
      accessionNumber: accession,
      primaryDocument,
      description: (recent.primaryDocDescription?.[i] as string) || undefined,
      url: filingUrl(cik, accession, primaryDocument),
    })
  }
  return out
}

/** `company_tickers.json` → ticker → CIK. Class shares map BRK.B ↔ BRK-B. */
export function buildTickerCikMap(raw: unknown): Map<string, number> {
  const map = new Map<string, number>()
  if (!raw || typeof raw !== 'object') return map
  for (const row of Object.values(raw as Record<string, { ticker?: string; cik_str?: number }>)) {
    if (!row?.ticker || typeof row.cik_str !== 'number') continue
    const t = row.ticker.toUpperCase()
    if (!map.has(t)) map.set(t, row.cik_str)
    const dot = t.replace(/-/g, '.')
    if (!map.has(dot)) map.set(dot, row.cik_str)
  }
  return map
}
