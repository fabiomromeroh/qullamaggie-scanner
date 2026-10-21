/**
 * Map Finnhub free-tier responses (stock/profile2, stock/metric?metric=all,
 * stock/earnings, calendar/earnings) to the ticker modal's Fundamentals shape.
 * Fields Finnhub's free tier does not provide stay null (never estimated).
 * Finnhub reports market cap and share counts in millions.
 */

export interface FundamentalsPayload {
  symbol: string
  name: string | null
  sector: string | null
  industry: string | null
  country: string | null
  website: string | null
  employees: number | null
  summary: string | null
  marketCap: number | null
  sharesOutstanding: number | null
  floatShares: number | null
  shortPctFloat: number | null
  shortRatio: number | null
  heldByInstitutionsPct: number | null
  heldByInsidersPct: number | null
  trailingPe: number | null
  forwardPe: number | null
  revenueGrowthYoyPct: number | null
  earningsGrowthYoyPct: number | null
  grossMarginPct: number | null
  operatingMarginPct: number | null
  totalRevenue: number | null
  nextEarningsDate: string | null
  quarterlyEps: { period: string; actual: number | null; estimate: number | null }[]
  quarterlyRevenue: { period: string; revenue: number | null; earnings: number | null }[]
  source: 'yahoo' | 'finnhub'
}

function n(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}
function s(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null
}
function millions(v: unknown): number | null {
  const x = n(v)
  return x == null ? null : x * 1e6
}

export function finnhubToFundamentals(
  symbol: string,
  profile: unknown,
  metricResponse: unknown,
  earnings: unknown,
  calendar: unknown,
  todayIso: string,
): FundamentalsPayload {
  const p = (profile ?? {}) as Record<string, unknown>
  const m = ((metricResponse as { metric?: Record<string, unknown> } | null)?.metric ?? {}) as Record<string, unknown>
  const eps = Array.isArray(earnings) ? (earnings as Record<string, unknown>[]) : []
  const cal = ((calendar as { earningsCalendar?: Record<string, unknown>[] } | null)?.earningsCalendar ?? []) as Record<
    string,
    unknown
  >[]
  const today = todayIso.slice(0, 10)
  const next = cal
    .map((c) => s(c.date))
    .filter((d): d is string => d != null && d >= today)
    .sort()[0]
  // stock/earnings can repeat a period; keep the first row per period, newest first, max 4.
  const seen = new Set<string>()
  const quarterlyEps: FundamentalsPayload['quarterlyEps'] = []
  for (const e of eps) {
    const period = s(e.period)
    if (!period || seen.has(period)) continue
    seen.add(period)
    quarterlyEps.push({ period, actual: n(e.actual), estimate: n(e.estimate) })
    if (quarterlyEps.length === 4) break
  }
  quarterlyEps.reverse()
  return {
    symbol,
    name: s(p.name),
    sector: null,
    industry: s(p.finnhubIndustry),
    country: s(p.country),
    website: s(p.weburl),
    employees: null,
    summary: null,
    marketCap: millions(p.marketCapitalization),
    sharesOutstanding: millions(p.shareOutstanding),
    floatShares: millions(p.floatingShare),
    shortPctFloat: null,
    shortRatio: null,
    heldByInstitutionsPct: null,
    heldByInsidersPct: null,
    trailingPe: n(m.peTTM),
    forwardPe: n(m.forwardPE),
    revenueGrowthYoyPct: n(m.revenueGrowthQuarterlyYoy),
    earningsGrowthYoyPct: n(m.epsGrowthQuarterlyYoy),
    grossMarginPct: n(m.grossMarginTTM),
    operatingMarginPct: n(m.operatingMarginTTM),
    totalRevenue: null,
    nextEarningsDate: next ?? null,
    quarterlyEps,
    quarterlyRevenue: [],
    source: 'finnhub',
  }
}
