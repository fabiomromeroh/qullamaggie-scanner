import type { SymbolBars } from '../../lib/metrics'

interface SnapshotResponse {
  symbol: string
  name?: string
  price: number
  prevClose: number
  bars: Array<{ t: number; o: number; h: number; l: number; c: number; v: number }>
  provider: string
  error?: string
}

/**
 * Fetch one symbol via the Vite/server proxy (Finnhub → Yahoo → Stooq cascade runs server-side).
 */
export async function fetchLiveSnapshot(symbol: string): Promise<SymbolBars> {
  const res = await fetch(`/api/market/snapshot?symbol=${encodeURIComponent(symbol)}`)
  const body = (await res.json()) as SnapshotResponse
  if (!res.ok) {
    throw new Error(body.error || `Snapshot failed for ${symbol} (${res.status})`)
  }
  if (!body.bars?.length) {
    throw new Error(`Empty bars for ${symbol}`)
  }
  return {
    symbol: body.symbol,
    name: body.name,
    bars: body.bars,
    price: body.price,
    prevClose: body.prevClose,
    provider: body.provider,
  }
}

/** Bounded concurrency map. */
export async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
  gapMs = 0,
): Promise<PromiseSettledResult<R>[]> {
  const results: PromiseSettledResult<R>[] = new Array(items.length)
  let next = 0

  async function worker() {
    while (next < items.length) {
      const i = next++
      try {
        if (gapMs > 0 && i > 0) {
          await new Promise((r) => setTimeout(r, gapMs))
        }
        const value = await fn(items[i]!)
        results[i] = { status: 'fulfilled', value }
      } catch (reason) {
        results[i] = { status: 'rejected', reason }
      }
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => worker())
  await Promise.all(workers)
  return results
}

export interface EarningsResponse {
  symbol: string
  earningsDate: string | null
  provider: string
}

/** Fetch earnings for one symbol via server proxy (Finnhub → Nasdaq). */
export async function fetchLiveEarnings(symbol: string): Promise<EarningsResponse> {
  const res = await fetch(`/api/market/earnings?symbol=${encodeURIComponent(symbol)}`)
  const body = (await res.json()) as EarningsResponse & { error?: string }
  if (!res.ok) {
    throw new Error(body.error || `Earnings failed for ${symbol} (${res.status})`)
  }
  return body
}

/** Batch earnings lookup (comma-separated symbols). */
export async function fetchLiveEarningsBatch(
  symbols: string[],
): Promise<Map<string, string | null>> {
  const map = new Map<string, string | null>()
  if (!symbols.length) return map
  // Chunk to keep URLs reasonable
  const chunkSize = 80
  for (let i = 0; i < symbols.length; i += chunkSize) {
    const chunk = symbols.slice(i, i + chunkSize)
    const res = await fetch(
      `/api/market/earnings/batch?symbols=${encodeURIComponent(chunk.join(','))}`,
    )
    const body = (await res.json()) as {
      results?: EarningsResponse[]
      error?: string
    }
    if (!res.ok) {
      throw new Error(body.error || `Earnings batch failed (${res.status})`)
    }
    for (const row of body.results ?? []) {
      map.set(row.symbol.toUpperCase(), row.earningsDate)
    }
  }
  return map
}


export class ScanWarmingError extends Error {
  readonly scanning = true as const
  constructor(message: string) {
    super(message)
    this.name = 'ScanWarmingError'
  }
}

export interface ScanStatusPayload {
  scanning: boolean
  startedAt: string | null
  finishedAt: string | null
  lastError: string | null
  cacheAgeMs: number | null
  cacheAsOf: string | null
  hasCache?: boolean
  stage1Source: string | null
  stage1Count: number | null
  stage15Count: number | null
  shortlistCount: number | null
  emergencyFallback: boolean
}

export type DashboardCacheResult =
  | { kind: 'ready'; body: unknown }
  | { kind: 'scanning'; message: string; status?: ScanStatusPayload }

function isScanningBody(body: unknown): body is {
  scanning?: boolean
  message?: string
  error?: string
  status?: ScanStatusPayload
} {
  return Boolean(body) && typeof body === 'object'
}

/** Read server scan cache (Stage-1 Yahoo + Stage-2 deep metrics). */
export async function fetchDashboardCache(): Promise<DashboardCacheResult> {
  const res = await fetch('/api/market/dashboard')
  const body = await res.json()
  // Cold start: cache empty, background scan started (202) — or legacy 503.
  if (
    res.status === 202 ||
    (isScanningBody(body) && body.scanning === true) ||
    (res.status === 503 &&
      isScanningBody(body) &&
      typeof body.error === 'string' &&
      /scan cache empty|warming/i.test(body.error))
  ) {
    const msg =
      (isScanningBody(body) && (body.message || body.error)) ||
      'Scanning US market…'
    return {
      kind: 'scanning',
      message: msg,
      status: isScanningBody(body) ? body.status : undefined,
    }
  }
  if (!res.ok) {
    const err = body as { error?: string }
    throw new Error(err.error || `Dashboard cache failed (${res.status})`)
  }
  return { kind: 'ready', body }
}

/** Ask server to refresh the scan in the background. */
export async function requestScanRefresh(): Promise<unknown> {
  const res = await fetch('/api/market/scan/refresh', { method: 'POST' })
  return res.json()
}

/** Poll scan status (scanning flag, cache age, stage-1 counts). */
export async function fetchScanStatus(): Promise<ScanStatusPayload> {
  const res = await fetch('/api/market/scan/status')
  return (await res.json()) as ScanStatusPayload
}
