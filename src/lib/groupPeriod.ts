/**
 * Leading-group period: Finviz screener order, client rank, and leader count.
 * Pure helpers shared by the server and the panel.
 */
import type { GroupPeriod, IndustryGroup } from '../types/index.ts'

export const GROUP_PERIOD_IDS: readonly GroupPeriod[] = ['1d', '1w', '1m', '3m', '6m']

export type GroupPerfField =
  | 'dayPct'
  | 'weekPct'
  | 'perf1m'
  | 'perf3m'
  | 'perf6m'
  | 'perf1y'
  | 'perfYtd'

export interface GroupPeriodMeta {
  id: GroupPeriod
  label: string
  /** Finviz screener `o=` value (includes the leading minus). */
  order: string
  field: GroupPerfField
  /** Tie-break: next-longer periods, then the remaining fields. */
  tieBreak: GroupPerfField[]
}

export const GROUP_PERIODS: Record<GroupPeriod, GroupPeriodMeta> = {
  '1d': {
    id: '1d',
    label: '1D',
    order: '-change',
    field: 'dayPct',
    tieBreak: ['weekPct', 'perf1m', 'perf3m', 'perf6m', 'perf1y', 'perfYtd'],
  },
  '1w': {
    id: '1w',
    label: '1W',
    order: '-perf1w',
    field: 'weekPct',
    tieBreak: ['perf1m', 'perf3m', 'perf6m', 'perf1y', 'dayPct', 'perfYtd'],
  },
  '1m': {
    id: '1m',
    label: '1M',
    order: '-perf4w',
    field: 'perf1m',
    tieBreak: ['perf3m', 'perf6m', 'perf1y', 'weekPct', 'dayPct', 'perfYtd'],
  },
  '3m': {
    id: '3m',
    label: '3M',
    order: '-perf13w',
    field: 'perf3m',
    tieBreak: ['perf6m', 'perf1y', 'perf1m', 'weekPct', 'dayPct', 'perfYtd'],
  },
  '6m': {
    id: '6m',
    label: '6M',
    order: '-perf26w',
    field: 'perf6m',
    tieBreak: ['perf1y', 'perf3m', 'perf1m', 'weekPct', 'dayPct', 'perfYtd'],
  },
}

export function isGroupPeriod(value: string): value is GroupPeriod {
  return (GROUP_PERIOD_IDS as readonly string[]).includes(value)
}

/** Finviz industry slugs are lowercase alphanumeric (`f=ind_<slug>`). */
export function isGroupSlug(value: string): boolean {
  return value.length > 0 && value.length <= 80 && /^[a-z0-9]+$/.test(value)
}

export function periodOrder(period: GroupPeriod): string {
  return GROUP_PERIODS[period].order
}

const MAX_LEADER_SLUGS = 12

/**
 * Parse `slugs=a,b,c`. Dedupes, lowercases, rejects anything outside `[a-z0-9]+`
 * and lists longer than 12.
 */
export function parseSlugList(
  raw: string | null,
  max = MAX_LEADER_SLUGS,
): { ok: true; slugs: string[] } | { ok: false; error: string } {
  if (raw == null || !raw.trim()) return { ok: false, error: 'slugs is required' }
  const parts = raw
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.length > 0)
  if (parts.length === 0) return { ok: false, error: 'slugs is required' }
  if (parts.length > max) return { ok: false, error: `at most ${max} slugs` }
  const slugs: string[] = []
  const seen = new Set<string>()
  for (const part of parts) {
    if (!isGroupSlug(part)) return { ok: false, error: `invalid slug: ${part}` }
    if (seen.has(part)) continue
    seen.add(part)
    slugs.push(part)
  }
  if (slugs.length === 0) return { ok: false, error: 'slugs is required' }
  return { ok: true, slugs }
}

/**
 * Finviz price / average-volume filters are discrete buckets.
 * Scanner defaults (price > $5, avg volume >= 750_000) map to `sh_price_o5` and
 * `sh_avgvol_o750`. Any other pair falls back to those tokens — Finviz has no
 * bucket for an arbitrary env override, and we do not widen the screen.
 */
const PRICE_TOKENS: Record<number, string> = {
  1: 'sh_price_o1',
  2: 'sh_price_o2',
  3: 'sh_price_o3',
  4: 'sh_price_o4',
  5: 'sh_price_o5',
  7: 'sh_price_o7',
  10: 'sh_price_o10',
  15: 'sh_price_o15',
  20: 'sh_price_o20',
  30: 'sh_price_o30',
  40: 'sh_price_o40',
  50: 'sh_price_o50',
}

const AVGVOL_TOKENS: Record<number, string> = {
  50_000: 'sh_avgvol_o50',
  100_000: 'sh_avgvol_o100',
  200_000: 'sh_avgvol_o200',
  300_000: 'sh_avgvol_o300',
  400_000: 'sh_avgvol_o400',
  500_000: 'sh_avgvol_o500',
  750_000: 'sh_avgvol_o750',
  1_000_000: 'sh_avgvol_o1000',
  2_000_000: 'sh_avgvol_o2000',
}

export const FINVIZ_DEFAULT_PRICE_TOKEN = 'sh_price_o5'
export const FINVIZ_DEFAULT_AVGVOL_TOKEN = 'sh_avgvol_o750'

export function finvizLiquidityTokens(
  minPrice: number,
  minAvgVol: number,
): { price: string; avgVol: string; mapped: boolean } {
  const price = PRICE_TOKENS[minPrice]
  const avgVol = AVGVOL_TOKENS[minAvgVol]
  if (price && avgVol) return { price, avgVol, mapped: true }
  return {
    price: FINVIZ_DEFAULT_PRICE_TOKEN,
    avgVol: FINVIZ_DEFAULT_AVGVOL_TOKEN,
    mapped: false,
  }
}

export interface LeaderCandidate {
  ticker: string
  /** Selected-period performance percent. Null when the feed shows "—". */
  perf: number | null
}

/**
 * A leader is a stock in the group's Finviz top list (price > $5, average
 * volume > 750K, ordered by the selected period) whose selected-period
 * performance is > 0 AND that appears in the current scan results.
 *
 * Scan membership stands in for "above the 200-day SMA": the cached scan only
 * contains names that passed Stage 1, Stage 1.5 (above 200 and above 50), and
 * Stage 2. `inScanCount` is null when `scanTickers` is null (cache not ready).
 * `parsedCount` is the denominator (rows actually parsed, at most 20).
 */
export function countGroupLeaders(
  rows: LeaderCandidate[],
  scanTickers: ReadonlySet<string> | null,
): { inScanCount: number | null; parsedCount: number; leaderTickers: string[] } {
  const parsedCount = rows.length
  if (scanTickers == null) {
    return { inScanCount: null, parsedCount, leaderTickers: [] }
  }
  const leaderTickers: string[] = []
  for (const row of rows) {
    const ticker = row.ticker.trim().toUpperCase()
    if (!ticker) continue
    if (row.perf == null || !(row.perf > 0)) continue
    if (!scanTickers.has(ticker)) continue
    leaderTickers.push(ticker)
  }
  return { inScanCount: leaderTickers.length, parsedCount, leaderTickers }
}

function finitePerf(value: number | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/**
 * Compare two groups on a period. Missing numbers sort last in both directions.
 * Ties fall through to the next-longer period, then the other performance fields.
 */
export function compareGroupsByPeriod(
  a: IndustryGroup,
  b: IndustryGroup,
  period: GroupPeriod,
  dir: 'asc' | 'desc' = 'desc',
): number {
  const meta = GROUP_PERIODS[period]
  const keys = [meta.field, ...meta.tieBreak]
  for (const key of keys) {
    const av = finitePerf(a[key])
    const bv = finitePerf(b[key])
    if (av == null && bv == null) continue
    if (av == null) return 1
    if (bv == null) return -1
    if (av !== bv) return dir === 'asc' ? av - bv : bv - av
  }
  return a.name.localeCompare(b.name)
}

/** Copy groups, ordered by `period` descending, with `rsRank` rewritten 1..n. */
export function rankGroups(groups: IndustryGroup[], period: GroupPeriod): IndustryGroup[] {
  const sorted = [...groups].sort((a, b) => compareGroupsByPeriod(a, b, period, 'desc'))
  return sorted.map((group, index) => ({ ...group, rsRank: index + 1 }))
}
