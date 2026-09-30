/**
 * Drill into one industry: top 20 snapshot members by the selected period,
 * then the same Stage-2 scorer as the full scan. Names below the 200-SMA are
 * kept and flagged. Names with no bars go in `failed`.
 * FINVIZ_SCREENER_LIVE=1 tries the live screener page first and falls back
 * to the snapshot. The default makes no screener request.
 * Scored payloads are cached 12 minutes per (slug, period, snapshot time).
 */
import type { GroupPeriod, GroupStocksResponse, TradingIdea } from '../src/types/index.ts'
import { periodOrder } from '../src/lib/groupPeriod.ts'
import { rankLeaderPool } from '../src/lib/memberPerf.ts'
import { FINVIZ_CACHE_TTL_MS } from './finvizHttp.ts'
import { finvizScreenerLiveEnabled, getScreenerPage } from './finvizScreener.ts'
import { screenerPeriodPerf } from './finvizScreenerParse.ts'
import {
  isMembershipStale,
  loadMembershipSnapshot,
  lookupMembershipGroup,
} from './groupMembers.ts'
import { ensureMemberQuotes, MEMBER_FETCH_CONCURRENCY, MEMBER_FETCH_GAP_MS } from './groupPerformance.ts'
import { loadScanCache } from './scanCache.ts'
import { scoreTickers } from './scanEngine.ts'

interface CachedStocks {
  payload: GroupStocksResponse
  storedAt: number
}

const cache = new Map<string, CachedStocks>()
const inFlight = new Map<string, Promise<GroupStocksResponse>>()

export function clearGroupStocksCache(): void {
  cache.clear()
  inFlight.clear()
}

function cloneForGroup(idea: TradingIdea, slug: string, label: string): TradingIdea {
  return {
    ...idea,
    groupId: slug,
    groupName: label,
    characteristics: [...idea.characteristics],
    sparkline: idea.sparkline.map((point) => ({ ...point })),
  }
}

async function buildFromScreenerPage(
  slug: string,
  period: GroupPeriod,
  label: string,
): Promise<GroupStocksResponse> {
  const order = periodOrder(period)
  const page = await getScreenerPage(slug, order)
  const scan = loadScanCache()
  const scanByTicker = new Map(
    (scan?.ideas ?? []).map((idea) => [idea.ticker.toUpperCase(), idea] as const),
  )
  const companyByTicker = new Map(page.rows.map((row) => [row.ticker.toUpperCase(), row.company]))
  const need: string[] = []
  const reused: TradingIdea[] = []
  for (const row of page.rows) {
    const ticker = row.ticker.toUpperCase()
    const cached = scanByTicker.get(ticker)
    if (cached) reused.push(cloneForGroup(cached, slug, label))
    else need.push(row.ticker)
  }

  const scored = await scoreTickers(need, {
    includeBelowSma200: true,
    groupOverride: { groupId: slug, groupName: label },
    describe(symbol) {
      return {
        name: companyByTicker.get(symbol.toUpperCase()) || symbol,
        groupId: slug,
        groupName: label,
      }
    },
  })

  const byTicker = new Map<string, TradingIdea>()
  for (const idea of reused) byTicker.set(idea.ticker.toUpperCase(), idea)
  for (const idea of scored.ideas) byTicker.set(idea.ticker.toUpperCase(), idea)
  const failedByTicker = new Map(
    scored.failed.map((failure) => [failure.ticker.toUpperCase(), failure] as const),
  )

  const ideas: TradingIdea[] = []
  const failed: GroupStocksResponse['failed'] = []
  const finvizPerf: Record<string, number | null> = {}
  for (const row of page.rows) {
    const ticker = row.ticker.toUpperCase()
    finvizPerf[ticker] = screenerPeriodPerf(row, period)
    const idea = byTicker.get(ticker)
    if (idea) {
      ideas.push(idea)
      continue
    }
    const failure = failedByTicker.get(ticker)
    failed.push(failure ?? { ticker, reason: 'No data' })
  }

  return {
    slug,
    label,
    period,
    order,
    source: 'finviz',
    fetchedAt: new Date().toISOString(),
    stale: page.stale,
    ideas,
    failed,
    finvizPerf,
    perfByTicker: finvizPerf,
    parsedCount: page.rows.length,
  }
}

async function buildFromSnapshot(
  slug: string,
  period: GroupPeriod,
  label: string,
): Promise<GroupStocksResponse> {
  const loaded = loadMembershipSnapshot()
  if (!loaded.ok) throw new Error(loaded.error)
  const group = lookupMembershipGroup(loaded.snapshot, slug)
  if (!group) throw new Error('not in membership snapshot; run npm run build:groups')

  const { quotes, resolved } = await ensureMemberQuotes(group.tickers, {
    budgetMs: Number.POSITIVE_INFINITY,
    maxSymbols: Number.POSITIVE_INFINITY,
    concurrency: MEMBER_FETCH_CONCURRENCY,
    gapMs: MEMBER_FETCH_GAP_MS,
  })
  const missing = group.tickers.filter((ticker) => !resolved.has(ticker))
  if (missing.length > 0) {
    throw new Error('Performance compute stopped before every snapshot member was resolved')
  }

  const rows = group.tickers.map((ticker) => {
    const quote = quotes.get(ticker) ?? null
    return {
      ticker,
      company: group.companies?.[ticker] || quote?.name || ticker,
      perf: quote?.perf[period] ?? null,
    }
  })
  const pool = rankLeaderPool(rows).filter((row) => row.perf != null)
  if (group.tickers.length > 0 && pool.length === 0) {
    throw new Error(
      'No performance data for snapshot members (market data providers failed or history is too short)',
    )
  }

  const scan = loadScanCache()
  const scanByTicker = new Map(
    (scan?.ideas ?? []).map((idea) => [idea.ticker.toUpperCase(), idea] as const),
  )
  const companyByTicker = new Map(pool.map((row) => [row.ticker, row.company]))
  const need: string[] = []
  const reused: TradingIdea[] = []
  for (const row of pool) {
    const cached = scanByTicker.get(row.ticker)
    if (cached) reused.push(cloneForGroup(cached, slug, label))
    else need.push(row.ticker)
  }

  const scored = await scoreTickers(need, {
    includeBelowSma200: true,
    groupOverride: { groupId: slug, groupName: label },
    describe(symbol) {
      return {
        name: companyByTicker.get(symbol.toUpperCase()) || symbol,
        groupId: slug,
        groupName: label,
      }
    },
  })

  const byTicker = new Map<string, TradingIdea>()
  for (const idea of reused) byTicker.set(idea.ticker.toUpperCase(), idea)
  for (const idea of scored.ideas) byTicker.set(idea.ticker.toUpperCase(), idea)
  const failedByTicker = new Map(
    scored.failed.map((failure) => [failure.ticker.toUpperCase(), failure] as const),
  )

  const ideas: TradingIdea[] = []
  const failed: GroupStocksResponse['failed'] = []
  const perfByTicker: Record<string, number | null> = {}
  for (const row of pool) {
    perfByTicker[row.ticker] = row.perf
    const idea = byTicker.get(row.ticker)
    if (idea) {
      ideas.push(idea)
      continue
    }
    const failure = failedByTicker.get(row.ticker)
    failed.push(failure ?? { ticker: row.ticker, reason: 'No data' })
  }

  return {
    slug,
    label,
    period,
    order: periodOrder(period),
    source: 'snapshot',
    fetchedAt: new Date().toISOString(),
    stale: false,
    ideas,
    failed,
    finvizPerf: perfByTicker,
    perfByTicker,
    parsedCount: pool.length,
    membership: {
      generatedAt: loaded.snapshot.generatedAt,
      stale: isMembershipStale(loaded.snapshot.generatedAt),
    },
  }
}

async function buildGroupStocks(
  slug: string,
  period: GroupPeriod,
  label: string,
): Promise<GroupStocksResponse> {
  if (finvizScreenerLiveEnabled()) {
    try {
      return await buildFromScreenerPage(slug, period, label)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Finviz screener failed'
      console.warn(`finviz screener live failed for ${slug}: ${message}; using membership snapshot`)
    }
  }
  return buildFromSnapshot(slug, period, label)
}

export async function getGroupStocks(
  slug: string,
  period: GroupPeriod,
  label: string,
): Promise<GroupStocksResponse> {
  const loaded = loadMembershipSnapshot()
  const stamp = loaded.ok ? loaded.snapshot.generatedAt : 'missing'
  const key = `${slug}|${period}|${stamp}|${finvizScreenerLiveEnabled() ? 'live' : 'snapshot'}`
  const hit = cache.get(key)
  if (hit && Date.now() - hit.storedAt < FINVIZ_CACHE_TTL_MS) return hit.payload

  const existing = inFlight.get(key)
  if (existing) return existing

  const pending = buildGroupStocks(slug, period, label)
    .then((payload) => {
      cache.set(key, { payload, storedAt: Date.now() })
      return payload
    })
    .catch((err) => {
      if (hit) return { ...hit.payload, stale: true }
      throw err
    })
    .finally(() => {
      inFlight.delete(key)
    })
  inFlight.set(key, pending)
  return pending
}
