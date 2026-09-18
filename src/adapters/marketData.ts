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
import {
  fetchDashboardCache,
  ScanWarmingError,
} from './providers/liveFetch'

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
    const result = await fetchDashboardCache()
    if (result.kind === 'scanning') {
      throw new ScanWarmingError(result.message || 'Scanning US market…')
    }
    const body = result.body as DashboardData & {
      error?: string
      status?: unknown
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
      scanning: false
    }
  | {
      ok: false
      data: null
      usedFallback: false
      error: string
      mode: 'live' | 'demo'
      scanning: true
    }
  | {
      ok: false
      data: null
      usedFallback: false
      error: string
      mode: 'live' | 'demo'
      scanning: false
    }

/**
 * Load dashboard data. Live failures return an error — never DEMO rows.
 * Cold-start scanning is reported separately so the UI can poll without a LIVE ERROR.
 * Demo loads only when VITE_MARKET_DATA_MODE=demo.
 */
export async function loadDashboardData(): Promise<LoadDashboardResult> {
  const preferred = resolveAdapter()
  const mode = preferred.name === 'demo' ? 'demo' : 'live'
  try {
    const data = await preferred.fetch()
    return { ok: true, data, usedFallback: false, error: null, mode, scanning: false }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown adapter error'
    if (err instanceof ScanWarmingError || (err as { scanning?: boolean })?.scanning) {
      return {
        ok: false,
        data: null,
        usedFallback: false,
        error: message,
        mode,
        scanning: true,
      }
    }
    return {
      ok: false,
      data: null,
      usedFallback: false,
      error: message,
      mode,
      scanning: false,
    }
  }
}
