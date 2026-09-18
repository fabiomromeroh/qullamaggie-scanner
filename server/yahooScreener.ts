/**
 * Yahoo Finance EquityQuery screener (Stage 1 universe).
 * Unofficial API — cookie + crumb with retry/backoff.
 *
 * Liquidity gate: avgdailyvol3m >= 750_000 (mid-band of 500k–1M).
 * Equities only (quoteType EQUITY — excludes ETFs/funds).
 * Region US; exchanges NMS / NYQ / NGM / NCM.
 */

export interface ScreenerHit {
  symbol: string
  shortName?: string
  longName?: string
  regularMarketPrice?: number
  averageDailyVolume3Month?: number
  sector?: string
  industry?: string
  exchange?: string
  quoteType?: string
}

export interface ScreenerResult {
  source: 'yahoo-screener' | 'yahoo-predefined-fallback'
  hits: ScreenerHit[]
  totalReported: number
  filters: Record<string, unknown>
  errors: string[]
}

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'

export const MIN_AVG_DAILY_VOL = Number(process.env.SCAN_MIN_AVG_VOL || 750_000)
export const MIN_PRICE = Number(process.env.SCAN_MIN_PRICE || 5)
export const SCREENER_PAGE_SIZE = 250
export const STAGE1_CAP = Number(process.env.SCAN_STAGE1_CAP || 800)

const SCREENER_ENDPOINTS = [
  'https://query2.finance.yahoo.com/v1/finance/screener',
  'https://query1.finance.yahoo.com/v1/finance/screener',
]

let crumbState: { crumb: string; cookie: string; at: number } | null = null
const CRUMB_TTL_MS = 30 * 60 * 1000

async function sleep(ms: number): Promise<void> {
  await new Promise((r) => setTimeout(r, ms))
}

function collectCookies(res: Response): string {
  const anyHeaders = res.headers as Headers & { getSetCookie?: () => string[] }
  const parts: string[] = []
  if (typeof anyHeaders.getSetCookie === 'function') {
    for (const c of anyHeaders.getSetCookie()) {
      const nv = c.split(';')[0]
      if (nv) parts.push(nv)
    }
  } else {
    const single = res.headers.get('set-cookie')
    if (single) parts.push(single.split(';')[0]!)
  }
  return parts.join('; ')
}

function mergeCookies(existing: string, incoming: string): string {
  const map = new Map<string, string>()
  for (const part of `${existing};${incoming}`.split(';')) {
    const trimmed = part.trim()
    if (!trimmed || !trimmed.includes('=')) continue
    const eq = trimmed.indexOf('=')
    map.set(trimmed.slice(0, eq), trimmed.slice(eq + 1))
  }
  return [...map.entries()].map(([k, v]) => `${k}=${v}`).join('; ')
}

export async function refreshYahooCrumb(force = false): Promise<{ crumb: string; cookie: string }> {
  if (!force && crumbState && Date.now() - crumbState.at < CRUMB_TTL_MS && crumbState.crumb) {
    return { crumb: crumbState.crumb, cookie: crumbState.cookie }
  }

  let cookie = ''
  const errors: string[] = []

  for (const url of ['https://finance.yahoo.com/', 'https://fc.yahoo.com']) {
    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent': UA,
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
        },
        redirect: 'follow',
      })
      cookie = mergeCookies(cookie, collectCookies(res))
      await res.arrayBuffer()
    } catch (err) {
      errors.push(`seed ${url}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  const crumbHosts = [
    'https://query1.finance.yahoo.com/v1/test/getcrumb',
    'https://query2.finance.yahoo.com/v1/test/getcrumb',
  ]

  for (let attempt = 0; attempt < 4; attempt++) {
    if (attempt > 0) await sleep(1500 * attempt)
    for (const crumbUrl of crumbHosts) {
      try {
        const res = await fetch(crumbUrl, {
          headers: {
            'User-Agent': UA,
            Accept: 'text/plain,*/*',
            Cookie: cookie,
            Referer: 'https://finance.yahoo.com/',
            Origin: 'https://finance.yahoo.com',
          },
        })
        cookie = mergeCookies(cookie, collectCookies(res))
        if (res.status === 429) {
          errors.push(`crumb 429 ${crumbUrl}`)
          continue
        }
        const text = (await res.text()).trim()
        if (res.ok && text && !text.includes('Too Many') && text.length < 200) {
          crumbState = { crumb: text, cookie, at: Date.now() }
          return { crumb: text, cookie }
        }
        errors.push(`crumb ${res.status}: ${text.slice(0, 80)}`)
      } catch (err) {
        errors.push(`crumb err: ${err instanceof Error ? err.message : String(err)}`)
      }
    }
  }

  throw new Error(`Yahoo crumb unavailable: ${errors.slice(-5).join('; ')}`)
}

function buildEquityQuery(): Record<string, unknown> {
  return {
    operator: 'AND',
    operands: [
      { operator: 'EQ', operands: ['region', 'us'] },
      { operator: 'GT', operands: ['intradayprice', MIN_PRICE] },
      { operator: 'GTE', operands: ['avgdailyvol3m', MIN_AVG_DAILY_VOL] },
      {
        operator: 'IS-IN',
        operands: ['exchange', 'NMS', 'NYQ', 'NGM', 'NCM'],
      },
    ],
  }
}

function buildPostBody(offset: number, size: number): Record<string, unknown> {
  return {
    offset,
    size,
    sortField: 'avgdailyvol3m',
    sortType: 'DESC',
    quoteType: 'EQUITY',
    query: buildEquityQuery(),
    userId: '',
    userIdType: 'guid',
  }
}

async function postScreenerPage(
  offset: number,
  size: number,
  crumb: string,
  cookie: string,
): Promise<{ total: number; quotes: ScreenerHit[] }> {
  const body = JSON.stringify(buildPostBody(offset, size))
  const params = new URLSearchParams({
    corsDomain: 'finance.yahoo.com',
    formatted: 'false',
    lang: 'en-US',
    region: 'US',
    crumb,
  })

  let lastErr: Error | null = null
  for (const base of SCREENER_ENDPOINTS) {
    for (let attempt = 0; attempt < 3; attempt++) {
      if (attempt > 0) await sleep(600 * attempt)
      try {
        const res = await fetch(`${base}?${params}`, {
          method: 'POST',
          headers: {
            'User-Agent': UA,
            Accept: 'application/json',
            'Content-Type': 'application/json',
            Cookie: cookie,
            Origin: 'https://finance.yahoo.com',
            Referer: 'https://finance.yahoo.com/screener',
          },
          body,
        })
        if (res.status === 401 || res.status === 403) {
          lastErr = new Error(`HTTP ${res.status} unauthorized`)
          crumbState = null
          continue
        }
        if (res.status === 429) {
          lastErr = new Error('HTTP 429')
          await sleep(2000 * (attempt + 1))
          continue
        }
        if (!res.ok) {
          const t = await res.text().catch(() => '')
          throw new Error(`HTTP ${res.status}: ${t.slice(0, 120)}`)
        }
        const raw = (await res.json()) as {
          finance?: {
            result?: Array<{ total?: number; quotes?: ScreenerHit[] }>
            error?: { description?: string }
          }
        }
        if (raw.finance?.error) {
          throw new Error(raw.finance.error.description || 'screener error')
        }
        const result = raw.finance?.result?.[0]
        if (!result) throw new Error('empty screener result')
        return {
          total: result.total ?? result.quotes?.length ?? 0,
          quotes: result.quotes ?? [],
        }
      } catch (err) {
        lastErr = err instanceof Error ? err : new Error(String(err))
      }
    }
  }
  throw lastErr ?? new Error('screener POST failed')
}

function isEquityHit(q: ScreenerHit): boolean {
  const qt = (q.quoteType || 'EQUITY').toUpperCase()
  if (qt && qt !== 'EQUITY') return false
  const sym = (q.symbol || '').toUpperCase()
  if (!sym || sym.includes('=') || sym.includes('^')) return false
  if (/\.(ETF|FUND)$/i.test(sym)) return false
  const price = q.regularMarketPrice
  if (typeof price === 'number' && price > 0 && price <= MIN_PRICE) return false
  const vol = q.averageDailyVolume3Month
  if (typeof vol === 'number' && vol > 0 && vol < MIN_AVG_DAILY_VOL) return false
  return true
}

async function runPredefinedFallback(): Promise<ScreenerResult> {
  const ids = [
    'most_actives',
    'day_gainers',
    'day_losers',
    'aggressive_small_caps',
    'undervalued_growth_stocks',
    'growth_technology_stocks',
    'small_cap_gainers',
  ]
  const bySym = new Map<string, ScreenerHit>()
  const errors: string[] = []

  for (const id of ids) {
    try {
      const url =
        `https://query1.finance.yahoo.com/v1/finance/screener/predefined/saved` +
        `?count=250&offset=0&scrIds=${encodeURIComponent(id)}&formatted=false&lang=en-US&region=US`
      const res = await fetch(url, {
        headers: {
          'User-Agent': UA,
          Accept: 'application/json',
          Referer: 'https://finance.yahoo.com/',
        },
      })
      if (!res.ok) {
        errors.push(`${id}: HTTP ${res.status}`)
        continue
      }
      const raw = (await res.json()) as {
        finance?: { result?: Array<{ quotes?: ScreenerHit[] }> }
      }
      const quotes = raw.finance?.result?.[0]?.quotes ?? []
      for (const q of quotes) {
        if (!isEquityHit(q)) continue
        const sym = (q.symbol || '').toUpperCase()
        if (!sym) continue
        if (!bySym.has(sym)) bySym.set(sym, { ...q, symbol: sym })
      }
      await sleep(120)
    } catch (err) {
      errors.push(`${id}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  const hits = [...bySym.values()]
    .sort(
      (a, b) =>
        (b.averageDailyVolume3Month ?? 0) - (a.averageDailyVolume3Month ?? 0),
    )
    .slice(0, STAGE1_CAP)

  return {
    source: 'yahoo-predefined-fallback',
    hits,
    totalReported: hits.length,
    filters: { predefined: ids },
    errors,
  }
}

/** Full paginated Yahoo EquityQuery screen with predefined fallback. */
export async function runYahooEquityScreener(): Promise<ScreenerResult> {
  const filters: Record<string, unknown> = {
    region: 'us',
    quoteType: 'EQUITY',
    minPrice: MIN_PRICE,
    minAvgDailyVol3m: MIN_AVG_DAILY_VOL,
    exchanges: ['NMS', 'NYQ', 'NGM', 'NCM'],
    sortField: 'avgdailyvol3m',
    pageSize: SCREENER_PAGE_SIZE,
    stage1Cap: STAGE1_CAP,
  }
  const errors: string[] = []

  try {
    let auth = await refreshYahooCrumb()
    const bySym = new Map<string, ScreenerHit>()
    let totalReported = 0
    let offset = 0
    let pages = 0
    const maxPages = Math.ceil(STAGE1_CAP / SCREENER_PAGE_SIZE) + 2

    while (pages < maxPages) {
      let page: { total: number; quotes: ScreenerHit[] }
      try {
        page = await postScreenerPage(offset, SCREENER_PAGE_SIZE, auth.crumb, auth.cookie)
      } catch {
        try {
          auth = await refreshYahooCrumb(true)
          page = await postScreenerPage(offset, SCREENER_PAGE_SIZE, auth.crumb, auth.cookie)
        } catch (err2) {
          errors.push(err2 instanceof Error ? err2.message : String(err2))
          break
        }
      }

      totalReported = page.total || totalReported
      const batch = page.quotes.filter(isEquityHit)
      if (!batch.length) break
      for (const q of batch) {
        const sym = q.symbol!.toUpperCase()
        if (!bySym.has(sym)) bySym.set(sym, { ...q, symbol: sym })
      }

      offset += SCREENER_PAGE_SIZE
      pages += 1
      if (offset >= page.total) break
      if (bySym.size >= STAGE1_CAP) break
      await sleep(200)
    }

    const hits = [...bySym.values()]
      .sort(
        (a, b) =>
          (b.averageDailyVolume3Month ?? 0) - (a.averageDailyVolume3Month ?? 0),
      )
      .slice(0, STAGE1_CAP)

    if (hits.length >= 50) {
      return {
        source: 'yahoo-screener',
        hits,
        totalReported,
        filters,
        errors,
      }
    }
    errors.push(`yahoo-screener too few hits (${hits.length})`)
  } catch (err) {
    errors.push(err instanceof Error ? err.message : String(err))
  }

  try {
    const predefined = await runPredefinedFallback()
    if (predefined.hits.length >= 30) {
      return {
        ...predefined,
        filters: { ...filters, fallback: 'yahoo-predefined' },
        errors: [...errors, ...predefined.errors],
      }
    }
    errors.push(...predefined.errors)
  } catch (err) {
    errors.push(`predefined: ${err instanceof Error ? err.message : String(err)}`)
  }

  return {
    source: 'yahoo-screener',
    hits: [],
    totalReported: 0,
    filters,
    errors,
  }
}
