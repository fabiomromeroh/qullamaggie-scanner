/**
 * Performance of membership-snapshot names from the scanner's own providers.
 * One snapshot fetch fills every period, so changing 1D/1W/1M/3M/6M does not
 * refetch. The scan cache stores idea perf fields but not daily bars, so those
 * numbers are not reused; `fetchSymbolSnapshot` still returns its in-memory
 * bars when the scan fetched the symbol recently.
 *
 * Lookback: completed daily bars before the session that produced `price`.
 * 1D uses price / prevClose − 1 (`resolvePrevClose`). 1W/1M/3M/6M are 5/21/63/126
 * sessions. Finviz 4w/13w/26w are close, not identical.
 */
import type { GroupPeriod } from '../src/types/index.ts'
import { remainingSymbolBudget } from '../src/lib/leaderBudget.ts'
import {
  averageShareVolume,
  memberPeriodReturnPct,
  relativeVolume,
  type MemberPerfInput,
  type PerfBar,
} from '../src/lib/memberPerf.ts'
import { fetchSymbolSnapshot, type SymbolSnapshot } from './marketProxy.ts'

export const MEMBER_QUOTE_TTL_MS = 15 * 60 * 1000
export const MEMBER_QUOTE_FAIL_TTL_MS = 60 * 1000
export const LEADER_BUDGET_MS = 8_000
export const LEADER_MAX_SYMBOLS = 40
export const MEMBER_FETCH_CONCURRENCY = 4
export const MEMBER_FETCH_GAP_MS = 50
export const WARM_CONCURRENCY = 2
export const WARM_GAP_MS = 200

export interface MemberQuote {
  ticker: string
  name?: string
  price: number
  prevClose: number
  changePct: number | null
  perf: Record<GroupPeriod, number | null>
  relVolume: number | null
  avgVolume: number | null
}

export function quoteFromSnapshot(snap: {
  symbol: string
  name?: string
  price: number
  prevClose: number
  bars: PerfBar[]
  regularMarketTime?: number
  gmtoffset?: number
  exchangeTimezoneName?: string
}): MemberQuote | null {
  if (!(snap.price > 0) || !Number.isFinite(snap.price)) return null
  const input: MemberPerfInput = {
    bars: snap.bars,
    price: snap.price,
    prevClose: snap.prevClose > 0 ? snap.prevClose : null,
    regularMarketTime: snap.regularMarketTime,
    gmtoffset: snap.gmtoffset,
    exchangeTimezoneName: snap.exchangeTimezoneName,
  }
  const perf: Record<GroupPeriod, number | null> = {
    '1d': memberPeriodReturnPct(input, '1d'),
    '1w': memberPeriodReturnPct(input, '1w'),
    '1m': memberPeriodReturnPct(input, '1m'),
    '3m': memberPeriodReturnPct(input, '3m'),
    '6m': memberPeriodReturnPct(input, '6m'),
  }
  return {
    ticker: snap.symbol.trim().toUpperCase(),
    name: snap.name,
    price: snap.price,
    prevClose: snap.prevClose,
    changePct: perf['1d'],
    perf,
    relVolume: relativeVolume(input),
    avgVolume: averageShareVolume(input),
  }
}

export type QuoteLoader = (symbol: string) => Promise<MemberQuote | null>

async function defaultFetchQuote(symbol: string): Promise<MemberQuote | null> {
  const snap: SymbolSnapshot = await fetchSymbolSnapshot(symbol, { preferYahoo: true })
  return quoteFromSnapshot(snap)
}

interface CacheHit {
  at: number
  quote: MemberQuote | null
}

const quoteCache = new Map<string, CacheHit>()
const inflight = new Map<string, Promise<MemberQuote | null>>()

export function clearMemberQuoteCache(): void {
  quoteCache.clear()
  inflight.clear()
}

function readCached(symbol: string, now: number): MemberQuote | null | undefined {
  const hit = quoteCache.get(symbol)
  if (!hit) return undefined
  const ttl = hit.quote ? MEMBER_QUOTE_TTL_MS : MEMBER_QUOTE_FAIL_TTL_MS
  if (now - hit.at > ttl) {
    quoteCache.delete(symbol)
    return undefined
  }
  return hit.quote
}

export async function loadMemberQuote(
  symbol: string,
  fetchQuote: QuoteLoader = defaultFetchQuote,
  now: () => number = Date.now,
): Promise<MemberQuote | null> {
  const key = symbol.trim().toUpperCase()
  const cached = readCached(key, now())
  if (cached !== undefined) return cached
  const existing = inflight.get(key)
  if (existing) return existing

  let resolveQuote: (quote: MemberQuote | null) => void = () => {}
  const pending = new Promise<MemberQuote | null>((resolve) => {
    resolveQuote = resolve
  })
  inflight.set(key, pending)
  try {
    const quote = await fetchQuote(key)
    const stored = quote ? { ...quote, ticker: key } : null
    quoteCache.set(key, { at: now(), quote: stored })
    resolveQuote(stored)
    return stored
  } catch {
    quoteCache.set(key, { at: now(), quote: null })
    resolveQuote(null)
    return null
  } finally {
    inflight.delete(key)
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export interface EnsureQuotesOptions {
  now?: () => number
  budgetMs?: number
  maxSymbols?: number
  concurrency?: number
  gapMs?: number
  fetchQuote?: QuoteLoader
}

/**
 * Resolve quotes for `tickers`. Cached symbols are free. Uncached ones run
 * until the time budget or the symbol cap, whichever comes first.
 * `resolved` is the set that now has a fresh cache entry (including failures).
 */
export async function ensureMemberQuotes(
  tickers: string[],
  opts: EnsureQuotesOptions = {},
): Promise<{ quotes: Map<string, MemberQuote | null>; resolved: Set<string> }> {
  const now = opts.now ?? Date.now
  const budgetMs = opts.budgetMs ?? Number.POSITIVE_INFINITY
  const maxSymbols = opts.maxSymbols ?? Number.POSITIVE_INFINITY
  const concurrency = Math.max(1, opts.concurrency ?? MEMBER_FETCH_CONCURRENCY)
  const gapMs = opts.gapMs ?? 0
  const fetchQuote = opts.fetchQuote ?? defaultFetchQuote
  const quotes = new Map<string, MemberQuote | null>()
  const resolved = new Set<string>()
  const uncached: string[] = []
  const seen = new Set<string>()

  for (const raw of tickers) {
    const key = raw.trim().toUpperCase()
    if (!key || seen.has(key)) continue
    seen.add(key)
    const cached = readCached(key, now())
    if (cached !== undefined) {
      quotes.set(key, cached)
      resolved.add(key)
    } else {
      uncached.push(key)
    }
  }

  const startedAt = now()
  let cursor = 0
  let startedCount = 0

  async function worker(): Promise<void> {
    while (cursor < uncached.length) {
      const room = remainingSymbolBudget(
        uncached.slice(cursor),
        { elapsedMs: now() - startedAt, startedCount },
        { budgetMs, maxSymbols },
      )
      if (room.take < 1) return
      const ticker = uncached[cursor]!
      cursor += 1
      startedCount += 1
      if (gapMs > 0 && startedCount > 1) {
        await sleep(gapMs)
        if (!(now() - startedAt < budgetMs)) return
      }
      const quote = await loadMemberQuote(ticker, fetchQuote, now)
      quotes.set(ticker, quote)
      resolved.add(ticker)
    }
  }

  if (uncached.length > 0) {
    const workers = Math.min(concurrency, uncached.length)
    await Promise.all(Array.from({ length: workers }, () => worker()))
  }
  return { quotes, resolved }
}
