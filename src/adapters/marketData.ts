/**
 * Market data adapter — live by default.
 *
 * Cascade (server proxy): Finnhub REST → Yahoo Finance (unofficial) → Stooq.
 * Demo only when VITE_MARKET_DATA_MODE=demo. Never silently falls back to demo on live failure.
 * Kyle-style metrics are computed from live bars only (no Notion row access).
 *
 * Live mode scans SCAN_UNIVERSE (broader than a fixed personal watchlist),
 * scores each name, and derives setupStage (watching / coiled / triggering).
 */
import type { DashboardData, IndustryGroup, MarketRegime, TradingIdea } from '../types'
import { DEMO_DASHBOARD } from '../data/demoData'
import {
  SCAN_CONCURRENCY,
  SCAN_GAP_MS,
  SCAN_UNIVERSE,
  WATCHLIST_GROUPS,
} from '../data/watchlist'
import { applyEarningsToIdea, computeIdeaMetrics, computeMarketRegime } from '../lib/metrics'
import { fetchLiveEarningsBatch, fetchLiveSnapshot, mapPool } from './providers/liveFetch'

export interface MarketDataAdapter {
  readonly name: string
  fetch(): Promise<DashboardData>
}

export class DemoMarketAdapter implements MarketDataAdapter {
  readonly name = 'demo'

  async fetch(): Promise<DashboardData> {
    await Promise.resolve()
    return {
      ...DEMO_DASHBOARD,
      source: 'demo',
      asOf: DEMO_DASHBOARD.asOf,
      marketRegime: DEMO_DASHBOARD.marketRegime ?? {
        qqq10gt20: true,
        stDirection: 'Uptrend',
        detail: 'Demo regime (not live QQQ)',
      },
      scanUniverseSize: DEMO_DASHBOARD.ideas.length,
      scanHitCount: DEMO_DASHBOARD.ideas.length,
      scanFailCount: 0,
      scanBelow200Count: 0,
    }
  }
}

function buildGroups(ideas: TradingIdea[]): IndustryGroup[] {
  const byGroup = new Map<string, TradingIdea[]>()
  for (const idea of ideas) {
    const list = byGroup.get(idea.groupId) ?? []
    list.push(idea)
    byGroup.set(idea.groupId, list)
  }

  const groups: IndustryGroup[] = WATCHLIST_GROUPS.map((g) => {
    const members = byGroup.get(g.id) ?? []
    const avg = (pick: (i: TradingIdea) => number) =>
      members.length ? members.reduce((s, m) => s + pick(m), 0) / members.length : 0
    const perf1m = Math.round(avg((m) => m.perf1M) * 100) / 100
    const perf3m = Math.round(avg((m) => m.perf3M) * 100) / 100
    const perf6m = Math.round(avg((m) => m.perf6M) * 100) / 100
    return {
      ...g,
      rsRank: 0,
      leaderCount: members.filter((m) => m.pctFrom52wHigh >= -10).length,
      dayPct: Math.round(avg((m) => m.dayPct) * 100) / 100,
      weekPct: Math.round(avg((m) => m.perf1M / 4) * 100) / 100,
      monthPct: perf1m,
      perf1m,
      perf3m,
      perf6m,
      description: g.description,
    }
  }).filter((g) => (byGroup.get(g.id) ?? []).length > 0)

  // Rank by 3M group strength (prefer medium-horizon RS), fall back to 1M
  groups.sort((a, b) => b.perf3m - a.perf3m || b.perf1m - a.perf1m)
  groups.forEach((g, i) => {
    g.rsRank = i + 1
  })
  return groups
}

async function fetchQqqRegime(): Promise<MarketRegime | null> {
  try {
    const snap = await fetchLiveSnapshot('QQQ')
    return computeMarketRegime(snap.bars)
  } catch {
    return null
  }
}

export class LiveMarketAdapter implements MarketDataAdapter {
  readonly name = 'live'

  async fetch(): Promise<DashboardData> {
    const groupName = (id: string) =>
      WATCHLIST_GROUPS.find((g) => g.id === id)?.name ?? id

    const universe = SCAN_UNIVERSE

    const [settled, marketRegime] = await Promise.all([
      mapPool(
        universe,
        SCAN_CONCURRENCY,
        async (entry) => {
          const snap = await fetchLiveSnapshot(entry.ticker)
          const idea = computeIdeaMetrics(
            {
              ticker: entry.ticker,
              name: entry.name,
              groupId: entry.groupId,
              groupName: groupName(entry.groupId),
            },
            snap,
          )
          if (!idea) throw new Error(`Insufficient history for ${entry.ticker}`)
          return idea
        },
        SCAN_GAP_MS,
      ),
      fetchQqqRegime(),
    ])

    const ideas: TradingIdea[] = []
    const failures: string[] = []
    let belowSma200 = 0
    for (let i = 0; i < settled.length; i++) {
      const r = settled[i]!
      const ticker = universe[i]!.ticker
      if (r.status === 'fulfilled') {
        // Hard gate: below daily 200 SMA is not a valid setup — exclude from ideas list.
        if (!r.value.aboveSma200) {
          belowSma200 += 1
          continue
        }
        ideas.push(r.value)
      } else {
        const msg = r.reason instanceof Error ? r.reason.message : String(r.reason)
        failures.push(`${ticker}: ${msg}`)
      }
    }

    if (!ideas.length) {
      if (failures.length === universe.length) {
        throw new Error(
          `Could not load live data — all ${universe.length} symbols failed. ${failures.slice(0, 3).join(' | ')}`,
        )
      }
      throw new Error(
        `No valid setups: ${belowSma200} below 200 SMA, ${failures.length} fetch failures (hard trend gate).`,
      )
    }

    // Earnings proximity overlay (Finnhub calendar → Nasdaq). Avoid → not A+.
    try {
      const earnMap = await fetchLiveEarningsBatch(ideas.map((i) => i.ticker))
      for (let i = 0; i < ideas.length; i++) {
        const t = ideas[i]!.ticker.toUpperCase()
        const date = earnMap.has(t) ? earnMap.get(t)! : null
        ideas[i] = applyEarningsToIdea(ideas[i]!, date)
      }
    } catch {
      // Leave default clear earnings if calendar fails — still live bars.
    }

    return {
      source: 'live',
      asOf: new Date().toISOString(),
      groups: buildGroups(ideas),
      ideas,
      marketRegime,
      scanUniverseSize: universe.length,
      scanHitCount: ideas.length,
      scanFailCount: failures.length,
      scanBelow200Count: belowSma200,
    }
  }
}

function resolveAdapter(): MarketDataAdapter {
  const mode = (import.meta.env.VITE_MARKET_DATA_MODE as string | undefined) ?? 'live'
  if (mode === 'demo') return new DemoMarketAdapter()
  return new LiveMarketAdapter()
}

export type LoadDashboardResult =
  | {
      ok: true
      data: DashboardData
      usedFallback: false
      error: string | null
      mode: 'live' | 'demo'
    }
  | {
      ok: false
      data: null
      usedFallback: false
      error: string
      mode: 'live' | 'demo'
    }

/**
 * Load dashboard data. Live failures return an error — never DEMO rows.
 * Demo loads only when VITE_MARKET_DATA_MODE=demo.
 */
export async function loadDashboardData(): Promise<LoadDashboardResult> {
  const preferred = resolveAdapter()
  const mode = preferred.name === 'demo' ? 'demo' : 'live'
  try {
    const data = await preferred.fetch()
    return { ok: true, data, usedFallback: false, error: null, mode }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown adapter error'
    return {
      ok: false,
      data: null,
      usedFallback: false,
      error: message,
      mode,
    }
  }
}
