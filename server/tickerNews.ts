/**
 * Latest headlines for a ticker.
 * Primary: Finnhub /company-news (7-day window). Fallback: Yahoo search news.
 * Key stays on the server. ~10 min cache, in-flight de-dup, stale-on-error.
 */
import { createSymbolCache } from './ttlCache.ts'

export const NEWS_CACHE_TTL_MS = 10 * 60 * 1000
export const NEWS_TIMEOUT_MS = 8000
export const NEWS_CAP = 10

const DESKTOP_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36'

export interface NewsItem {
  headline: string
  source: string
  datetime: string
  url: string
  summary?: string
}

export interface TickerNewsPayload {
  symbol: string
  source: 'finnhub' | 'yahoo'
  fetchedAt: string
  items: NewsItem[]
  error?: string
}

export function isHttpUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}

function unixToIso(value: unknown): string | null {
  if (typeof value === 'string' && value.trim()) {
    const parsed = Date.parse(value)
    if (Number.isFinite(parsed)) return new Date(parsed).toISOString()
  }
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null
  const ms = value > 1e12 ? value : value * 1000
  const date = new Date(ms)
  if (Number.isNaN(date.getTime())) return null
  return date.toISOString()
}

function ymdUtc(date: Date): string {
  return date.toISOString().slice(0, 10)
}

export function newsWindowUtc(now = new Date()): { from: string; to: string } {
  const to = ymdUtc(now)
  const fromDate = new Date(now.getTime())
  fromDate.setUTCDate(fromDate.getUTCDate() - 7)
  return { from: ymdUtc(fromDate), to }
}

export function parseFinnhubNews(raw: unknown): NewsItem[] {
  if (!Array.isArray(raw)) return []
  const items: NewsItem[] = []
  for (const row of raw) {
    if (!row || typeof row !== 'object') continue
    const rec = row as Record<string, unknown>
    const headline = typeof rec.headline === 'string' ? rec.headline.trim() : ''
    const url = typeof rec.url === 'string' ? rec.url.trim() : ''
    const datetime = unixToIso(rec.datetime)
    if (!headline || !url || !datetime || !isHttpUrl(url)) continue
    const source =
      typeof rec.source === 'string' && rec.source.trim() ? rec.source.trim() : 'Finnhub'
    const summary =
      typeof rec.summary === 'string' && rec.summary.trim() ? rec.summary.trim() : undefined
    const item: NewsItem = { headline, source, datetime, url }
    if (summary) item.summary = summary
    items.push(item)
  }
  return items
}

export function parseYahooNews(raw: unknown): NewsItem[] {
  const body = raw as { news?: unknown[] } | null
  const rows = Array.isArray(body?.news) ? body.news : Array.isArray(raw) ? raw : []
  const items: NewsItem[] = []
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue
    const rec = row as Record<string, unknown>
    const headline = typeof rec.title === 'string' ? rec.title.trim() : ''
    const url = typeof rec.link === 'string' ? rec.link.trim() : ''
    const datetime = unixToIso(rec.providerPublishTime)
    if (!headline || !url || !datetime || !isHttpUrl(url)) continue
    const source =
      typeof rec.publisher === 'string' && rec.publisher.trim()
        ? rec.publisher.trim()
        : 'Yahoo'
    items.push({ headline, source, datetime, url })
  }
  return items
}

export function finalizeNewsItems(items: NewsItem[], cap = NEWS_CAP): NewsItem[] {
  const sorted = [...items].sort(
    (a, b) => Date.parse(b.datetime) - Date.parse(a.datetime),
  )
  const seenUrl = new Set<string>()
  const seenHeadline = new Set<string>()
  const out: NewsItem[] = []
  for (const item of sorted) {
    if (!isHttpUrl(item.url)) continue
    const urlKey = item.url.replace(/\/+$/, '').toLowerCase()
    const headKey = item.headline.trim().toLowerCase()
    if (!headKey || seenUrl.has(urlKey) || seenHeadline.has(headKey)) continue
    seenUrl.add(urlKey)
    seenHeadline.add(headKey)
    out.push(item)
    if (out.length >= cap) break
  }
  return out
}

async function fetchJson(
  url: string,
  headers: Record<string, string>,
  timeoutMs = NEWS_TIMEOUT_MS,
): Promise<{ status: number; json: unknown }> {
  const res = await fetch(url, {
    headers,
    signal: AbortSignal.timeout(timeoutMs),
  })
  let json: unknown = null
  try {
    json = await res.json()
  } catch {
    json = null
  }
  return { status: res.status, json }
}

function originOnly(url: string): string {
  try {
    const u = new URL(url)
    return `${u.origin}${u.pathname}`
  } catch {
    return url.split('?')[0] ?? url
  }
}

async function loadFinnhubNews(symbol: string, token: string): Promise<NewsItem[]> {
  const { from, to } = newsWindowUtc()
  const url =
    `https://finnhub.io/api/v1/company-news?symbol=${encodeURIComponent(symbol)}` +
    `&from=${from}&to=${to}&token=${encodeURIComponent(token)}`
  const { status, json } = await fetchJson(url, { Accept: 'application/json' })
  if (status === 401 || status === 403) {
    throw new Error(`Finnhub news HTTP ${status}`)
  }
  if (status === 429) {
    throw new Error('Finnhub news rate limited (429)')
  }
  if (status !== 200) {
    throw new Error(`Finnhub news HTTP ${status} (${originOnly(url)})`)
  }
  return parseFinnhubNews(json)
}

async function loadYahooNews(symbol: string): Promise<NewsItem[]> {
  const hosts = ['query1.finance.yahoo.com', 'query2.finance.yahoo.com']
  const errors: string[] = []
  for (const host of hosts) {
    const url =
      `https://${host}/v1/finance/search?q=${encodeURIComponent(symbol)}` +
      `&newsCount=10&quotesCount=0`
    try {
      const { status, json } = await fetchJson(url, {
        Accept: 'application/json,text/plain,*/*',
        'User-Agent': DESKTOP_UA,
        'Accept-Language': 'en-US,en;q=0.9',
      })
      if (status === 401 || status === 403) {
        errors.push(`${host}: HTTP ${status}`)
        continue
      }
      if (status === 429) {
        errors.push(`${host}: HTTP 429`)
        continue
      }
      if (status !== 200) {
        errors.push(`${host}: HTTP ${status}`)
        continue
      }
      return parseYahooNews(json)
    } catch (err) {
      errors.push(`${host}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
  throw new Error(`Yahoo news failed (${errors.join('; ') || 'no host'})`)
}

const newsCache = createSymbolCache<TickerNewsPayload>({
  ttlMs: NEWS_CACHE_TTL_MS,
  staleOnError: true,
})

async function loadNews(symbol: string, finnhubKey: string | undefined): Promise<TickerNewsPayload> {
  const fetchedAt = new Date().toISOString()
  const errors: string[] = []

  if (finnhubKey) {
    try {
      const items = finalizeNewsItems(await loadFinnhubNews(symbol, finnhubKey))
      if (items.length) {
        return { symbol, source: 'finnhub', fetchedAt, items }
      }
    } catch (err) {
      errors.push(err instanceof Error ? err.message : String(err))
    }
  }

  try {
    const items = finalizeNewsItems(await loadYahooNews(symbol))
    const payload: TickerNewsPayload = { symbol, source: 'yahoo', fetchedAt, items }
    if (!items.length && errors.length) payload.error = errors.join('; ')
    return payload
  } catch (err) {
    errors.push(err instanceof Error ? err.message : String(err))
    throw new Error(errors.join('; ') || 'News unavailable')
  }
}

export async function fetchTickerNews(
  symbol: string,
  finnhubKey: string | undefined,
): Promise<TickerNewsPayload> {
  try {
    return await newsCache.get(symbol, () => loadNews(symbol, finnhubKey))
  } catch (err) {
    return {
      symbol,
      source: 'yahoo',
      fetchedAt: new Date().toISOString(),
      items: [],
      error: err instanceof Error ? err.message : 'News unavailable',
    }
  }
}

export function clearNewsCache(): void {
  newsCache.clear()
}
