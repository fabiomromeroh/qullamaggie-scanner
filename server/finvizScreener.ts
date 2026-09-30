/**
 * Finviz industry screener (performance view, first page only).
 * Cache is per (slug, order) for 12 minutes. A failed refetch keeps the last
 * good page and marks it stale. In-flight calls for the same key share one fetch.
 * Requests go through the shared Finviz queue (concurrency 2, ~400ms gap).
 *
 * Leader: a parsed row whose selected-period performance is > 0 and whose
 * ticker is in the current scan cache (Stage 1 / 1.5 / 2 survivors, so above
 * the 200-day and 50-day SMAs). Count is null when that cache is not ready.
 */
import type { GroupLeadersEntry, GroupLeadersResponse, GroupPeriod } from '../src/types/index.ts'
import {
  countGroupLeaders,
  finvizLiquidityTokens,
  periodOrder,
} from '../src/lib/groupPeriod.ts'
import { MIN_AVG_DAILY_VOL, MIN_PRICE } from './yahooScreener.ts'
import { loadScanCache } from './scanCache.ts'
import {
  FINVIZ_CACHE_TTL_MS,
  finvizFetchText,
  looksLikeFinvizChallenge,
} from './finvizHttp.ts'
import {
  parseFinvizScreenerPerformance,
  screenerPeriodPerf,
  type FinvizScreenerRow,
} from './finvizScreenerParse.ts'

export interface ScreenerPage {
  rows: FinvizScreenerRow[]
  fetchedAt: string
  stale: boolean
}

interface CacheEntry {
  rows: FinvizScreenerRow[]
  fetchedAt: string
  storedAt: number
}

const cache = new Map<string, CacheEntry>()
const inFlight = new Map<string, Promise<CacheEntry>>()

export function buildFinvizScreenerUrl(slug: string, order: string): string {
  const tokens = finvizLiquidityTokens(MIN_PRICE, MIN_AVG_DAILY_VOL)
  const filters = `ind_${slug},${tokens.price},${tokens.avgVol}`
  const url = new URL('https://finviz.com/screener.ashx')
  url.searchParams.set('v', '141')
  url.searchParams.set('f', filters)
  url.searchParams.set('o', order)
  return url.toString()
}

function cacheKey(slug: string, order: string): string {
  return `${slug}|${order}`
}

async function fetchFresh(slug: string, order: string): Promise<CacheEntry> {
  const url = buildFinvizScreenerUrl(slug, order)
  const { status, html } = await finvizFetchText(url)
  if (status === 403 || status === 429 || status === 503) {
    throw new Error(`Finviz screener blocked (HTTP ${status})`)
  }
  if (status < 200 || status >= 300) {
    throw new Error(`Finviz screener HTTP ${status}`)
  }
  if (looksLikeFinvizChallenge(html) && !html.includes('screener_table')) {
    throw new Error('Finviz screener blocked (challenge page)')
  }
  const parsed = parseFinvizScreenerPerformance(html)
  if (!parsed.ok) {
    const blocked = parsed.reason === 'blocked'
    throw new Error(
      blocked ? 'Finviz screener blocked (challenge page)' : `Finviz screener parse failed (${parsed.reason})`,
    )
  }
  return {
    rows: parsed.rows,
    fetchedAt: new Date().toISOString(),
    storedAt: Date.now(),
  }
}

function fetchDeduped(slug: string, order: string): Promise<CacheEntry> {
  const key = cacheKey(slug, order)
  const existing = inFlight.get(key)
  if (existing) return existing
  const pending = fetchFresh(slug, order)
    .then((entry) => {
      cache.set(key, entry)
      return entry
    })
    .finally(() => {
      inFlight.delete(key)
    })
  inFlight.set(key, pending)
  return pending
}

/** First-page screener rows for one industry slug and Finviz order value. */
export async function getScreenerPage(slug: string, order: string): Promise<ScreenerPage> {
  const key = cacheKey(slug, order)
  const hit = cache.get(key)
  const fresh = hit != null && Date.now() - hit.storedAt < FINVIZ_CACHE_TTL_MS
  if (hit && fresh) {
    return { rows: hit.rows, fetchedAt: hit.fetchedAt, stale: false }
  }
  try {
    const entry = await fetchDeduped(slug, order)
    return { rows: entry.rows, fetchedAt: entry.fetchedAt, stale: false }
  } catch (err) {
    if (hit) return { rows: hit.rows, fetchedAt: hit.fetchedAt, stale: true }
    throw err
  }
}

function scanTickerSet(): Set<string> | null {
  const ideas = loadScanCache()?.ideas
  if (!ideas || ideas.length === 0) return null
  return new Set(ideas.map((idea) => idea.ticker.toUpperCase()))
}

function toEntry(
  slug: string,
  period: GroupPeriod,
  page: ScreenerPage,
  scanTickers: Set<string> | null,
  error?: string,
): GroupLeadersEntry {
  const leaders = page.rows.map((row) => {
    const ticker = row.ticker.toUpperCase()
    return {
      ticker,
      company: row.company,
      perf: screenerPeriodPerf(row, period),
      price: row.price,
      changePct: row.changePct,
      relVolume: row.relVolume,
      avgVolume: row.avgVolume,
      inScan: scanTickers ? scanTickers.has(ticker) : null,
    }
  })
  const counted = countGroupLeaders(leaders, scanTickers)
  const top5 = [...leaders]
    .sort((a, b) => {
      if (a.perf == null && b.perf == null) return 0
      if (a.perf == null) return 1
      if (b.perf == null) return -1
      return b.perf - a.perf
    })
    .slice(0, 5)
  const entry: GroupLeadersEntry = {
    slug,
    period,
    fetchedAt: page.fetchedAt,
    stale: page.stale,
    leaders,
    top5,
    inScanCount: counted.inScanCount,
    parsedCount: counted.parsedCount,
  }
  if (error) entry.error = error
  return entry
}

function emptyEntry(slug: string, period: GroupPeriod, error: string): GroupLeadersEntry {
  return {
    slug,
    period,
    fetchedAt: null,
    stale: false,
    error,
    leaders: [],
    top5: [],
    inScanCount: null,
    parsedCount: 0,
  }
}

async function leadersForSlug(
  slug: string,
  period: GroupPeriod,
  order: string,
  scanTickers: Set<string> | null,
): Promise<GroupLeadersEntry> {
  try {
    const page = await getScreenerPage(slug, order)
    return toEntry(slug, period, page, scanTickers)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Finviz screener failed'
    return emptyEntry(slug, period, message)
  }
}

export async function getGroupLeaders(
  slugs: string[],
  period: GroupPeriod,
): Promise<GroupLeadersResponse> {
  const order = periodOrder(period)
  const scanTickers = scanTickerSet()
  const groups = await Promise.all(
    slugs.map((slug) => leadersForSlug(slug, period, order, scanTickers)),
  )
  return { period, order, groups }
}
