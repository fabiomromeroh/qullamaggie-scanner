/**
 * Drill into one Finviz industry: top page of the performance screener, then
 * the same Stage-2 scorer as the full scan. Names that fail the 200-SMA gate
 * are kept and flagged. Names with no bars go in `failed` instead of vanishing.
 * Result cache is 12 minutes per (slug, period). Tickers already in the scan
 * cache are copied (group id/name overwritten) so we don't hit providers twice.
 */
import type { GroupPeriod, GroupStocksResponse, TradingIdea } from '../src/types/index.ts'
import { periodOrder } from '../src/lib/groupPeriod.ts'
import { FINVIZ_CACHE_TTL_MS } from './finvizHttp.ts'
import { getScreenerPage } from './finvizScreener.ts'
import { screenerPeriodPerf } from './finvizScreenerParse.ts'
import { loadScanCache } from './scanCache.ts'
import { scoreTickers } from './scanEngine.ts'

interface CachedStocks {
  payload: GroupStocksResponse
  storedAt: number
}

const cache = new Map<string, CachedStocks>()
const inFlight = new Map<string, Promise<GroupStocksResponse>>()

function cloneForGroup(idea: TradingIdea, slug: string, label: string): TradingIdea {
  return {
    ...idea,
    groupId: slug,
    groupName: label,
    characteristics: [...idea.characteristics],
    sparkline: idea.sparkline.map((point) => ({ ...point })),
  }
}

async function buildGroupStocks(
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
    parsedCount: page.rows.length,
  }
}

export async function getGroupStocks(
  slug: string,
  period: GroupPeriod,
  label: string,
): Promise<GroupStocksResponse> {
  const key = `${slug}|${period}`
  const hit = cache.get(key)
  if (hit && Date.now() - hit.storedAt < FINVIZ_CACHE_TTL_MS) {
    return hit.payload
  }

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
