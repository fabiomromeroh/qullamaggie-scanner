/**
 * Breadth background job: Yahoo 2y daily bars for every membership-snapshot
 * ticker → per-day Stockbee-style counts (src/lib/breadth.ts).
 *
 * Cost: one Yahoo chart request per ticker (~1,850), gated by
 * BREADTH_CONCURRENCY (default 3) plus a short pause per request. Bars are
 * folded into per-day counters and discarded, so memory stays small.
 * Results go to memory and to a JSON file; a committed snapshot
 * (server/data/breadth-snapshot.json, built with `npm run build:breadth`) is
 * loaded at boot so hosts that cannot afford the job can still serve breadth.
 *
 *   GET  /api/breadth            latest result + job state (starts a job if nothing is cached)
 *   POST /api/breadth/recompute  force a new run
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import {
  accumulateStock,
  BREADTH_RULES,
  breadthNeedsRefresh,
  chartQuote,
  finalizeRows,
  markPartial,
  type BreadthRow,
  type ChartQuote,
  type DayCounts,
} from '../src/lib/breadth.ts'
import { sendJson, membershipUniverse } from './pulseShared.ts'
import { fetchDailySeriesUncached } from './yahooClient.ts'
import { createJobQueue } from './requestBudget.ts'

export const BREADTH_DAYS = Number(process.env.BREADTH_DAYS) || 60

export interface BreadthResult {
  version: 1
  generatedAt: string
  runtimeMs: number
  requests: number
  tickers: number
  failed: number
  rules: typeof BREADTH_RULES
  rows: BreadthRow[]
  /** Last price / change / 20d $vol per ticker from the same chart data (tape movers, group members). */
  quotes?: ChartQuote[]
  source: 'yahoo'
}

export interface BreadthJobState {
  status: 'idle' | 'running' | 'error'
  startedAt?: string
  done: number
  total: number
  failed: number
  error?: string
}

let result: BreadthResult | null = null
let job: BreadthJobState = { status: 'idle', done: 0, total: 0, failed: 0 }
let running: Promise<void> | null = null

export function snapshotPath(): string {
  return process.env.BREADTH_SNAPSHOT_PATH
    ? resolve(process.env.BREADTH_SNAPSHOT_PATH)
    : resolve(process.cwd(), 'server/data/breadth-snapshot.json')
}

function runtimeCachePath(): string {
  return process.env.BREADTH_CACHE_PATH ? resolve(process.env.BREADTH_CACHE_PATH) : join(tmpdir(), 'qm-breadth-cache.json')
}

function readResult(path: string): BreadthResult | null {
  try {
    if (!existsSync(path)) return null
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as BreadthResult
    return parsed?.version === 1 && Array.isArray(parsed.rows) ? parsed : null
  } catch {
    return null
  }
}

export function writeResultAtomic(path: string, value: BreadthResult): void {
  mkdirSync(dirname(path), { recursive: true })
  const tmp = `${path}.tmp-${process.pid}`
  writeFileSync(tmp, `${JSON.stringify(value)}\n`)
  renameSync(tmp, path)
}

/** Newest of the committed snapshot and the runtime cache. */
export function loadBestCached(): BreadthResult | null {
  const candidates = [readResult(snapshotPath()), readResult(runtimeCachePath())].filter(
    (r): r is BreadthResult => r != null,
  )
  candidates.sort((a, b) => b.generatedAt.localeCompare(a.generatedAt))
  return candidates[0] ?? null
}

async function sleep(ms: number): Promise<void> {
  await new Promise((r) => setTimeout(r, ms))
}

/** Run the full computation. `onProgress` is called after each ticker. */
export async function computeBreadth(
  tickers: readonly string[],
  opts: { concurrency?: number; pauseMs?: number; days?: number; onProgress?: (done: number, failed: number) => void } = {},
): Promise<BreadthResult> {
  const started = Date.now()
  const days = opts.days ?? BREADTH_DAYS
  const gate = createJobQueue(opts.concurrency ?? (Number(process.env.BREADTH_CONCURRENCY) || 3))
  const pause = opts.pauseMs ?? 50
  const acc = new Map<string, DayCounts>()
  const quotes: ChartQuote[] = []
  let done = 0
  let failed = 0
  let requests = 0
  await Promise.all(
    tickers.map(async (t) => {
      await gate.acquire()
      try {
        requests++
        const series = await fetchDailySeriesUncached(t, '2y')
        // Ratios need 10 extra sessions beyond the rows kept.
        accumulateStock(series.bars, days + 10, acc)
        const q = chartQuote(t, series)
        if (q) quotes.push(q)
      } catch {
        failed++
      } finally {
        done++
        opts.onProgress?.(done, failed)
        if (pause) await sleep(pause)
        gate.release()
      }
    }),
  )
  // Drop partial dates (e.g. a ticker list straddling a holiday) with < 50% of the max universe.
  const maxU = Math.max(0, ...[...acc.values()].map((r) => r.universe))
  const nowMs = Date.now()
  return {
    version: 1,
    generatedAt: new Date(nowMs).toISOString(),
    runtimeMs: Date.now() - started,
    requests,
    tickers: tickers.length,
    failed,
    rules: BREADTH_RULES,
    rows: markPartial(finalizeRows(acc, days, Math.ceil(maxU * 0.5)), nowMs),
    quotes: quotes.sort((a, b) => a.ticker.localeCompare(b.ticker)),
    source: 'yahoo',
  }
}

export function startBreadthJob(): BreadthJobState {
  if (running) return job
  const { tickers } = membershipUniverse()
  job = { status: 'running', startedAt: new Date().toISOString(), done: 0, total: tickers.length, failed: 0 }
  running = computeBreadth(tickers, {
    onProgress: (done, failed) => {
      job = { ...job, done, failed }
    },
  })
    .then((r) => {
      result = r
      try {
        writeResultAtomic(runtimeCachePath(), r)
      } catch (err) {
        console.warn(`breadth cache write failed: ${err instanceof Error ? err.message : err}`)
      }
      job = { status: 'idle', done: job.done, total: job.total, failed: job.failed }
      console.log(`breadth: ${r.rows.length} rows, ${r.requests} requests, ${r.failed} failed, ${r.runtimeMs}ms`)
    })
    .catch((err: unknown) => {
      job = { ...job, status: 'error', error: err instanceof Error ? err.message : 'breadth job failed' }
    })
    .finally(() => {
      running = null
    })
  return job
}

export function getBreadth(): { result: BreadthResult | null; job: BreadthJobState } {
  if (!result) result = loadBestCached()
  if (!result && !running && process.env.BREADTH_AUTO !== '0') startBreadthJob()
  return { result, job }
}

/** Start a background refresh when the cached result is stale (see breadthNeedsRefresh). */
export function maybeRefreshBreadth(now = Date.now()): void {
  if (running || process.env.BREADTH_AUTO === '0') return
  if (!result) result = loadBestCached()
  if (breadthNeedsRefresh(result?.generatedAt, now)) startBreadthJob()
}

/** Chart-derived quotes from the latest breadth run, or null when none exist. */
export function getBreadthQuotes(): { generatedAt: string; quotes: Map<string, ChartQuote> } | null {
  if (!result) result = loadBestCached()
  if (!result?.quotes?.length) return null
  return { generatedAt: result.generatedAt, quotes: new Map(result.quotes.map((q) => [q.ticker, q])) }
}

type MiniReq = { url?: string; method?: string }

export function createBreadthMiddleware() {
  return async function breadthMiddleware(req: MiniReq, res: Parameters<typeof sendJson>[0], next: () => void) {
    const url = new URL(req.url ?? '/', 'http://localhost')
    const pathname = url.pathname.replace(/\/+$/, '')
    if (pathname === '/api/breadth') {
      const body = getBreadth()
      maybeRefreshBreadth()
      const { quotes: _quotes, ...light } = body.result ?? {}
      sendJson(res, 200, { result: body.result ? light : null, job })
      return
    }
    if (pathname === '/api/breadth/recompute') {
      if ((req.method ?? 'GET').toUpperCase() !== 'POST') {
        sendJson(res, 405, { error: 'POST required' })
        return
      }
      if (!result) result = loadBestCached()
      const started = startBreadthJob()
      const { quotes: _q, ...light } = result ?? {}
      sendJson(res, 202, { result: result ? light : null, job: started })
      return
    }
    next()
  }
}
