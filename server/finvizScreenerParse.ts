/**
 * Pure parser for Finviz screener performance view (v=141).
 * Columns are mapped from `<th>` text. A missing expected header, a
 * challenge page, or a cell that is neither a number nor "—" is a failure.
 * Nothing is guessed.
 */
import type { GroupPeriod } from '../src/types/index.ts'
import { looksLikeFinvizChallenge } from './finvizHttp.ts'

export interface FinvizScreenerRow {
  ticker: string
  company: string
  perfWeek: number | null
  perfMonth: number | null
  perfQuart: number | null
  perfHalf: number | null
  perfYtd: number | null
  perfYear: number | null
  perf3y: number | null
  perf5y: number | null
  perf10y: number | null
  volatilityW: number | null
  volatilityM: number | null
  avgVolume: number | null
  relVolume: number | null
  price: number | null
  changePct: number | null
  volume: number | null
}

export type ScreenerParseResult =
  | { ok: true; rows: FinvizScreenerRow[] }
  | { ok: false; reason: string }

const EXPECTED_HEADERS = [
  'No.',
  'Ticker',
  'Perf Week',
  'Perf Month',
  'Perf Quart',
  'Perf Half',
  'Perf YTD',
  'Perf Year',
  'Perf 3Y',
  'Perf 5Y',
  'Perf 10Y',
  'Volatility W',
  'Volatility M',
  'Avg Volume',
  'Rel Volume',
  'Price',
  'Change %',
  'Volume',
] as const

type RowField = Exclude<keyof FinvizScreenerRow, 'ticker' | 'company'>

const HEADER_FIELD: Record<string, RowField | 'ticker' | 'skip'> = {
  'no.': 'skip',
  ticker: 'ticker',
  'perf week': 'perfWeek',
  'perf month': 'perfMonth',
  'perf quart': 'perfQuart',
  'perf half': 'perfHalf',
  'perf ytd': 'perfYtd',
  'perf year': 'perfYear',
  'perf 3y': 'perf3y',
  'perf 5y': 'perf5y',
  'perf 10y': 'perf10y',
  'volatility w': 'volatilityW',
  'volatility m': 'volatilityM',
  'avg volume': 'avgVolume',
  'rel volume': 'relVolume',
  price: 'price',
  'change %': 'changePct',
  volume: 'volume',
}

const PERCENT_FIELDS = new Set<RowField>([
  'perfWeek',
  'perfMonth',
  'perfQuart',
  'perfHalf',
  'perfYtd',
  'perfYear',
  'perf3y',
  'perf5y',
  'perf10y',
  'volatilityW',
  'volatilityM',
  'changePct',
])

const VOLUME_FIELDS = new Set<RowField>(['avgVolume', 'volume'])

const DASH = new Set(['', '-', '—', '–'])

function decodeEntities(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (all, hex: string) => {
      const n = Number.parseInt(hex, 16)
      if (!Number.isFinite(n) || n < 0 || n > 0x10ffff) return all
      return String.fromCodePoint(n)
    })
    .replace(/&#(\d+);/g, (all, dec: string) => {
      const n = Number(dec)
      if (!Number.isFinite(n) || n < 0 || n > 0x10ffff) return all
      return String.fromCodePoint(n)
    })
}

export function parseFinvizPercent(raw: string): number | null {
  const text = raw.replace(/,/g, '').replace(/\s+/g, '')
  if (DASH.has(text)) return null
  if (!/^-?\d+(\.\d+)?%$/.test(text)) return null
  const n = Number(text.slice(0, -1))
  return Number.isFinite(n) ? n : null
}

export function parseFinvizVolume(raw: string): number | null {
  const text = raw.replace(/,/g, '').replace(/\s+/g, '')
  if (DASH.has(text)) return null
  const m = /^(-?\d+(?:\.\d+)?)([KMB])?$/i.exec(text)
  if (!m) return null
  const n = Number(m[1])
  if (!Number.isFinite(n)) return null
  const suffix = (m[2] ?? '').toUpperCase()
  const mult = suffix === 'K' ? 1_000 : suffix === 'M' ? 1_000_000 : suffix === 'B' ? 1_000_000_000 : 1
  return Math.round(n * mult)
}

export function parseFinvizPlain(raw: string): number | null {
  const text = raw.replace(/[$,]/g, '').replace(/\s+/g, '')
  if (DASH.has(text)) return null
  if (!/^-?\d+(\.\d+)?$/.test(text)) return null
  const n = Number(text)
  return Number.isFinite(n) ? n : null
}

function headerLabel(innerHtml: string): string {
  return decodeEntities(innerHtml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim())
}

function cellText(innerHtml: string): string {
  return decodeEntities(innerHtml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim())
}

function attr(openingTag: string, name: string): string | null {
  const re = new RegExp(`\\b${name}="([^"]*)"`, 'i')
  const m = openingTag.match(re)
  if (!m) return null
  const value = decodeEntities(m[1] ?? '').trim()
  return value || null
}

function findScreenerTable(html: string): string | null {
  const re = /<table\b[^>]*class="([^"]*)"[^>]*>/gi
  let match: RegExpExecArray | null
  while ((match = re.exec(html))) {
    const cls = match[1] ?? ''
    if (!/\bstyled-table-new\b/.test(cls) || !/\bscreener_table\b/.test(cls)) continue
    const start = match.index
    const end = html.indexOf('</table>', start)
    if (end < 0) return null
    return html.slice(start, end + '</table>'.length)
  }
  return null
}

function parseMeasured(raw: string, field: RowField): number | null | 'bad' {
  const text = raw.trim()
  if (DASH.has(text)) return null
  const n = PERCENT_FIELDS.has(field)
    ? parseFinvizPercent(text)
    : VOLUME_FIELDS.has(field)
      ? parseFinvizVolume(text)
      : parseFinvizPlain(text)
  return n == null ? 'bad' : n
}

export function screenerPeriodPerf(row: FinvizScreenerRow, period: GroupPeriod): number | null {
  switch (period) {
    case '1d':
      return row.changePct
    case '1w':
      return row.perfWeek
    case '1m':
      return row.perfMonth
    case '3m':
      return row.perfQuart
    case '6m':
      return row.perfHalf
  }
}

/**
 * Parse the performance screener table. `ok: false` means the page is blocked,
 * the table is missing, or the header/cell layout is not the one we understand.
 */
export function parseFinvizScreenerPerformance(html: string): ScreenerParseResult {
  if (!html || !html.trim()) return { ok: false, reason: 'empty document' }
  const table = findScreenerTable(html)
  if (!table) {
    if (looksLikeFinvizChallenge(html)) return { ok: false, reason: 'blocked' }
    return { ok: false, reason: 'screener table not found' }
  }

  const rowAt = table.search(/<tr\b[^>]*\bclass="[^"]*\bstyled-row\b/i)
  const head = rowAt >= 0 ? table.slice(0, rowAt) : table
  const ths = [...head.matchAll(/<th\b[^>]*>([\s\S]*?)<\/th>/gi)]
  if (ths.length === 0) return { ok: false, reason: 'missing headers' }

  const labels = ths.map((th) => headerLabel(th[1] ?? ''))
  const missing = EXPECTED_HEADERS.filter(
    (label) => !labels.some((have) => have.toLowerCase() === label.toLowerCase()),
  )
  if (missing.length) return { ok: false, reason: `missing headers: ${missing.join(', ')}` }

  const columns: Array<RowField | 'ticker' | 'skip'> = []
  const seen = new Set<string>()
  for (const label of labels) {
    const key = label.toLowerCase()
    const field = HEADER_FIELD[key]
    if (!field) {
      columns.push('skip')
      continue
    }
    if (field !== 'skip') {
      if (seen.has(field)) return { ok: false, reason: `duplicate header: ${label}` }
      seen.add(field)
    }
    columns.push(field)
  }

  const rowRe = /<tr\b[^>]*\bclass="[^"]*\bstyled-row\b[^"]*"[^>]*>([\s\S]*?)<\/tr>/gi
  const rows: FinvizScreenerRow[] = []
  let rowMatch: RegExpExecArray | null
  while ((rowMatch = rowRe.exec(table))) {
    if (rows.length >= 20) break
    const inner = rowMatch[1] ?? ''
    const cells = [...inner.matchAll(/<td\b([^>]*)>([\s\S]*?)<\/td>/gi)]
    if (cells.length < columns.length) {
      return { ok: false, reason: `row ${rows.length + 1} has ${cells.length} cells, expected at least ${columns.length}` }
    }
    const row: FinvizScreenerRow = {
      ticker: '',
      company: '',
      perfWeek: null,
      perfMonth: null,
      perfQuart: null,
      perfHalf: null,
      perfYtd: null,
      perfYear: null,
      perf3y: null,
      perf5y: null,
      perf10y: null,
      volatilityW: null,
      volatilityM: null,
      avgVolume: null,
      relVolume: null,
      price: null,
      changePct: null,
      volume: null,
    }
    for (let i = 0; i < columns.length; i++) {
      const field = columns[i]!
      if (field === 'skip') continue
      const opening = cells[i]?.[1] ?? ''
      const text = cellText(cells[i]?.[2] ?? '')
      if (field === 'ticker') {
        const ticker = attr(opening, 'data-boxover-ticker')
        const company = attr(opening, 'data-boxover-company')
        if (!ticker || !/^[A-Za-z0-9.-]+$/.test(ticker)) {
          return { ok: false, reason: `row ${rows.length + 1} missing data-boxover-ticker` }
        }
        if (!company) return { ok: false, reason: `row ${rows.length + 1} missing data-boxover-company` }
        row.ticker = ticker.toUpperCase()
        row.company = company
        continue
      }
      const parsed = parseMeasured(text, field)
      if (parsed === 'bad') {
        return { ok: false, reason: `row ${rows.length + 1} ${field} not a number: ${text || 'empty'}` }
      }
      row[field] = parsed
    }
    if (!row.ticker) return { ok: false, reason: `row ${rows.length + 1} missing ticker column` }
    rows.push(row)
  }

  return { ok: true, rows }
}
