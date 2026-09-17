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
