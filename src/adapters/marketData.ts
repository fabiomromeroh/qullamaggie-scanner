/**
 * Market data adapter — live by default.
 *
 * Live mode reads the server scan cache (`GET /api/market/dashboard`).
 * Stage 1 (Yahoo liquid US equity screen) + Stage 2 (deep metrics) run
 * server-side so the browser never scans thousands of symbols on load.
 * Demo only when VITE_MARKET_DATA_MODE=demo — never a silent live→demo fallback.
 */
import type { DashboardData } from '../types'
import { DEMO_DASHBOARD } from '../data/demoData'

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



export class LiveMarketAdapter implements MarketDataAdapter {
  readonly name = 'live'

  async fetch(): Promise<DashboardData> {
    // Server owns the Yahoo Stage-1 + deep Stage-2 scan; UI only reads the cache.
    const res = await fetch('/api/market/dashboard')
    const body = (await res.json()) as DashboardData & {
      error?: string
      status?: unknown
    }
    if (res.status === 503) {
      throw new Error(
        body.error ||
          'Live scan cache is warming up — click Refresh in a minute (server-side Yahoo screen in progress).',
      )
    }
    if (!res.ok) {
      throw new Error(body.error || `Dashboard cache failed (${res.status})`)
    }
    if (!body.ideas?.length) {
      throw new Error('Live scan cache returned no ideas')
    }
    return {
      ...body,
      source: 'live',
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
