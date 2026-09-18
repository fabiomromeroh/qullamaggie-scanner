/**
 * Server-side market data helpers for Vite middleware.
 * Cascade: Finnhub (official free tier) → Yahoo Finance (unofficial) → Stooq (public CSV).
 * API key stays on the server via process.env / .env — never sent to the browser.
 *
 * Note: Finnhub free tier often allows /quote but not /stock/candle. In that case the
 * Finnhub step uses Finnhub quote + Yahoo daily bars (still preferred over full Yahoo-only).
 *
 * In-memory snapshot cache (default 10 min) keeps broad scans Finnhub free-tier friendly.
 */
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { getScanRuntimeStatus, loadScanCache } from './scanCache.ts'
import { kickScanOnBoot, triggerScan } from './scanEngine.ts'
import { refreshYahooCrumb } from './yahooScreener.ts'

export interface DailyBar {
  t: number
  o: number
  h: number
  l: number
  c: number
  v: number
}

export interface SymbolSnapshot {
  symbol: string
  name?: string
  price: number
  prevClose: number
  bars: DailyBar[]
  provider: 'finnhub' | 'finnhub+yahoo' | 'yahoo' | 'stooq'
}

function loadDotEnv(): void {
  const envPath = resolve(process.cwd(), '.env')
  if (!existsSync(envPath)) return
  const text = readFileSync(envPath, 'utf8')
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq <= 0) continue
    const key = trimmed.slice(0, eq).trim()
    let val = trimmed.slice(eq + 1).trim()
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1)
    }
    if (process.env[key] === undefined) process.env[key] = val
  }
}

loadDotEnv()

export function getFinnhubKey(): string | undefined {
  const key =
    process.env.FINNHUB_API_KEY?.trim() ||
    process.env.VITE_FINNHUB_API_KEY?.trim()
  return key || undefined
}

const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36'

const BROWSER_HEADERS: Record<string, string> = {
  'User-Agent': BROWSER_UA,
  Accept: 'application/json,text/plain,*/*',
  'Accept-Language': 'en-US,en;q=0.9',
  Referer: 'https://finance.yahoo.com/',
  Origin: 'https://finance.yahoo.com',
}

async function sleep(ms: number): Promise<void> {
  await new Promise((r) => setTimeout(r, ms))
}

async function fetchJson(url: string, init?: RequestInit): Promise<unknown> {
  const isYahoo = url.includes('finance.yahoo.com')
  const attempts = isYahoo ? 3 : 1
  let lastErr: Error | null = null

  for (let attempt = 0; attempt < attempts; attempt++) {
    if (attempt > 0) await sleep(500 * attempt)
    try {
      const res = await fetch(url, {
        ...init,
        headers: {
          ...BROWSER_HEADERS,
          ...(init?.headers ?? {}),
        },
      })
      if (res.status === 429 && isYahoo) {
        lastErr = new Error(`HTTP 429 (${url.split('?')[0]})`)
        continue
      }
      if (!res.ok) {
        let detail = ''
        try {
          const body = (await res.json()) as { error?: string }
          if (body.error) detail = `: ${body.error}`
        } catch {
          /* ignore */
        }
        throw new Error(`HTTP ${res.status}${detail} (${url.split('?')[0]})`)
      }
      return res.json()
    } catch (err) {
      lastErr = err instanceof Error ? err : new Error(String(err))
      if (!isYahoo) throw lastErr
    }
  }
  throw lastErr ?? new Error('fetchJson failed')
}

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: {
      ...BROWSER_HEADERS,
      Accept: 'text/csv,text/plain,*/*',
    },
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.text()
}

function nowSec(): number {
  return Math.floor(Date.now() / 1000)
}

async function finnhubQuote(
  symbol: string,
  token: string,
): Promise<{ c: number; pc: number }> {
  const quote = (await fetchJson(
    `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(symbol)}&token=${encodeURIComponent(token)}`,
  )) as { c?: number; pc?: number }

  if (typeof quote.c !== 'number' || !(quote.c > 0)) {
    throw new Error(`Finnhub quote empty for ${symbol}`)
  }
  return {
    c: quote.c,
    pc: typeof quote.pc === 'number' && quote.pc > 0 ? quote.pc : quote.c,
  }
}

async function finnhubCandles(symbol: string, token: string): Promise<DailyBar[]> {
  const to = nowSec()
  const from = to - 400 * 86400
  const candle = (await fetchJson(
    `https://finnhub.io/api/v1/stock/candle?symbol=${encodeURIComponent(symbol)}&resolution=D&from=${from}&to=${to}&token=${encodeURIComponent(token)}`,
  )) as {
    s?: string
    t?: number[]
    o?: number[]
    h?: number[]
    l?: number[]
    c?: number[]
    v?: number[]
    error?: string
  }

  if (candle.error) throw new Error(candle.error)
  if (candle.s !== 'ok' || !candle.t?.length || !candle.c?.length) {
    throw new Error(`Finnhub candle unavailable (s=${candle.s ?? 'missing'})`)
  }

  return candle.t.map((t, i) => ({
    t,
    o: candle.o![i]!,
    h: candle.h![i]!,
    l: candle.l![i]!,
    c: candle.c![i]!,
    v: candle.v![i] ?? 0,
  }))
}

function parseYahooChart(raw: unknown, symbol: string): {
  bars: DailyBar[]
  name?: string
  price: number
  prevClose: number
} {
  const data = raw as {
    chart?: {
      result?: Array<{
        meta?: {
          shortName?: string
          longName?: string
          regularMarketPrice?: number
          chartPreviousClose?: number
          previousClose?: number
        }
        timestamp?: number[]
        indicators?: {
          quote?: Array<{
            open?: (number | null)[]
            high?: (number | null)[]
            low?: (number | null)[]
            close?: (number | null)[]
            volume?: (number | null)[]
          }>
        }
      }>
    }
  }

  const result = data.chart?.result?.[0]
  if (!result?.timestamp?.length) {
    throw new Error(`Yahoo chart empty for ${symbol}`)
  }
  const q = result.indicators?.quote?.[0]
  if (!q?.close?.length) throw new Error(`Yahoo quote arrays missing for ${symbol}`)

  const bars: DailyBar[] = []
  for (let i = 0; i < result.timestamp.length; i++) {
    const c = q.close[i]
    if (c == null || !Number.isFinite(c)) continue
    bars.push({
      t: result.timestamp[i]!,
      o: q.open?.[i] ?? c,
      h: q.high?.[i] ?? c,
      l: q.low?.[i] ?? c,
      c,
      v: q.volume?.[i] ?? 0,
    })
  }
  if (bars.length < 25) throw new Error(`Yahoo insufficient bars for ${symbol}`)

  const last = bars[bars.length - 1]!
  const meta = result.meta ?? {}
  const price =
    typeof meta.regularMarketPrice === 'number' && meta.regularMarketPrice > 0
      ? meta.regularMarketPrice
      : last.c
  const prevClose =
    typeof meta.previousClose === 'number' && meta.previousClose > 0
      ? meta.previousClose
      : typeof meta.chartPreviousClose === 'number' && meta.chartPreviousClose > 0
        ? meta.chartPreviousClose
        : bars.length > 1
          ? bars[bars.length - 2]!.c
          : last.c

  return {
    bars,
    name: meta.longName || meta.shortName,
    price,
    prevClose,
  }
}

async function yahooChart(symbol: string): Promise<ReturnType<typeof parseYahooChart>> {
  // Unofficial Yahoo Finance chart endpoints — may break without notice.
  const hosts = ['query1.finance.yahoo.com', 'query2.finance.yahoo.com']
  const errors: string[] = []
  for (const host of hosts) {
    const url =
      `https://${host}/v8/finance/chart/${encodeURIComponent(symbol)}` +
      `?interval=1d&range=1y&includePrePost=false`
    try {
      const raw = await fetchJson(url)
      return parseYahooChart(raw, symbol)
    } catch (err) {
      errors.push(`${host}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
  throw new Error(errors.join('; '))
}

async function fromFinnhub(symbol: string, token: string): Promise<SymbolSnapshot> {
  const quote = await finnhubQuote(symbol, token)

  try {
    const bars = await finnhubCandles(symbol, token)
    return {
      symbol,
      price: quote.c,
      prevClose: quote.pc,
      bars,
      provider: 'finnhub',
    }
  } catch {
    // Free tier often blocks candles — keep Finnhub quote, fill bars from Yahoo.
    const y = await yahooChart(symbol)
    return {
      symbol,
      name: y.name,
      price: quote.c,
      prevClose: quote.pc,
      bars: y.bars,
      provider: 'finnhub+yahoo',
    }
  }
}

async function fromYahoo(symbol: string): Promise<SymbolSnapshot> {
  const y = await yahooChart(symbol)
  return {
    symbol,
    name: y.name,
    price: y.price,
    prevClose: y.prevClose,
    bars: y.bars,
    provider: 'yahoo',
  }
}

async function fromStooq(symbol: string): Promise<SymbolSnapshot> {
  // Public Stooq daily CSV (unofficial / free). US tickers use .us suffix.
  const stooqSym = `${symbol.toLowerCase()}.us`
  const urls = [
    `https://stooq.com/q/d/l/?s=${encodeURIComponent(stooqSym)}&i=d`,
    `https://stooq.pl/q/d/l/?s=${encodeURIComponent(stooqSym)}&i=d`,
  ]
  let text = ''
  const errors: string[] = []
  for (const url of urls) {
    try {
      text = await fetchText(url)
      break
    } catch (err) {
      errors.push(err instanceof Error ? err.message : String(err))
    }
  }
  if (!text) throw new Error(`Stooq fetch failed: ${errors.join('; ')}`)

  const lines = text.trim().split(/\r?\n/)
  if (lines.length < 30 || !lines[0]!.toLowerCase().includes('date')) {
    throw new Error(`Stooq CSV unusable for ${symbol}`)
  }

  const bars: DailyBar[] = []
  for (const line of lines.slice(1)) {
    const [date, o, h, l, c, v] = line.split(',')
    if (!date || !c || c === 'null') continue
    const close = Number(c)
    if (!Number.isFinite(close)) continue
    const t = Math.floor(new Date(`${date}T20:00:00Z`).getTime() / 1000)
    bars.push({
      t,
      o: Number(o) || close,
      h: Number(h) || close,
      l: Number(l) || close,
      c: close,
      v: Number(v) || 0,
    })
  }
  const sliced = bars.slice(-280)
  if (sliced.length < 25) throw new Error(`Stooq insufficient bars for ${symbol}`)

  const last = sliced[sliced.length - 1]!
  const prev = sliced[sliced.length - 2]!
  return {
    symbol,
    price: last.c,
    prevClose: prev.c,
    bars: sliced,
    provider: 'stooq',
  }
}


/** TTL cache for snapshots — broad SCAN_UNIVERSE refreshes reuse within window. */
const SNAPSHOT_CACHE_TTL_MS = Number(process.env.MARKET_CACHE_TTL_MS || 10 * 60 * 1000)
const snapshotCache = new Map<string, { at: number; snap: SymbolSnapshot }>()

function getCachedSnapshot(symbol: string): SymbolSnapshot | null {
  const hit = snapshotCache.get(symbol)
  if (!hit) return null
  if (Date.now() - hit.at > SNAPSHOT_CACHE_TTL_MS) {
    snapshotCache.delete(symbol)
    return null
  }
  return hit.snap
}

function setCachedSnapshot(symbol: string, snap: SymbolSnapshot): void {
  snapshotCache.set(symbol, { at: Date.now(), snap })
}

export async function fetchSymbolSnapshot(
  symbol: string,
  opts?: { preferYahoo?: boolean },
): Promise<SymbolSnapshot> {
  const sym = symbol.trim().toUpperCase()
  const cached = getCachedSnapshot(sym)
  if (cached) return cached

  const errors: string[] = []
  const key = getFinnhubKey()
  const preferYahoo = Boolean(opts?.preferYahoo)

  const tryYahoo = async () => {
    const snap = await fromYahoo(sym)
    setCachedSnapshot(sym, snap)
    return snap
  }
  const tryFinnhub = async () => {
    if (!key) throw new Error('no API key (FINNHUB_API_KEY)')
    const snap = await fromFinnhub(sym, key)
    setCachedSnapshot(sym, snap)
    return snap
  }
  const tryStooq = async () => {
    const snap = await fromStooq(sym)
    setCachedSnapshot(sym, snap)
    return snap
  }

  const order = preferYahoo
    ? [ ['yahoo', tryYahoo], ['finnhub', tryFinnhub], ['stooq', tryStooq] ] as const
    : [ ['finnhub', tryFinnhub], ['yahoo', tryYahoo], ['stooq', tryStooq] ] as const

  for (const [label, fn] of order) {
    try {
      return await fn()
    } catch (err) {
      errors.push(`${label}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  throw new Error(`All providers failed for ${sym}: ${errors.join('; ')}`)
}


// ---------------------------------------------------------------------------
// Earnings calendar (Finnhub → Nasdaq → clear). Cached aggressively.
// ---------------------------------------------------------------------------

export interface EarningsInfo {
  symbol: string
  earningsDate: string | null
  provider: 'finnhub' | 'nasdaq' | 'none'
}

const EARNINGS_CACHE_TTL_MS = Number(process.env.EARNINGS_CACHE_TTL_MS || 6 * 60 * 60 * 1000)
const earningsBySymbol = new Map<string, { at: number; info: EarningsInfo }>()
let calendarMapCache: { at: number; map: Map<string, string> } | null = null

function todayIsoUtc(): string {
  return new Date().toISOString().slice(0, 10)
}

function addDaysIso(iso: string, days: number): string {
  const d = new Date(`${iso}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

function getCachedEarnings(symbol: string): EarningsInfo | null {
  const hit = earningsBySymbol.get(symbol)
  if (!hit) return null
  if (Date.now() - hit.at > EARNINGS_CACHE_TTL_MS) {
    earningsBySymbol.delete(symbol)
    return null
  }
  return hit.info
}

function setCachedEarnings(info: EarningsInfo): void {
  earningsBySymbol.set(info.symbol, { at: Date.now(), info })
}

async function finnhubEarningsForSymbol(
  symbol: string,
  token: string,
): Promise<string | null> {
  const from = todayIsoUtc()
  const to = addDaysIso(from, 90)
  const raw = (await fetchJson(
    `https://finnhub.io/api/v1/calendar/earnings?from=${from}&to=${to}&symbol=${encodeURIComponent(symbol)}&token=${encodeURIComponent(token)}`,
  )) as { earningsCalendar?: Array<{ symbol?: string; date?: string }> }
  const rows = (raw.earningsCalendar ?? [])
    .filter((r) => (r.symbol ?? '').toUpperCase() === symbol && r.date)
    .map((r) => r.date!)
    .sort()
  return rows[0] ?? null
}

/** Fetch Finnhub earnings calendar in ~14-day chunks; build symbol→next date map. */
async function finnhubEarningsCalendarMap(token: string): Promise<Map<string, string>> {
  if (calendarMapCache && Date.now() - calendarMapCache.at < EARNINGS_CACHE_TTL_MS) {
    return calendarMapCache.map
  }
  const map = new Map<string, string>()
  const from0 = todayIsoUtc()
  const chunk = 14
  const horizon = 90
  for (let offset = 0; offset < horizon; offset += chunk) {
    const from = addDaysIso(from0, offset)
    const to = addDaysIso(from0, Math.min(offset + chunk - 1, horizon))
    try {
      const raw = (await fetchJson(
        `https://finnhub.io/api/v1/calendar/earnings?from=${from}&to=${to}&token=${encodeURIComponent(token)}`,
      )) as { earningsCalendar?: Array<{ symbol?: string; date?: string }> }
      for (const row of raw.earningsCalendar ?? []) {
        const sym = (row.symbol ?? '').toUpperCase()
        const date = row.date
        if (!sym || !date) continue
        const prev = map.get(sym)
        if (!prev || date < prev) map.set(sym, date)
      }
    } catch {
      // Chunk failure — keep what we have
    }
    await sleep(80)
  }
  calendarMapCache = { at: Date.now(), map }
  return map
}

async function nasdaqEarningsForSymbol(symbol: string): Promise<string | null> {
  // Walk next ~10 calendar days of Nasdaq earnings calendar (public JSON).
  const from0 = todayIsoUtc()
  for (let i = 0; i < 12; i++) {
    const date = addDaysIso(from0, i)
    try {
      const raw = (await fetchJson(
        `https://api.nasdaq.com/api/calendar/earnings?date=${date}`,
        {
          headers: {
            Accept: 'application/json,text/plain,*/*',
            'User-Agent': BROWSER_UA,
            Origin: 'https://www.nasdaq.com',
            Referer: 'https://www.nasdaq.com/',
          },
        },
      )) as {
        data?: { rows?: Array<{ symbol?: string }> | null }
      }
      const rows = raw.data?.rows ?? []
      for (const row of rows) {
        if ((row.symbol ?? '').toUpperCase() === symbol) return date
      }
    } catch {
      /* try next day */
    }
    await sleep(40)
  }
  return null
}

export async function fetchEarningsForSymbol(symbol: string): Promise<EarningsInfo> {
  const sym = symbol.trim().toUpperCase()
  const cached = getCachedEarnings(sym)
  if (cached) return cached

  const key = getFinnhubKey()
  const errors: string[] = []

  if (key) {
    try {
      const map = await finnhubEarningsCalendarMap(key)
      if (map.has(sym)) {
        const info: EarningsInfo = {
          symbol: sym,
          earningsDate: map.get(sym)!,
          provider: 'finnhub',
        }
        setCachedEarnings(info)
        return info
      }
      // Not in map — confirm with symbol-specific call (may still find date)
      try {
        const date = await finnhubEarningsForSymbol(sym, key)
        const info: EarningsInfo = {
          symbol: sym,
          earningsDate: date,
          provider: date ? 'finnhub' : 'none',
        }
        setCachedEarnings(info)
        return info
      } catch (err) {
        errors.push(`finnhub-symbol: ${err instanceof Error ? err.message : String(err)}`)
      }
    } catch (err) {
      errors.push(`finnhub-map: ${err instanceof Error ? err.message : String(err)}`)
    }
  } else {
    errors.push('finnhub: no API key')
  }

  try {
    const date = await nasdaqEarningsForSymbol(sym)
    const info: EarningsInfo = {
      symbol: sym,
      earningsDate: date,
      provider: date ? 'nasdaq' : 'none',
    }
    setCachedEarnings(info)
    return info
  } catch (err) {
    errors.push(`nasdaq: ${err instanceof Error ? err.message : String(err)}`)
  }

  const info: EarningsInfo = { symbol: sym, earningsDate: null, provider: 'none' }
  setCachedEarnings(info)
  return info
}

/** Batch earnings lookup — uses Finnhub calendar map when possible. */
export async function fetchEarningsBatch(symbols: string[]): Promise<EarningsInfo[]> {
  const uniq = [...new Set(symbols.map((s) => s.trim().toUpperCase()).filter(Boolean))]
  const key = getFinnhubKey()
  let map: Map<string, string> | null = null
  if (key) {
    try {
      map = await finnhubEarningsCalendarMap(key)
    } catch {
      map = null
    }
  }

  const out: EarningsInfo[] = []
  for (const sym of uniq) {
    const cached = getCachedEarnings(sym)
    if (cached) {
      out.push(cached)
      continue
    }
    if (map && map.has(sym)) {
      const info: EarningsInfo = {
        symbol: sym,
        earningsDate: map.get(sym)!,
        provider: 'finnhub',
      }
      setCachedEarnings(info)
      out.push(info)
      continue
    }
    // Known absent from Finnhub window → clear without Nasdaq (keeps scan fast)
    if (map) {
      const info: EarningsInfo = { symbol: sym, earningsDate: null, provider: 'none' }
      setCachedEarnings(info)
      out.push(info)
      continue
    }
    out.push(await fetchEarningsForSymbol(sym))
  }
  return out
}



// ---------------------------------------------------------------------------
// Stage 1.5 — cheap SMA prefilter (Yahoo quote fields, spark fallback)
// Prefer quote.fiftyDayAverage / twoHundredDayAverage; spark closes-only if crumb/quote blocked.
// ---------------------------------------------------------------------------

export interface YahooSmaQuote {
  symbol: string
  price: number
  fiftyDayAverage: number | null
  twoHundredDayAverage: number | null
  source: 'yahoo-quote' | 'yahoo-spark'
}

const SMA_QUOTE_CACHE_TTL_MS = Number(process.env.SMA_QUOTE_CACHE_TTL_MS || 5 * 60 * 1000)
/** Yahoo spark rejects batches ≥ ~50; keep ≤20. */
const SMA_QUOTE_BATCH = Number(process.env.SMA_QUOTE_BATCH || 20)
const SMA_QUOTE_GAP_MS = Number(process.env.SMA_QUOTE_GAP_MS || 120)
const smaQuoteCache = new Map<string, { at: number; quote: YahooSmaQuote }>()

function getCachedSmaQuote(symbol: string): YahooSmaQuote | null {
  const hit = smaQuoteCache.get(symbol)
  if (!hit) return null
  if (Date.now() - hit.at > SMA_QUOTE_CACHE_TTL_MS) {
    smaQuoteCache.delete(symbol)
    return null
  }
  return hit.quote
}

function setCachedSmaQuote(quote: YahooSmaQuote): void {
  smaQuoteCache.set(quote.symbol, { at: Date.now(), quote })
}

function numOrNull(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null
}

function simpleSma(closes: number[], n: number): number | null {
  if (closes.length < n) return null
  let sum = 0
  for (let i = closes.length - n; i < closes.length; i++) sum += closes[i]!
  return sum / n
}

/** Prefer official Yahoo quote averages when crumb auth works (fail-fast → spark). */
async function fetchYahooSmaQuoteBatch(symbols: string[]): Promise<Map<string, YahooSmaQuote>> {
  const out = new Map<string, YahooSmaQuote>()
  if (!symbols.length) return out
  let auth: { crumb: string; cookie: string }
  try {
    auth = await Promise.race([
      refreshYahooCrumb(),
      new Promise<never>((_, rej) =>
        setTimeout(() => rej(new Error('crumb timeout')), 2500),
      ),
    ])
  } catch {
    return out
  }
  const hosts = ['query1.finance.yahoo.com', 'query2.finance.yahoo.com']
  const joined = symbols.map((s) => encodeURIComponent(s)).join(',')
  const fields = 'symbol,regularMarketPrice,fiftyDayAverage,twoHundredDayAverage'
  for (const host of hosts) {
    const url =
      `https://${host}/v7/finance/quote?symbols=${joined}` +
      `&fields=${fields}&formatted=false&lang=en-US&region=US` +
      `&crumb=${encodeURIComponent(auth.crumb)}`
    try {
      const res = await fetch(url, {
        headers: {
          ...BROWSER_HEADERS,
          Cookie: auth.cookie,
        },
      })
      if (res.status === 401 || res.status === 403) {
        // Force crumb refresh once
        try {
          auth = await refreshYahooCrumb(true)
        } catch {
          return out
        }
        continue
      }
      if (!res.ok) continue
      const raw = (await res.json()) as {
        quoteResponse?: {
          result?: Array<{
            symbol?: string
            regularMarketPrice?: number
            fiftyDayAverage?: number
            twoHundredDayAverage?: number
          }>
        }
      }
      for (const row of raw.quoteResponse?.result ?? []) {
        const sym = (row.symbol ?? '').toUpperCase()
        if (!sym) continue
        const price = numOrNull(row.regularMarketPrice)
        if (price == null) continue
        const quote: YahooSmaQuote = {
          symbol: sym,
          price,
          fiftyDayAverage: numOrNull(row.fiftyDayAverage),
          twoHundredDayAverage: numOrNull(row.twoHundredDayAverage),
          source: 'yahoo-quote',
        }
        setCachedSmaQuote(quote)
        out.set(sym, quote)
      }
      if (out.size) return out
    } catch {
      /* try next host */
    }
  }
  return out
}

/**
 * Cheap closes-only spark batch — compute SMA50/SMA200 without full OHLCV candles.
 * Used when quote+crumb is unavailable (common 401/429).
 */
async function fetchYahooSparkSmaBatch(symbols: string[]): Promise<Map<string, YahooSmaQuote>> {
  const out = new Map<string, YahooSmaQuote>()
  if (!symbols.length) return out
  const hosts = ['query1.finance.yahoo.com', 'query2.finance.yahoo.com']
  const joined = symbols.map((s) => encodeURIComponent(s)).join(',')
  const errors: string[] = []
  for (const host of hosts) {
    const url =
      `https://${host}/v8/finance/spark?symbols=${joined}` +
      `&range=1y&interval=1d`
    try {
      const raw = (await fetchJson(url)) as Record<
        string,
        {
          symbol?: string
          close?: (number | null)[]
          fulldayPrice?: number
          previousClose?: number
          chartPreviousClose?: number
        }
      >
      for (const [key, data] of Object.entries(raw)) {
        const sym = (data.symbol || key || '').toUpperCase()
        if (!sym || !Array.isArray(data.close)) continue
        const closes = data.close.filter(
          (c): c is number => typeof c === 'number' && Number.isFinite(c) && c > 0,
        )
        if (closes.length < 50) continue
        const last = closes[closes.length - 1]!
        const price =
          numOrNull(data.fulldayPrice) ??
          numOrNull(data.previousClose) ??
          last
        const quote: YahooSmaQuote = {
          symbol: sym,
          price,
          fiftyDayAverage: simpleSma(closes, 50),
          twoHundredDayAverage: simpleSma(closes, 200),
          source: 'yahoo-spark',
        }
        setCachedSmaQuote(quote)
        out.set(sym, quote)
      }
      if (out.size) return out
    } catch (err) {
      errors.push(`${host}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
  if (!out.size && errors.length) {
    throw new Error(`Yahoo spark SMA batch failed: ${errors.join('; ')}`)
  }
  return out
}

export interface SmaPrefilterResult {
  survivors: string[]
  quotes: Map<string, YahooSmaQuote>
  stage1Count: number
  stage15Count: number
  belowSma200Count: number
  belowSma50Count: number
  missingSmaCount: number
  quoteFailCount: number
  filters: Record<string, unknown>
}

/**
 * Stage 1.5: keep symbols with price > 200-day avg AND price > 50-day avg.
 * Quote fields preferred; spark closes-only fallback. Fail-closed when averages missing.
 */
export async function runSmaPrefilter(symbols: string[]): Promise<SmaPrefilterResult> {
  const uniq = [...new Set(symbols.map((s) => s.trim().toUpperCase()).filter(Boolean))]
  const quotes = new Map<string, YahooSmaQuote>()
  const needFetch: string[] = []
  for (const sym of uniq) {
    const cached = getCachedSmaQuote(sym)
    if (cached) quotes.set(sym, cached)
    else needFetch.push(sym)
  }

  let quoteFailCount = 0
  let usedQuote = 0
  let usedSpark = 0
  // Probe quote path once on the first batch; if crumb/quote fails, spark-only thereafter.
  let preferSparkOnly = false
  for (let i = 0; i < needFetch.length; i += SMA_QUOTE_BATCH) {
    const batch = needFetch.slice(i, i + SMA_QUOTE_BATCH)
    if (i > 0) await sleep(SMA_QUOTE_GAP_MS)
    try {
      if (!preferSparkOnly) {
        const got = await fetchYahooSmaQuoteBatch(batch)
        let quoteHits = 0
        for (const [sym, q] of got) {
          quotes.set(sym, q)
          if (q.source === 'yahoo-quote') {
            usedQuote += 1
            quoteHits += 1
          }
        }
        if (quoteHits === 0) preferSparkOnly = true
      }
      const stillMissing = batch.filter((s) => !quotes.has(s))
      if (stillMissing.length) {
        const sparkGot = await fetchYahooSparkSmaBatch(stillMissing)
        for (const [sym, q] of sparkGot) {
          quotes.set(sym, q)
          usedSpark += 1
        }
      }
      for (const sym of batch) {
        if (!quotes.has(sym)) quoteFailCount += 1
      }
    } catch {
      preferSparkOnly = true
      try {
        const sparkGot = await fetchYahooSparkSmaBatch(batch)
        for (const [sym, q] of sparkGot) {
          quotes.set(sym, q)
          usedSpark += 1
        }
        for (const sym of batch) {
          if (!quotes.has(sym)) quoteFailCount += 1
        }
      } catch {
        quoteFailCount += batch.length
      }
    }
  }

  const survivors: string[] = []
  let belowSma200Count = 0
  let belowSma50Count = 0
  let missingSmaCount = 0

  for (const sym of uniq) {
    const q = quotes.get(sym)
    if (!q) {
      missingSmaCount += 1
      continue
    }
    const sma200 = q.twoHundredDayAverage
    const sma50 = q.fiftyDayAverage
    if (sma200 == null || sma50 == null) {
      missingSmaCount += 1
      continue
    }
    const above200 = q.price > sma200
    const above50 = q.price > sma50
    if (!above200) belowSma200Count += 1
    if (!above50) belowSma50Count += 1
    if (above200 && above50) survivors.push(sym)
  }

  return {
    survivors,
    quotes,
    stage1Count: uniq.length,
    stage15Count: survivors.length,
    belowSma200Count,
    belowSma50Count,
    missingSmaCount,
    quoteFailCount,
    filters: {
      requireAbove200Sma: true,
      requireAbove50Sma: true,
      preferredSource: 'yahoo-quote',
      fallbackSource: 'yahoo-spark',
      fields: ['regularMarketPrice', 'fiftyDayAverage', 'twoHundredDayAverage'],
      failClosedMissingAverages: true,
      batchSize: SMA_QUOTE_BATCH,
      cacheTtlMs: SMA_QUOTE_CACHE_TTL_MS,
      usedQuote,
      usedSpark,
    },
  }
}

export function createMarketMiddleware() {
  return async function marketMiddleware(
    req: { url?: string; method?: string },
    res: {
      statusCode: number
      setHeader: (k: string, v: string) => void
      end: (body?: string) => void
    },
    next: () => void,
  ) {
    const url = new URL(req.url ?? '/', 'http://localhost')
    if (!url.pathname.startsWith('/api/market')) {
      next()
      return
    }

    res.setHeader('Content-Type', 'application/json')
    res.setHeader('Cache-Control', 'no-store')

    try {
      if (url.pathname === '/api/market/health') {
        const key = getFinnhubKey()
        res.statusCode = 200
        res.end(
          JSON.stringify({
            ok: true,
            finnhubKeyPresent: Boolean(key),
            finnhubKeyLength: key ? key.length : 0,
            cascade: ['finnhub', 'yahoo', 'stooq'],
            earningsCascade: ['finnhub', 'nasdaq'],
            cacheTtlMs: SNAPSHOT_CACHE_TTL_MS,
            cacheSize: snapshotCache.size,
            smaQuoteCacheSize: smaQuoteCache.size,
            smaQuoteCacheTtlMs: SMA_QUOTE_CACHE_TTL_MS,
            earningsCacheSize: earningsBySymbol.size,
            earningsCacheTtlMs: EARNINGS_CACHE_TTL_MS,
          }),
        )
        return
      }

      if (url.pathname === '/api/market/snapshot') {
        const symbol = url.searchParams.get('symbol')
        if (!symbol) {
          res.statusCode = 400
          res.end(JSON.stringify({ error: 'symbol query required' }))
          return
        }
        const snap = await fetchSymbolSnapshot(symbol)
        res.statusCode = 200
        res.end(JSON.stringify(snap))
        return
      }

      if (url.pathname === '/api/market/earnings') {
        const symbol = url.searchParams.get('symbol')
        if (!symbol) {
          res.statusCode = 400
          res.end(JSON.stringify({ error: 'symbol query required' }))
          return
        }
        const info = await fetchEarningsForSymbol(symbol)
        res.statusCode = 200
        res.end(JSON.stringify(info))
        return
      }

      if (url.pathname === '/api/market/earnings/batch') {
        const raw = url.searchParams.get('symbols') ?? ''
        const symbols = raw
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
        if (!symbols.length) {
          res.statusCode = 400
          res.end(JSON.stringify({ error: 'symbols query required (comma-separated)' }))
          return
        }
        const capped = symbols.slice(0, 200)
        const rows = await fetchEarningsBatch(capped)
        res.statusCode = 200
        res.end(JSON.stringify({ results: rows }))
        return
      }


if (url.pathname === '/api/market/dashboard') {
        const cache = loadScanCache()
        if (!cache) {
          void triggerScan('dashboard-miss')
          // 202 Accepted: scan kicked off — not a fatal error for the UI.
          res.statusCode = 202
          res.end(
            JSON.stringify({
              scanning: true,
              message: 'Scan cache empty — background scan started',
              status: getScanRuntimeStatus(),
            }),
          )
          return
        }
        const { meta, ...dashboard } = cache
        res.statusCode = 200
        res.end(
          JSON.stringify({
            ...dashboard,
            stage1Source: meta?.stage1Source,
            stage1Count: meta?.stage1Count,
            stage15Count: meta?.stage15Count,
            shortlistCount: meta?.shortlistCount,
            emergencyFallback: meta?.emergencyFallback,
            scanDurationMs: meta?.scanDurationMs,
            stage1Filters: meta?.stage1Filters,
            stage15Filters: meta?.stage15Filters,
            stage15BelowSma200Count: meta?.stage15BelowSma200Count,
            stage15BelowSma50Count: meta?.stage15BelowSma50Count,
            stage15MissingSmaCount: meta?.stage15MissingSmaCount,
          }),
        )
        return
      }

      if (url.pathname === '/api/market/scan/status') {
        res.statusCode = 200
        res.end(JSON.stringify(getScanRuntimeStatus()))
        return
      }

      if (
        (url.pathname === '/api/market/scan/refresh' ||
          url.pathname === '/api/market/scan/refresh/') &&
        (req.method === 'POST' || req.method === 'GET')
      ) {
        const result = await triggerScan('client-refresh')
        res.statusCode =
          result.started && result.status !== 'already-scanning' ? 202 : 200
        res.end(JSON.stringify({ ...result, statusDetail: getScanRuntimeStatus() }))
        return
      }

      res.statusCode = 404
      res.end(JSON.stringify({ error: 'Not found' }))
    } catch (err) {
      res.statusCode = 502
      res.end(
        JSON.stringify({
          error: err instanceof Error ? err.message : 'Market proxy error',
        }),
      )
    }
  }
}

/** Call from prod server listen / Vite configureServer — not at import time. */
export function startBackgroundScanIfNeeded(): void {
  kickScanOnBoot()
}
