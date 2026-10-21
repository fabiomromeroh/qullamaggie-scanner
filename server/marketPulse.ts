/**
 * Market Pulse API.
 *   GET /api/pulse/etfs?list=group|sectors|equal|country  ETF performance rows (Yahoo daily bars)
 *   GET /api/pulse/tape                                     index ETFs + top gainers/losers
 *   GET /api/pulse/group-members/:slug                       membership-snapshot members + quotes
 * Groups themselves come from the scanner's GET /api/groups (Finviz), not from here.
 */
import { ETF_LISTS, isEtfListId, TAPE_INDEXES, type EtfListId } from '../src/lib/etfLists.ts'
import { computePerfRow, pickMovers, type PerfRow } from '../src/lib/perfWindows.ts'
import { loadMembershipSnapshot } from './groupMembers.ts'
import { getBatchQuotes, getDailySeries, getQuoteSummary, ttlMemo, yahooRequestCount, type BatchQuote } from './yahooClient.ts'

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
  moversError?: string
}

export function membershipUniverse(): { tickers: string[]; companies: Map<string, string>; groupOf: Map<string, string> } {
  const loaded = loadMembershipSnapshot()
  const tickers = new Set<string>()
  const companies = new Map<string, string>()
  const groupOf = new Map<string, string>()
  if (loaded.ok) {
    for (const [slug, g] of Object.entries(loaded.snapshot.groups)) {
      for (const t of g.tickers) {
        tickers.add(t)
        if (!groupOf.has(t)) groupOf.set(t, slug)
        const name = g.companies?.[t]
        if (name) companies.set(t, name)
      }
    }
  }
  return { tickers: [...tickers].sort(), companies, groupOf }
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
    try {
      const quotes = await moversMemo('universe', () => getBatchQuotes(tickers))
      const picked = pickMovers(
        quotes.map((q) => ({ ticker: q.symbol, price: q.price, changePct: q.changePct, avgVolume: q.avgVolume ?? 0 })),
        10,
        MOVERS_MIN_DOLLAR_VOLUME,
      )
      gainers = picked.gainers.map(({ ticker, price, changePct }) => ({ ticker, price, changePct }))
      losers = picked.losers.map(({ ticker, price, changePct }) => ({ ticker, price, changePct }))
    } catch (err) {
      moversError = err instanceof Error ? err.message : 'quotes failed'
    }
    return {
      asOf: new Date().toISOString(),
      indexes,
      gainers,
      losers,
      moversUniverse: tickers.length,
      moversMinDollarVolume: MOVERS_MIN_DOLLAR_VOLUME,
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
}

const membersMemo = ttlMemo<BatchQuote[]>(5 * 60 * 1000)

export async function getGroupMembers(slug: string): Promise<{
  slug: string
  name: string
  generatedAt: string
  members: GroupMemberRow[]
  quotesError?: string
} | null> {
  const loaded = loadMembershipSnapshot()
  if (!loaded.ok) throw new Error(loaded.error)
  const group = loaded.snapshot.groups[slug]
  if (!group) return null
  let quotes: BatchQuote[] = []
  let quotesError: string | undefined
  try {
    quotes = await membersMemo(slug, () => getBatchQuotes(group.tickers))
  } catch (err) {
    quotesError = err instanceof Error ? err.message : 'quotes failed'
  }
  const bySym = new Map(quotes.map((q) => [q.symbol, q]))
  return {
    slug,
    name: group.name,
    generatedAt: loaded.snapshot.generatedAt,
    members: group.tickers.map((t) => {
      const q = bySym.get(t)
      return {
        ticker: t,
        company: group.companies?.[t] ?? q?.name,
        ...(q
          ? { price: q.price, changePct: q.changePct, volume: q.volume, avgVolume: q.avgVolume, marketCap: q.marketCap }
          : {}),
      }
    }),
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

export function sendJson(res: MiniRes, status: number, body: unknown): void {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Cache-Control', 'no-store')
  res.end(JSON.stringify(body))
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
