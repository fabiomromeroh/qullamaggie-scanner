/**
 * Ticker modal API.
 *   GET /api/ticker/:sym/summary                 quote card + $Vol + ADR%
 *   GET /api/ticker/:sym/intraday?interval=1m|30m|1h
 *   GET /api/ticker/:sym/fundamentals            Yahoo quoteSummary fields
 *   GET /api/ticker/:sym/filings                 SEC EDGAR recent filings
 * News stays on the scanner's /api/market/news/:symbol.
 */
import { adrPct, avgDollarVolume, buildTickerCikMap, parseRecentFilings, type FilingRow } from '../src/lib/tickerStats.ts'
import { sendJson } from './marketPulse.ts'
import {
  getBatchQuotes,
  getDailySeries,
  getIntradayBars,
  getQuoteSummary,
  ttlMemo,
  type IntradayInterval,
} from './yahooClient.ts'

type MiniReq = { url?: string; method?: string }
type MiniRes = Parameters<typeof sendJson>[0]

const SYMBOL_RE = /^[A-Z0-9.^=-]{1,12}$/

export async function getTickerSummary(symbol: string) {
  const [quotes, series] = await Promise.all([
    getBatchQuotes([symbol]).catch(() => []),
    getDailySeries(symbol, '1y').catch(() => null),
  ])
  const q = quotes[0]
  if (!q && !series) throw new Error(`No data for ${symbol}`)
  const last = series?.bars[series.bars.length - 1]
  const price = q?.price ?? series!.price
  const prevClose = q?.prevClose ?? series?.prevClose
  return {
    symbol,
    name: q?.name ?? series?.name,
    quote: {
      price,
      prevClose: prevClose ?? null,
      change: prevClose ? price - prevClose : null,
      changePct: q?.changePct ?? (prevClose ? (price / prevClose - 1) * 100 : null),
      open: q?.open ?? last?.o ?? null,
      high: q?.high ?? last?.h ?? null,
      low: q?.low ?? last?.l ?? null,
      volume: q?.volume ?? last?.v ?? null,
      avgVolume: q?.avgVolume ?? null,
      marketCap: q?.marketCap ?? null,
    },
    adrPct: series ? adrPct(series.bars, 20) : null,
    dollarVolume20: series ? avgDollarVolume(series.bars, 20) : null,
    asOf: new Date().toISOString(),
    source: 'yahoo',
  }
}

function raw(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  const r = (v as { raw?: unknown } | null | undefined)?.raw
  return typeof r === 'number' && Number.isFinite(r) ? r : null
}

const fundamentalsMemo = ttlMemo<Record<string, unknown>>(6 * 60 * 60 * 1000)

export function getFundamentals(symbol: string) {
  return fundamentalsMemo(symbol, async () => {
    const s = await getQuoteSummary(symbol, [
      'assetProfile',
      'price',
      'defaultKeyStatistics',
      'financialData',
      'calendarEvents',
      'earnings',
      'summaryDetail',
    ])
    const profile = (s.assetProfile ?? {}) as Record<string, unknown>
    const price = (s.price ?? {}) as Record<string, unknown>
    const stats = (s.defaultKeyStatistics ?? {}) as Record<string, unknown>
    const fin = (s.financialData ?? {}) as Record<string, unknown>
    const detail = (s.summaryDetail ?? {}) as Record<string, unknown>
    const cal = (s.calendarEvents ?? {}) as { earnings?: { earningsDate?: unknown[] } }
    const earnings = (s.earnings ?? {}) as {
      earningsChart?: { quarterly?: Array<{ date?: string; actual?: unknown; estimate?: unknown }> }
      financialsChart?: { quarterly?: Array<{ date?: string; revenue?: unknown; earnings?: unknown }> }
    }
    const pct = (v: unknown) => {
      const n = raw(v)
      return n == null ? null : n * 100
    }
    const nextEarnings = (cal.earnings?.earningsDate ?? [])
      .map((d) => raw(d))
      .filter((d): d is number => d != null)
      .sort((a, b) => a - b)[0]
    return {
      symbol,
      name: (price.longName as string) || (price.shortName as string) || null,
      sector: (profile.sector as string) || null,
      industry: (profile.industry as string) || null,
      country: (profile.country as string) || null,
      website: (profile.website as string) || null,
      employees: raw(profile.fullTimeEmployees),
      summary: (profile.longBusinessSummary as string) || null,
      marketCap: raw(price.marketCap) ?? raw(detail.marketCap),
      sharesOutstanding: raw(stats.sharesOutstanding),
      floatShares: raw(stats.floatShares),
      shortPctFloat: pct(stats.shortPercentOfFloat),
      shortRatio: raw(stats.shortRatio),
      heldByInstitutionsPct: pct(stats.heldPercentInstitutions),
      heldByInsidersPct: pct(stats.heldPercentInsiders),
      trailingPe: raw(detail.trailingPE),
      forwardPe: raw(detail.forwardPE) ?? raw(stats.forwardPE),
      revenueGrowthYoyPct: pct(fin.revenueGrowth),
      earningsGrowthYoyPct: pct(fin.earningsGrowth),
      grossMarginPct: pct(fin.grossMargins),
      operatingMarginPct: pct(fin.operatingMargins),
      totalRevenue: raw(fin.totalRevenue),
      nextEarningsDate: nextEarnings ? new Date(nextEarnings * 1000).toISOString().slice(0, 10) : null,
      quarterlyEps: (earnings.earningsChart?.quarterly ?? []).map((q) => ({
        period: q.date ?? '',
        actual: raw(q.actual),
        estimate: raw(q.estimate),
      })),
      quarterlyRevenue: (earnings.financialsChart?.quarterly ?? []).map((q) => ({
        period: q.date ?? '',
        revenue: raw(q.revenue),
        earnings: raw(q.earnings),
      })),
      source: 'yahoo',
    }
  })
}

/**
 * SEC asks automated clients to send a User-Agent naming the app and a contact
 * email. No contact is hard-coded: set SEC_EDGAR_USER_AGENT (e.g.
 * "qullamaggie-scanner you@example.com"). Without it the Filings tab only links to
 * the EDGAR company page (ticker lookup) instead of fetching.
 */
export function secUserAgent(): string | null {
  const ua = process.env.SEC_EDGAR_USER_AGENT?.trim()
  return ua ? ua : null
}

async function secJson(url: string, ua: string): Promise<unknown> {
  const res = await fetch(url, {
    headers: { 'User-Agent': ua, Accept: 'application/json' },
    signal: AbortSignal.timeout(15_000),
  })
  if (!res.ok) throw new Error(`SEC HTTP ${res.status}`)
  return res.json()
}

const cikMapMemo = ttlMemo<Map<string, number>>(24 * 60 * 60 * 1000)
const filingsMemo = ttlMemo<FilingRow[]>(30 * 60 * 1000)

export function edgarBrowseUrl(symbol: string): string {
  return `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${encodeURIComponent(symbol)}&owner=include&count=40`
}

export async function getFilings(symbol: string) {
  const ua = secUserAgent()
  const browseUrl = edgarBrowseUrl(symbol)
  if (!ua) {
    return {
      symbol,
      configured: false,
      browseUrl,
      filings: [] as FilingRow[],
      note: 'SEC_EDGAR_USER_AGENT is not set on the server (SEC requires an app name + contact email).',
    }
  }
  const map = await cikMapMemo('map', async () =>
    buildTickerCikMap(await secJson('https://www.sec.gov/files/company_tickers.json', ua)),
  )
  const cik = map.get(symbol) ?? map.get(symbol.replace(/\./g, '-'))
  if (!cik) return { symbol, configured: true, browseUrl, filings: [], note: 'No SEC CIK for this ticker (ETF, fund or foreign issuer?).' }
  const filings = await filingsMemo(symbol, async () =>
    parseRecentFilings(
      await secJson(`https://data.sec.gov/submissions/CIK${String(cik).padStart(10, '0')}.json`, ua),
      cik,
    ),
  )
  return {
    symbol,
    configured: true,
    cik,
    browseUrl: `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${cik}&type=&dateb=&owner=include&count=40`,
    filings,
  }
}

export function createTickerMiddleware() {
  return async function tickerMiddleware(req: MiniReq, res: MiniRes, next: () => void) {
    const url = new URL(req.url ?? '/', 'http://localhost')
    const m = url.pathname.replace(/\/+$/, '').match(/^\/api\/ticker\/([^/]+)\/(summary|intraday|fundamentals|filings)$/)
    if (!m) {
      next()
      return
    }
    const symbol = decodeURIComponent(m[1]!).toUpperCase()
    if (!SYMBOL_RE.test(symbol)) {
      sendJson(res, 400, { error: 'Invalid symbol' })
      return
    }
    try {
      switch (m[2]) {
        case 'summary':
          sendJson(res, 200, await getTickerSummary(symbol))
          return
        case 'intraday': {
          const interval = url.searchParams.get('interval') ?? '30m'
          if (interval !== '1m' && interval !== '30m' && interval !== '1h') {
            sendJson(res, 400, { error: 'interval must be 1m, 30m or 1h' })
            return
          }
          const bars = await getIntradayBars(symbol, interval as IntradayInterval)
          sendJson(res, 200, { symbol, interval, bars, source: 'yahoo' })
          return
        }
        case 'fundamentals':
          sendJson(res, 200, await getFundamentals(symbol))
          return
        case 'filings':
          sendJson(res, 200, await getFilings(symbol))
          return
      }
    } catch (err) {
      sendJson(res, 502, { error: err instanceof Error ? err.message : 'request failed' })
    }
  }
}
