/**
 * Small Yahoo Finance client for Market Pulse, the ticker modal and breadth.
 * Daily bars are parsed with the scanner's `parseYahooChart`; batch quotes use
 * the scanner's cookie + crumb (`refreshYahooCrumb`). Every call goes through a
 * concurrency gate and is counted so request cost can be reported.
 * Unofficial endpoints: they can change or rate-limit without notice.
 */
import { parseYahooChart, type DailyBar } from './marketProxy.ts'
import { createJobQueue } from './requestBudget.ts'
import { refreshYahooCrumb } from './yahooScreener.ts'

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36'
const HEADERS: Record<string, string> = {
  'User-Agent': UA,
  Accept: 'application/json,text/plain,*/*',
  'Accept-Language': 'en-US,en;q=0.9',
  Referer: 'https://finance.yahoo.com/',
  Origin: 'https://finance.yahoo.com',
}

const queue = createJobQueue(Number(process.env.YAHOO_CONCURRENCY) || 4)
let requestCount = 0

/** Total Yahoo HTTP requests made by this client since boot (or last reset). */
export function yahooRequestCount(): number {
  return requestCount
}
export function resetYahooRequestCount(): void {
  requestCount = 0
}

async function sleep(ms: number): Promise<void> {
  await new Promise((r) => setTimeout(r, ms))
}

async function getJson(url: string, extraHeaders: Record<string, string> = {}): Promise<unknown> {
  await queue.acquire()
  try {
    let last: Error | null = null
    for (let attempt = 0; attempt < 3; attempt++) {
      if (attempt > 0) await sleep(600 * attempt)
      requestCount++
      try {
        const res = await fetch(url, {
          headers: { ...HEADERS, ...extraHeaders },
          signal: AbortSignal.timeout(15_000),
        })
        if (res.status === 429 || res.status >= 500) {
          last = new Error(`HTTP ${res.status}`)
          await res.arrayBuffer()
          continue
        }
        if (!res.ok) throw new Error(`HTTP ${res.status} (${url.split('?')[0]})`)
        return await res.json()
      } catch (err) {
        last = err instanceof Error ? err : new Error(String(err))
        if (/HTTP 4\d\d/.test(last.message) && !/429/.test(last.message)) throw last
      }
    }
    throw last ?? new Error('request failed')
  } finally {
    queue.release()
  }
}

export interface DailySeries {
  symbol: string
  name?: string
  price: number
  prevClose: number
  regularMarketTime?: number
  bars: DailyBar[]
}

interface CacheEntry<T> {
  at: number
  value: Promise<T>
}

function ttlMemo<T>(ttlMs: number) {
  const map = new Map<string, CacheEntry<T>>()
  return (key: string, load: () => Promise<T>): Promise<T> => {
    const hit = map.get(key)
    if (hit && Date.now() - hit.at < ttlMs) return hit.value
    const value = load()
    map.set(key, { at: Date.now(), value })
    value.catch(() => {
      if (map.get(key)?.value === value) map.delete(key)
    })
    return value
  }
}

const dailyMemo = ttlMemo<DailySeries>(5 * 60 * 1000)

/** Daily bars (range 1y by default) plus live price / previous close. Cached 5 min. */
export function getDailySeries(symbol: string, range: '1y' | '2y' = '1y'): Promise<DailySeries> {
  return dailyMemo(`${symbol}:${range}`, async () => {
    const raw = await getJson(
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=${range}&includePrePost=false`,
    )
    const parsed = parseYahooChart(raw, symbol, range)
    return { symbol, ...parsed }
  })
}

/** Uncached daily bars, for bulk jobs (breadth) that must not fill the 5-min memo. */
export async function fetchDailyBarsUncached(symbol: string, range: '1y' | '2y' = '2y'): Promise<DailyBar[]> {
  const raw = await getJson(
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=${range}&includePrePost=false`,
  )
  return parseYahooChart(raw, symbol, range).bars
}

export type IntradayInterval = '1m' | '30m' | '1h'

export const INTRADAY_RANGE: Record<IntradayInterval, string> = {
  '1m': '1d',
  '30m': '1mo',
  '1h': '3mo',
}

const intradayMemo = ttlMemo<DailyBar[]>(60 * 1000)

/** Intraday bars (regular session only). Yahoo caps 1m history at ~7 days. */
export function getIntradayBars(symbol: string, interval: IntradayInterval): Promise<DailyBar[]> {
  return intradayMemo(`${symbol}:${interval}`, async () => {
    const raw = (await getJson(
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=${interval}&range=${INTRADAY_RANGE[interval]}&includePrePost=false`,
    )) as {
      chart?: {
        result?: Array<{
          timestamp?: number[]
          indicators?: { quote?: Array<Record<'open' | 'high' | 'low' | 'close' | 'volume', (number | null)[]>> }
        }>
      }
    }
    const r = raw.chart?.result?.[0]
    const q = r?.indicators?.quote?.[0]
    if (!r?.timestamp?.length || !q) throw new Error(`No intraday bars for ${symbol}`)
    const out: DailyBar[] = []
    r.timestamp.forEach((t, i) => {
      const c = q.close?.[i]
      if (c == null || !Number.isFinite(c)) return
      out.push({ t, o: q.open?.[i] ?? c, h: q.high?.[i] ?? c, l: q.low?.[i] ?? c, c, v: q.volume?.[i] ?? 0 })
    })
    return out
  })
}

export interface BatchQuote {
  symbol: string
  name?: string
  price: number
  changePct: number
  open?: number
  high?: number
  low?: number
  prevClose?: number
  volume?: number
  avgVolume?: number
  marketCap?: number
}

function num(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined
}

/** Yahoo v7 quote in chunks of 50 symbols (crumb required). */
export async function getBatchQuotes(symbols: readonly string[]): Promise<BatchQuote[]> {
  const out: BatchQuote[] = []
  let auth = await refreshYahooCrumb()
  for (let i = 0; i < symbols.length; i += 50) {
    const chunk = symbols.slice(i, i + 50)
    const url = (crumb: string) =>
      `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(chunk.join(','))}&crumb=${encodeURIComponent(crumb)}`
    let raw: unknown
    try {
      raw = await getJson(url(auth.crumb), { Cookie: auth.cookie })
    } catch (err) {
      if (!/HTTP 40[13]/.test(err instanceof Error ? err.message : '')) throw err
      auth = await refreshYahooCrumb(true)
      raw = await getJson(url(auth.crumb), { Cookie: auth.cookie })
    }
    const rows = (raw as { quoteResponse?: { result?: Record<string, unknown>[] } }).quoteResponse?.result ?? []
    for (const r of rows) {
      const price = num(r.regularMarketPrice)
      const changePct = num(r.regularMarketChangePercent)
      if (typeof r.symbol !== 'string' || price == null || changePct == null) continue
      out.push({
        symbol: r.symbol,
        name: (r.shortName as string) || (r.longName as string) || undefined,
        price,
        changePct,
        open: num(r.regularMarketOpen),
        high: num(r.regularMarketDayHigh),
        low: num(r.regularMarketDayLow),
        prevClose: num(r.regularMarketPreviousClose),
        volume: num(r.regularMarketVolume),
        avgVolume: num(r.averageDailyVolume3Month) ?? num(r.averageDailyVolume10Day),
        marketCap: num(r.marketCap),
      })
    }
  }
  return out
}

/** Yahoo quoteSummary modules (crumb required). */
export async function getQuoteSummary(symbol: string, modules: readonly string[]): Promise<Record<string, unknown>> {
  let auth = await refreshYahooCrumb()
  const url = (crumb: string) =>
    `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(symbol)}?modules=${modules.join(',')}&crumb=${encodeURIComponent(crumb)}`
  let raw: unknown
  try {
    raw = await getJson(url(auth.crumb), { Cookie: auth.cookie })
  } catch (err) {
    if (!/HTTP 40[13]/.test(err instanceof Error ? err.message : '')) throw err
    auth = await refreshYahooCrumb(true)
    raw = await getJson(url(auth.crumb), { Cookie: auth.cookie })
  }
  const result = (raw as { quoteSummary?: { result?: Record<string, unknown>[] } }).quoteSummary?.result?.[0]
  if (!result) throw new Error(`No quoteSummary for ${symbol}`)
  return result
}

export { ttlMemo }
