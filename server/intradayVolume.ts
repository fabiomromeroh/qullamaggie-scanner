/**
 * Yahoo 5-minute volume for time-of-day RVOL.
 * One baseline per symbol per ET date from a 15d fetch; today's bars refresh
 * after todayTtlMs via range=1d. Never throws out of enrichWithIntradayRvol.
 */
import {
  INTRADAY_RVOL_CONFIG,
  baselineCumulative,
  computeIntradayRvol,
  etParts,
  groupBarsIntoSessions,
  isRegularSession,
  parseYahooIntradayBars,
  type IntradayRvolValue,
  type SessionSlots,
} from '../src/lib/rvolTod.ts'

const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36'

const BROWSER_HEADERS: Record<string, string> = {
  'User-Agent': BROWSER_UA,
  Accept: 'application/json,text/plain,*/*',
  'Accept-Language': 'en-US,en;q=0.9',
  Referer: 'https://finance.yahoo.com/',
  Origin: 'https://finance.yahoo.com',
}

const YAHOO_HOSTS = ['query1.finance.yahoo.com', 'query2.finance.yahoo.com'] as const

export interface EnrichOptions {
  fetchImpl?: typeof fetch
  /** Replaces retry backoff. Tests pass a resolved promise. */
  sleep?: (ms: number) => Promise<void>
  phaseTimeoutMs?: number
  /** Replaces console.log for the one summary line. */
  log?: (line: string) => void
}

interface CacheEntry {
  baselineDate: string
  baselineCum: number[] | null
  todayDate: string
  today: SessionSlots | null
  fetchedAt: number
}

interface FetchStats {
  http429: number
}

const cache = new Map<string, CacheEntry>()

export function clearIntradayVolumeCache(): void {
  cache.clear()
}

function yahooChartUrl(host: string, symbol: string, range: string): string {
  return (
    `https://${host}/v8/finance/chart/${encodeURIComponent(symbol)}` +
    `?interval=5m&range=${range}&includePrePost=false`
  )
}

function abortError(): Error {
  const err = new Error('aborted')
  err.name = 'AbortError'
  return err
}

function isAbort(err: unknown): boolean {
  return err instanceof Error && err.name === 'AbortError'
}

function httpError(status: number, url: string): Error & { status: number } {
  const err = new Error(`HTTP ${status} (${url.split('?')[0]})`) as Error & { status: number }
  err.name = 'HttpError'
  err.status = status
  return err
}

function statusOf(err: unknown): number | null {
  if (!err || typeof err !== 'object' || !('status' in err)) return null
  const status = (err as { status?: unknown }).status
  return typeof status === 'number' ? status : null
}

function retryableStatus(status: number): boolean {
  return status === 429 || status >= 500
}

async function defaultSleep(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) throw abortError()
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = () => {
      clearTimeout(timer)
      reject(abortError())
    }
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

async function fetchJsonRetry(
  url: string,
  signal: AbortSignal,
  stats: FetchStats,
  sleep: (ms: number) => Promise<void>,
  fetchImpl: typeof fetch,
): Promise<unknown> {
  const attempts = INTRADAY_RVOL_CONFIG.retries + 1
  let last: Error | null = null
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (signal.aborted) throw abortError()
    if (attempt > 0) {
      const delay =
        INTRADAY_RVOL_CONFIG.backoffMs[attempt - 1] ??
        INTRADAY_RVOL_CONFIG.backoffMs[INTRADAY_RVOL_CONFIG.backoffMs.length - 1]!
      await sleep(delay)
      if (signal.aborted) throw abortError()
    }
    try {
      const res = await fetchImpl(url, { headers: BROWSER_HEADERS, signal })
      if (res.status === 429) stats.http429 += 1
      if (retryableStatus(res.status)) {
        last = httpError(res.status, url)
        continue
      }
      if (!res.ok) throw httpError(res.status, url)
      return await res.json()
    } catch (err) {
      if (isAbort(err) || signal.aborted) throw isAbort(err) ? err : abortError()
      const status = statusOf(err)
      if (status != null && status >= 400 && status < 500 && status !== 429) throw err
      last = err instanceof Error ? err : new Error(String(err))
    }
  }
  throw last ?? new Error('fetch failed')
}

async function fetchChart(
  symbol: string,
  range: string,
  signal: AbortSignal,
  stats: FetchStats,
  sleep: (ms: number) => Promise<void>,
  fetchImpl: typeof fetch,
): Promise<ReturnType<typeof parseYahooIntradayBars>> {
  const errors: string[] = []
  for (const host of YAHOO_HOSTS) {
    const url = yahooChartUrl(host, symbol, range)
    try {
      const raw = await fetchJsonRetry(url, signal, stats, sleep, fetchImpl)
      return parseYahooIntradayBars(raw)
    } catch (err) {
      if (isAbort(err) || signal.aborted) throw isAbort(err) ? err : abortError()
      errors.push(`${host}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
  throw new Error(errors.join('; ') || `Yahoo chart failed for ${symbol}`)
}

function todayIsStale(fetchedAt: number, nowMs: number): boolean {
  return nowMs - fetchedAt > INTRADAY_RVOL_CONFIG.todayTtlMs
}

async function loadSymbol(
  symbol: string,
  nowMs: number,
  signal: AbortSignal,
  stats: FetchStats,
  sleep: (ms: number) => Promise<void>,
  fetchImpl: typeof fetch,
): Promise<IntradayRvolValue> {
  if (!isRegularSession(nowMs)) {
    return { rvolTod: null, slot: null, reason: 'outside_hours' }
  }
  const todayDate = etParts(nowMs).date
  const hit = cache.get(symbol)
  const baselineOk = hit != null && hit.baselineDate === todayDate
  const todayFresh = baselineOk && hit != null && hit.todayDate === todayDate && !todayIsStale(hit.fetchedAt, nowMs)

  let baselineCum: number[] | null
  let today: SessionSlots | null

  if (baselineOk && todayFresh && hit) {
    baselineCum = hit.baselineCum
    today = hit.today
  } else if (baselineOk && hit) {
    const bars = await fetchChart(symbol, '1d', signal, stats, sleep, fetchImpl)
    const sessions = groupBarsIntoSessions(bars)
    today = sessions.find((session) => session.date === todayDate) ?? null
    baselineCum = hit.baselineCum
    cache.set(symbol, {
      baselineDate: todayDate,
      baselineCum,
      todayDate,
      today,
      fetchedAt: nowMs,
    })
  } else {
    const bars = await fetchChart(symbol, INTRADAY_RVOL_CONFIG.fetchRange, signal, stats, sleep, fetchImpl)
    const sessions = groupBarsIntoSessions(bars)
    baselineCum = baselineCumulative(sessions, todayDate)
    today = sessions.find((session) => session.date === todayDate) ?? null
    cache.set(symbol, {
      baselineDate: todayDate,
      baselineCum,
      todayDate,
      today,
      fetchedAt: nowMs,
    })
  }

  return computeIntradayRvol({ today, baselineCum, nowMs })
}

function normalizeSymbols(symbols: readonly string[]): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const raw of symbols) {
    const symbol = raw.trim().toUpperCase()
    if (!symbol || seen.has(symbol)) continue
    seen.add(symbol)
    out.push(symbol)
  }
  return out
}

/**
 * Time-of-day RVOL for each symbol. Keys are uppercase tickers.
 * Failures, timeouts, and the outside-hours gate are nulls — this does not throw.
 */
export async function enrichWithIntradayRvol(
  symbols: readonly string[],
  now: Date = new Date(),
  options?: EnrichOptions,
): Promise<Map<string, IntradayRvolValue>> {
  const started = Date.now()
  const requested = normalizeSymbols(symbols)
  const out = new Map<string, IntradayRvolValue>()
  const stats: FetchStats = { http429: 0 }
  const fetchImpl = options?.fetchImpl ?? globalThis.fetch
  const nowMs = now.getTime()
  const timeoutMs = options?.phaseTimeoutMs ?? INTRADAY_RVOL_CONFIG.phaseTimeoutMs
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  const pause = options?.sleep ?? ((ms: number) => defaultSleep(ms, ctrl.signal))

  try {
    let cursor = 0
    const worker = async () => {
      for (;;) {
        if (ctrl.signal.aborted) return
        const index = cursor++
        if (index >= requested.length) return
        const symbol = requested[index]!
        try {
          if (ctrl.signal.aborted) {
            out.set(symbol, { rvolTod: null, slot: null, reason: 'timeout' })
            return
          }
          const value = await loadSymbol(symbol, nowMs, ctrl.signal, stats, pause, fetchImpl)
          out.set(symbol, value)
        } catch (err) {
          const timeout = ctrl.signal.aborted || isAbort(err)
          out.set(symbol, { rvolTod: null, slot: null, reason: timeout ? 'timeout' : 'error' })
          if (timeout) return
        }
      }
    }
    const workers = Math.min(INTRADAY_RVOL_CONFIG.concurrency, Math.max(1, requested.length))
    if (requested.length) {
      await Promise.all(Array.from({ length: workers }, () => worker()))
    }
  } catch {
    /* a worker fault still returns nulls below */
  } finally {
    clearTimeout(timer)
  }

  for (const symbol of requested) {
    if (!out.has(symbol)) out.set(symbol, { rvolTod: null, slot: null, reason: 'timeout' })
  }

  let tod = 0
  let nulls = 0
  let errors = 0
  for (const value of out.values()) {
    if (value.rvolTod == null) nulls += 1
    else tod += 1
    if (value.reason === 'error' || value.reason === 'timeout') errors += 1
  }

  const line = JSON.stringify({
    intradayRvol: 'done',
    requested: requested.length,
    tod,
    nulls,
    errors,
    http429: stats.http429,
    ms: Date.now() - started,
  })
  ;(options?.log ?? ((message: string) => console.log(message)))(line)
  return out
}
