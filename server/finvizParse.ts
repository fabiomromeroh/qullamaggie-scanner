/**
 * Pure parser for Finviz industry performance HTML.
 * Primary source is the embedded `FinvizInitGroupsPerformance([...])` JSON array.
 * This view's HTML tables are filter chrome, not the performance dataset, so a
 * table scrape is not used (it would risk inventing numbers).
 */
import type { IndustryGroup } from '../src/types/index.ts'

const CALL_MARKER = 'FinvizInitGroupsPerformance('

const PERF_FIELDS = ['perfT', 'perfW', 'perfM', 'perfQ', 'perfH', 'perfY', 'perfYtd'] as const

type PerfField = (typeof PERF_FIELDS)[number]

export interface FinvizPerfRow {
  ticker: string
  label: string
  screenerUrl?: string
  perfT?: number
  perfW?: number
  perfM?: number
  perfQ?: number
  perfH?: number
  perfY?: number
  perfYtd?: number
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function extractBalancedArray(source: string, openIndex: number): string | null {
  if (source[openIndex] !== '[') return null
  let depth = 0
  let inString = false
  let escaped = false
  for (let i = openIndex; i < source.length; i++) {
    const ch = source[i]!
    if (inString) {
      if (escaped) {
        escaped = false
        continue
      }
      if (ch === '\\') {
        escaped = true
        continue
      }
      if (ch === '"') inString = false
      continue
    }
    if (ch === '"') {
      inString = true
      continue
    }
    if (ch === '[') depth++
    else if (ch === ']') {
      depth--
      if (depth === 0) return source.slice(openIndex, i + 1)
    }
  }
  return null
}

function validateRow(value: unknown): FinvizPerfRow | null {
  if (!isRecord(value)) return null
  if (typeof value.ticker !== 'string' || !value.ticker.trim()) return null
  if (typeof value.label !== 'string' || !value.label.trim()) return null

  const row: FinvizPerfRow = {
    ticker: value.ticker.trim(),
    label: value.label.trim(),
  }
  if (typeof value.screenerUrl === 'string' && value.screenerUrl.trim()) {
    row.screenerUrl = value.screenerUrl.trim()
  }

  for (const key of PERF_FIELDS) {
    const raw = value[key]
    if (raw == null) continue
    if (typeof raw !== 'number' || !Number.isFinite(raw)) return null
    row[key as PerfField] = raw
  }
  return row
}

/**
 * Parse Finviz groups performance HTML. Returns valid rows only.
 * Empty array means the marker was missing, the array did not parse, or no row was valid.
 */
export function parseFinvizGroupsPerformance(html: string): FinvizPerfRow[] {
  if (!html) return []
  const at = html.indexOf(CALL_MARKER)
  if (at < 0) return []
  const after = at + CALL_MARKER.length
  const bracket = html.indexOf('[', after)
  if (bracket < 0) return []
  if (!/^\s*$/.test(html.slice(after, bracket))) return []

  const json = extractBalancedArray(html, bracket)
  if (!json) return []

  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch {
    return []
  }
  if (!Array.isArray(parsed)) return []

  const rows: FinvizPerfRow[] = []
  for (const item of parsed) {
    const row = validateRow(item)
    if (row) rows.push(row)
  }
  return rows
}

function rankValue(n: number | undefined): number {
  return typeof n === 'number' && Number.isFinite(n) ? n : Number.NEGATIVE_INFINITY
}

/** Map parsed Finviz rows onto IndustryGroup. Does not invent missing performance fields. */
export function finvizRowsToGroups(rows: FinvizPerfRow[]): IndustryGroup[] {
  const seen = new Set<string>()
  const groups: IndustryGroup[] = []

  for (const row of rows) {
    if (seen.has(row.ticker)) continue
    seen.add(row.ticker)

    const group: IndustryGroup = {
      id: row.ticker,
      slug: row.ticker,
      name: row.label,
      rsRank: 0,
      description: 'Finviz industry group',
      source: 'finviz',
    }
    if (row.screenerUrl) group.screenerUrl = row.screenerUrl
    if (row.perfT != null) group.dayPct = row.perfT
    if (row.perfW != null) group.weekPct = row.perfW
    if (row.perfM != null) {
      group.perf1m = row.perfM
      group.monthPct = row.perfM
    }
    if (row.perfQ != null) group.perf3m = row.perfQ
    if (row.perfH != null) group.perf6m = row.perfH
    if (row.perfY != null) group.perf1y = row.perfY
    if (row.perfYtd != null) group.perfYtd = row.perfYtd
    groups.push(group)
  }

  groups.sort((a, b) => {
    const byQuarter = rankValue(b.perf3m) - rankValue(a.perf3m)
    if (byQuarter !== 0) return byQuarter
    const byMonth = rankValue(b.perf1m) - rankValue(a.perf1m)
    if (byMonth !== 0) return byMonth
    return a.name.localeCompare(b.name)
  })
  groups.forEach((group, index) => {
    group.rsRank = index + 1
  })
  return groups
}
