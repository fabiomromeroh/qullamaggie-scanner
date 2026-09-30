/**
 * Optional live Finviz performance screener (first page only).
 * Request-time callers use this only when FINVIZ_SCREENER_LIVE=1.
 * The default is off, so production makes no request to finviz.com/screener.ashx.
 * Cache is per (slug, order) for 12 minutes. A failed refetch keeps the last
 * good page and marks it stale. In-flight calls for the same key share one fetch.
 */
import { finvizLiquidityTokens } from '../src/lib/groupPeriod.ts'
import { MIN_AVG_DAILY_VOL, MIN_PRICE } from './yahooScreener.ts'
import {
  FINVIZ_CACHE_TTL_MS,
  finvizFetchText,
  looksLikeFinvizChallenge,
} from './finvizHttp.ts'
import {
  parseFinvizScreenerPerformance,
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

/** True only when the operator opts into request-time screener fetches. */
export function finvizScreenerLiveEnabled(): boolean {
  const raw = (process.env.FINVIZ_SCREENER_LIVE ?? '').trim().toLowerCase()
  return raw === '1' || raw === 'true'
}

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
