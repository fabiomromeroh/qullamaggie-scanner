/**
 * Market Pulse API.
 *   GET /api/pulse/etfs?list=group|sectors|equal|country  ETF performance rows (Yahoo daily bars)
 *   GET /api/pulse/tape                                     index ETFs + top gainers/losers
 *   GET /api/pulse/group-members/:slug                       membership-snapshot members + quotes
 * Groups themselves come from the scanner's GET /api/groups (Finviz), not from here.
 */
import { ETF_LISTS, isEtfListId, TAPE_INDEXES, type EtfListId } from '../src/lib/etfLists.ts'
import { computePerfRow, pickMovers, type MoverInput, type PerfRow } from '../src/lib/perfWindows.ts'
import { loadMembershipSnapshot } from './groupMembers.ts'
import { enrichMembersWithLiquidity } from './memberDollarVolume.ts'
import { membershipUniverse, sendJson } from './pulseShared.ts'
import { getBreadthQuotes, maybeRefreshBreadth } from './breadthJob.ts'
export { membershipUniverse, sendJson }
import { crumbStatus, getBatchQuotes, getDailySeries, getQuoteSummary, ttlMemo, yahooRequestCount, type BatchQuote } from './yahooClient.ts'

type MiniReq = { url?: string; method?: string }
type MiniRes = {
  statusCode: number
  setHeader: (name: string, value: string) => void
  end: (body?: string) => void
}

export interface EtfPerfRow extends Partial<PerfRow> {
  ticker: string
  name: string
  error?: string
}

export interface EtfListResponse {
  list: EtfListId
  asOf: string
  rows: EtfPerfRow[]
  source: 'yahoo'
}

const etfMemo = ttlMemo<EtfListResponse>(5 * 60 * 1000)

export function getEtfList(list: EtfListId): Promise<EtfListResponse> {
  return etfMemo(list, async () => {
    const rows = await Promise.all(
      ETF_LISTS[list].map(async (entry): Promise<EtfPerfRow> => {
        try {
          const s = await getDailySeries(entry.ticker, '2y')
          return { ...entry, ...computePerfRow(s.bars, s.price, s.prevClose) }
        } catch (err) {
          return { ...entry, error: err instanceof Error ? err.message : 'fetch failed' }
        }
      }),
    )
    return { list, asOf: new Date().toISOString(), rows, source: 'yahoo' }
  })
}

export interface TapeItem {
  ticker: string
  label?: string
  price: number
  changePct: number
}

export interface TapeResponse {
  asOf: string
  indexes: TapeItem[]
  gainers: TapeItem[]
  losers: TapeItem[]
  moversUniverse: number
  moversMinDollarVolume: number
  /** 'quote' = Yahoo v7 batch quotes; 'chart' = last bars from the breadth job's chart fetch. */
  moversSource?: 'quote' | 'chart'
  moversAsOf?: string
  moversError?: string
}

const moversMemo = ttlMemo<BatchQuote[]>(10 * 60 * 1000)
const tapeMemo = ttlMemo<TapeResponse>(60 * 1000)

export const MOVERS_MIN_DOLLAR_VOLUME = 20_000_000

export function getTape(): Promise<TapeResponse> {
  return tapeMemo('tape', async () => {
    const indexes = (
      await Promise.all(
        TAPE_INDEXES.map(async (ix): Promise<TapeItem | null> => {
          try {
            const s = await getDailySeries(ix.ticker, '2y')
            const changePct = s.prevClose > 0 ? (s.price / s.prevClose - 1) * 100 : 0
            return { ticker: ix.ticker, label: ix.label, price: s.price, changePct }
          } catch {
            return null
          }
        }),
      )
    ).filter((x): x is TapeItem => x != null)

    const { tickers } = membershipUniverse()
    let gainers: TapeItem[] = []
    let losers: TapeItem[] = []
    let moversError: string | undefined
    let moversSource: 'quote' | 'chart' | undefined
    let moversAsOf: string | undefined
    let inputs: MoverInput[] | null = null
    try {
      const quotes = await moversMemo('universe', () => getBatchQuotes(tickers))
      inputs = quotes.map((q) => ({ ticker: q.symbol, price: q.price, changePct: q.changePct, avgVolume: q.avgVolume ?? 0 }))
      moversSource = 'quote'
      moversAsOf = new Date().toISOString()
    } catch (err) {
      const quoteError = err instanceof Error ? err.message : 'quotes failed'
      // Crumb-free fallback: the breadth job's chart data (same Yahoo chart endpoint as the ETF tables).
      const bq = getBreadthQuotes()
      if (bq) {
        inputs = [...bq.quotes.values()].map((q) => ({
          ticker: q.ticker,
          price: q.price,
          changePct: q.changePct,
          // price × avgVolume = 20-day average dollar volume, which is what the floor checks.
          avgVolume: q.price > 0 ? q.dollarVolume20 / q.price : 0,
        }))
        moversSource = 'chart'
        moversAsOf = bq.generatedAt
      } else {
        moversError = `waiting for the first breadth run (chart data); quote API: ${quoteError}`
      }
    }
    maybeRefreshBreadth()
    if (inputs) {
      const picked = pickMovers(inputs, 10, MOVERS_MIN_DOLLAR_VOLUME)
      gainers = picked.gainers.map(({ ticker, price, changePct }) => ({ ticker, price, changePct }))
      losers = picked.losers.map(({ ticker, price, changePct }) => ({ ticker, price, changePct }))
    }
    return {
      asOf: new Date().toISOString(),
      indexes,
      gainers,
      losers,
      moversUniverse: tickers.length,
      moversMinDollarVolume: MOVERS_MIN_DOLLAR_VOLUME,
      ...(moversSource ? { moversSource, moversAsOf } : {}),
      ...(moversError ? { moversError } : {}),
    }
  })
}

export interface GroupMemberRow {
  ticker: string
  company?: string
  price?: number
  changePct?: number
  volume?: number
  avgVolume?: number
  marketCap?: number
  /** 20-session average dollar volume from the breadth chart quotes, when known. */
  dollarVolume20?: number
}

/** Member quotes when the batch-quote API is unavailable: breadth chart quotes, then per-ticker charts. */
const MEMBER_CHART_LIMIT = 150

async function memberChartQuotes(tickers: readonly string[]): Promise<{ rows: Map<string, GroupMemberRow>; source: string }> {
  const rows = new Map<string, GroupMemberRow>()
  const bq = getBreadthQuotes()
  const missing: string[] = []
  for (const t of tickers) {
    const q = bq?.quotes.get(t)
    if (q) {
      rows.set(t, {
        ticker: t,
        price: q.price,
        changePct: q.changePct,
        dollarVolume20: q.dollarVolume20,
        avgVolume: q.price > 0 ? q.dollarVolume20 / q.price : undefined,
      })
    } else missing.push(t)
  }
  await Promise.all(
    missing.slice(0, MEMBER_CHART_LIMIT).map(async (t) => {
      try {
        const s = await getDailySeries(t, '2y')
        const last = s.bars[s.bars.length - 1]
        rows.set(t, {
          ticker: t,
          price: s.price,
          changePct: s.prevClose > 0 ? (s.price / s.prevClose - 1) * 100 : undefined,
          volume: last?.v,
        })
      } catch {
        /* leave the member without a quote */
      }
    }),
  )
  const source = bq && missing.length < tickers.length ? `Yahoo chart data (breadth run ${bq.generatedAt})` : 'Yahoo chart data'
  return { rows, source }
}

const membersMemo = ttlMemo<BatchQuote[]>(5 * 60 * 1000)

export async function getGroupMembers(slug: string): Promise<{
  slug: string
  name: string
  generatedAt: string
  /** Snapshot size floor only. $5 / 100K / $20M live in the client toggles. */
  filters: { minPrice: number; minAvgVolume: number }
  members: GroupMemberRow[]
  totalMembers: number
  quotesSource?: string
  quotesError?: string
} | null> {
  const loaded = loadMembershipSnapshot()
  if (!loaded.ok) throw new Error(loaded.error)
  const group = loaded.snapshot.groups[slug]
  if (!group) return null
  let quotes: BatchQuote[] = []
  let quotesError: string | undefined
  let quotesSource = 'Yahoo quotes'
  let chartRows: Map<string, GroupMemberRow> | null = null
  try {
    quotes = await membersMemo(slug, () => getBatchQuotes(group.tickers))
  } catch (err) {
    try {
      const fb = await memberChartQuotes(group.tickers)
      chartRows = fb.rows
      quotesSource = fb.source
    } catch {
      quotesError = err instanceof Error ? err.message : 'quotes failed'
    }
  }
  const bySym = new Map(quotes.map((q) => [q.symbol, q]))
  const rows: GroupMemberRow[] = group.tickers.map((t) => {
    const q = bySym.get(t)
    const c = chartRows?.get(t)
    if (c) return { ...c, company: group.companies?.[t] }
    return {
      ticker: t,
      company: group.companies?.[t] ?? q?.name,
      ...(q
        ? { price: q.price, changePct: q.changePct, volume: q.volume, avgVolume: q.avgVolume, marketCap: q.marketCap }
        : {}),
    }
  })
  const breadth = getBreadthQuotes()
  const dollarQuotes = breadth
    ? new Map(
        [...breadth.quotes.entries()].map(([ticker, quote]) => [
          ticker.toUpperCase(),
          { price: quote.price, dollarVolume20: quote.dollarVolume20 },
        ]),
      )
    : null
  // Return every snapshot member. Price / 20d shares / 20d $vol are attached when
  // known; the UI liquidity toggles filter the list. Unknown values stay blank.
  const enriched = enrichMembersWithLiquidity(rows, dollarQuotes)
  return {
    slug,
    name: group.name,
    generatedAt: loaded.snapshot.generatedAt,
    filters: loaded.snapshot.filters,
    members: enriched.members,
    totalMembers: enriched.totalMembers,
    quotesSource,
    ...(quotesError ? { quotesError } : {}),
  }
}

export interface EtfHolding {
  symbol?: string
  name?: string
  weightPct: number
}

const holdingsMemo = ttlMemo<{ symbol: string; holdings: EtfHolding[] }>(6 * 60 * 60 * 1000)

/** Top holdings from Yahoo quoteSummary `topHoldings` (usually top 10). */
export function getEtfHoldings(symbol: string): Promise<{ symbol: string; holdings: EtfHolding[] }> {
  return holdingsMemo(symbol, async () => {
    const summary = await getQuoteSummary(symbol, ['topHoldings'])
    const raw = (summary.topHoldings as { holdings?: Array<Record<string, unknown>> } | undefined)?.holdings ?? []
    const holdings: EtfHolding[] = []
    for (const h of raw) {
      const pct = (h.holdingPercent as { raw?: number } | undefined)?.raw
      if (typeof pct !== 'number') continue
      holdings.push({
        symbol: typeof h.symbol === 'string' ? h.symbol : undefined,
        name: typeof h.holdingName === 'string' ? h.holdingName : undefined,
        weightPct: pct * 100,
      })
    }
    return { symbol, holdings }
  })
}

export function createPulseMiddleware() {
  return async function pulseMiddleware(req: MiniReq, res: MiniRes, next: () => void) {
    const url = new URL(req.url ?? '/', 'http://localhost')
    const pathname = url.pathname.replace(/\/+$/, '')
    if (!pathname.startsWith('/api/pulse/')) {
      next()
      return
    }
    try {
      if (pathname === '/api/pulse/etfs') {
        const list = url.searchParams.get('list') ?? ''
        if (!isEtfListId(list)) {
          sendJson(res, 400, { error: 'list must be one of group, sectors, equal, country' })
          return
        }
        sendJson(res, 200, await getEtfList(list))
        return
      }
      if (pathname === '/api/pulse/tape') {
        sendJson(res, 200, await getTape())
        return
      }
      const m = pathname.match(/^\/api\/pulse\/group-members\/([a-z0-9]+)$/i)
      if (m) {
        const body = await getGroupMembers(m[1]!.toLowerCase())
        if (!body) sendJson(res, 404, { error: 'Unknown group' })
        else sendJson(res, 200, body)
        return
      }
      const h = pathname.match(/^\/api\/pulse\/holdings\/([A-Z0-9.^=-]{1,12})$/i)
      if (h) {
        sendJson(res, 200, await getEtfHoldings(h[1]!.toUpperCase()))
        return
      }
      if (pathname === '/api/pulse/capabilities') {
        // Holdings need Yahoo's crumb; when it is blocked the UI hides the holdings section.
        sendJson(res, 200, { holdings: crumbStatus() !== 'blocked', yahooCrumb: crumbStatus() })
        return
      }
      if (pathname === '/api/pulse/stats') {
        sendJson(res, 200, { yahooRequests: yahooRequestCount() })
        return
      }
      sendJson(res, 404, { error: 'Not found' })
    } catch (err) {
      sendJson(res, 502, { error: err instanceof Error ? err.message : 'pulse request failed' })
    }
  }
}
