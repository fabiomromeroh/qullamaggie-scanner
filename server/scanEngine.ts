/**
 * Three-stage US liquid equity scan.
 * Stage 1: Yahoo screener (price > $5, avg vol >= 750k, equities only).
 * Stage 1.5: cheap Yahoo quote SMA prefilter (above 200 AND above 50).
 * Stage 2: deep Kyle/Qullamaggie metrics on survivors (Yahoo-first cascade).
 */
import type { IndustryGroup, TradingIdea } from '../src/types/index.ts'
import {
  applyEarningsToIdea,
  computeIdeaMetrics,
  computeMarketRegime,
  type SymbolBars,
} from '../src/lib/metrics.ts'
import { SCAN_UNIVERSE, WATCHLIST_GROUPS } from '../src/data/watchlist.ts'
import {
  fetchEarningsBatch,
  fetchSymbolSnapshot,
  runSmaPrefilter,
  type SymbolSnapshot,
} from './marketProxy.ts'
import {
  MIN_AVG_DAILY_VOL,
  MIN_PRICE,
  STAGE1_CAP,
  runYahooEquityScreener,
  type ScreenerHit,
} from './yahooScreener.ts'
import {
  beginScanLock,
  endScanLock,
  isCacheStale,
  loadScanCache,
  saveScanCache,
  type ScanCachePayload,
} from './scanCache.ts'

const STAGE2_CONCURRENCY = Number(process.env.SCAN_STAGE2_CONCURRENCY || 3)
const STAGE2_GAP_MS = Number(process.env.SCAN_STAGE2_GAP_MS || 150)

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

function slugify(input: string): string {
  return (
    input
      .toLowerCase()
      .replace(/&/g, ' and ')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 48) || 'other'
  )
}

function snapToBars(snap: SymbolSnapshot): SymbolBars {
  return {
    symbol: snap.symbol,
    name: snap.name,
    bars: snap.bars,
    price: snap.price,
    prevClose: snap.prevClose,
    provider: snap.provider,
  }
}

export interface ScoreTickerFailure {
  ticker: string
  reason: string
}

export interface ScoreTickersOptions {
  /** Force group id/name (Finviz drill-down). Wins over `describe`. */
  groupOverride?: { groupId: string; groupName: string }
  /** Per-symbol name and industry when the caller already knows them. */
  describe?: (symbol: string) => { name: string; groupId: string; groupName: string }
  /**
   * Default false: names below the 200 SMA are counted and dropped before the
   * earnings pass, matching the full scan. Group drill-down sets true so those
   * names are returned and flagged (`aboveSma200` false, tag `Below 200MA`).
   */
  includeBelowSma200?: boolean
}

export interface ScoreTickersResult {
  ideas: TradingIdea[]
  failed: ScoreTickerFailure[]
  belowSma200Count: number
  /** Set when the earnings batch throws. Ideas are still returned without that overlay. */
  earningsError?: string
}

/**
 * Stage-2 scoring used by the full scan and by group drill-down:
 * fetchSymbolSnapshot → computeIdeaMetrics → fetchEarningsBatch / applyEarningsToIdea.
 * Concurrency and gap are the scan's STAGE2_* settings. Snapshot cache in
 * marketProxy is reused when a symbol was fetched recently.
 */
export async function scoreTickers(
  symbols: string[],
  opts?: ScoreTickersOptions,
): Promise<ScoreTickersResult> {
  const includeBelow = opts?.includeBelowSma200 === true
  const settled = await mapPool(
    symbols,
    STAGE2_CONCURRENCY,
    async (symbol) => {
      const snap = await fetchSymbolSnapshot(symbol, { preferYahoo: true })
      const described = opts?.describe?.(symbol)
      const idea = computeIdeaMetrics(
        {
          ticker: symbol,
          name: described?.name || symbol,
          groupId: opts?.groupOverride?.groupId ?? described?.groupId ?? 'other',
          groupName: opts?.groupOverride?.groupName ?? described?.groupName ?? 'Other',
        },
        snapToBars(snap),
      )
      if (!idea) throw new Error(`Insufficient history for ${symbol}`)
      return idea
    },
    STAGE2_GAP_MS,
  )

  const ideas: TradingIdea[] = []
  const failed: ScoreTickerFailure[] = []
  let belowSma200Count = 0
  for (let i = 0; i < settled.length; i++) {
    const result = settled[i]!
    const symbol = symbols[i]!
    if (result.status === 'fulfilled') {
      if (!result.value.aboveSma200) {
        belowSma200Count += 1
        if (!includeBelow) continue
      }
      ideas.push(result.value)
    } else {
      const reason = result.reason instanceof Error ? result.reason.message : String(result.reason)
      failed.push({ ticker: symbol, reason })
    }
  }

  let earningsError: string | undefined
  try {
    if (ideas.length) {
      const earnRows = await fetchEarningsBatch(ideas.map((idea) => idea.ticker))
      const earnMap = new Map(
        earnRows.map((row) => [row.symbol.toUpperCase(), row.earningsDate] as const),
      )
      for (let i = 0; i < ideas.length; i++) {
        const ticker = ideas[i]!.ticker.toUpperCase()
        ideas[i] = applyEarningsToIdea(ideas[i]!, earnMap.get(ticker) ?? null)
      }
    }
  } catch (err) {
    earningsError = err instanceof Error ? err.message : String(err)
  }

  return { ideas, failed, belowSma200Count, earningsError }
}

async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
  gapMs: number,
): Promise<PromiseSettledResult<R>[]> {
  const results: PromiseSettledResult<R>[] = new Array(items.length)
  let next = 0
  async function worker() {
    while (next < items.length) {
      const i = next++
      try {
        if (gapMs > 0 && i > 0) await sleep(gapMs)
        const value = await fn(items[i]!)
        results[i] = { status: 'fulfilled', value }
      } catch (reason) {
        results[i] = { status: 'rejected', reason }
      }
    }
  }
  const n = Math.min(concurrency, Math.max(1, items.length))
  await Promise.all(Array.from({ length: n }, () => worker()))
  return results
}

function resolveGroup(
  hit: ScreenerHit | undefined,
  fallbackTicker: string,
): { groupId: string; groupName: string; name: string } {
  const industry = hit?.industry?.trim()
  const sector = hit?.sector?.trim()
  const label = industry || sector || 'Other'
  const known = SCAN_UNIVERSE.find((e) => e.ticker === fallbackTicker)
  if (known) {
    const g = WATCHLIST_GROUPS.find((x) => x.id === known.groupId)
    return {
      groupId: known.groupId,
      groupName: g?.name ?? known.groupId,
      name: hit?.longName || hit?.shortName || known.name,
    }
  }
  return {
    groupId: slugify(label),
    groupName: label,
    name: hit?.longName || hit?.shortName || fallbackTicker,
  }
}

export function buildDynamicGroups(ideas: TradingIdea[]): IndustryGroup[] {
  const byGroup = new Map<string, TradingIdea[]>()
  const names = new Map<string, string>()
  for (const idea of ideas) {
    const list = byGroup.get(idea.groupId) ?? []
    list.push(idea)
    byGroup.set(idea.groupId, list)
    names.set(idea.groupId, idea.groupName)
  }

  const groups: IndustryGroup[] = []
  for (const [id, members] of byGroup) {
    const avg = (pick: (i: TradingIdea) => number) =>
      members.length ? members.reduce((s, m) => s + pick(m), 0) / members.length : 0
    const perf1m = Math.round(avg((m) => m.perf1M) * 100) / 100
    const perf3m = Math.round(avg((m) => m.perf3M) * 100) / 100
    const perf6m = Math.round(avg((m) => m.perf6M) * 100) / 100
    const staticDesc = WATCHLIST_GROUPS.find((g) => g.id === id)?.description
    groups.push({
      id,
      name: names.get(id) ?? id,
      rsRank: 0,
      leaderCount: members.filter((m) => m.pctFrom52wHigh >= -10).length,
      dayPct: Math.round(avg((m) => m.dayPct) * 100) / 100,
      weekPct: Math.round(avg((m) => m.perf1M / 4) * 100) / 100,
      monthPct: perf1m,
      perf1m,
      perf3m,
      perf6m,
      description:
        staticDesc ?? `${names.get(id) ?? id} (dynamic from scan survivors)`,
      source: 'internal',
    })
  }

  groups.sort((a, b) => (b.perf3m ?? 0) - (a.perf3m ?? 0) || (b.perf1m ?? 0) - (a.perf1m ?? 0))
  groups.forEach((g, i) => {
    g.rsRank = i + 1
  })
  return groups
}

export async function runFullScan(): Promise<ScanCachePayload> {
  const t0 = Date.now()
  const errors: string[] = []
  let emergencyFallback = false
  let stage1Source = 'yahoo-screener'
  let stage1Filters: Record<string, unknown> = {
    minPrice: MIN_PRICE,
    minAvgDailyVol3m: MIN_AVG_DAILY_VOL,
    quoteType: 'EQUITY',
    region: 'us',
  }

  let hits: ScreenerHit[] = []
  try {
    const screen = await runYahooEquityScreener()
    hits = screen.hits
    stage1Source = screen.source
    stage1Filters = { ...stage1Filters, ...screen.filters }
    errors.push(...screen.errors)
  } catch (err) {
    errors.push(`stage1: ${err instanceof Error ? err.message : String(err)}`)
  }

  if (hits.length < 20) {
    emergencyFallback = true
    stage1Source = 'emergency-fallback-universe'
    errors.push(
      `Yahoo screen failed or too thin (${hits.length}) — using emergency SCAN_UNIVERSE (${SCAN_UNIVERSE.length} names)`,
    )
    hits = SCAN_UNIVERSE.map((e) => ({
      symbol: e.ticker,
      shortName: e.name,
      quoteType: 'EQUITY',
    }))
  }

  const stage1Hits = hits.slice(0, STAGE1_CAP)
  const hitBySym = new Map(stage1Hits.map((h) => [h.symbol.toUpperCase(), h]))

  let stage15Count = stage1Hits.length
  let stage15Below200 = 0
  let stage15Below50 = 0
  let stage15Missing = 0
  let stage15QuoteFails = 0
  let stage15Filters: Record<string, unknown> = {
    requireAbove200Sma: true,
    requireAbove50Sma: true,
  }

  let shortlist = stage1Hits
  try {
    const pre = await runSmaPrefilter(stage1Hits.map((h) => h.symbol))
    stage15Count = pre.stage15Count
    stage15Below200 = pre.belowSma200Count
    stage15Below50 = pre.belowSma50Count
    stage15Missing = pre.missingSmaCount
    stage15QuoteFails = pre.quoteFailCount
    stage15Filters = pre.filters
    const keep = new Set(pre.survivors)
    shortlist = stage1Hits.filter((h) => keep.has(h.symbol.toUpperCase()))
    console.log(
      JSON.stringify({
        scan: 'stage1.5',
        stage1: stage1Hits.length,
        stage15: shortlist.length,
        below200: stage15Below200,
        below50: stage15Below50,
        missingSma: stage15Missing,
        quoteFails: stage15QuoteFails,
      }),
    )
  } catch (err) {
    errors.push(`stage1.5: ${err instanceof Error ? err.message : String(err)}`)
    // Fail closed: do not deep-scan Stage-1 names without a successful SMA prefilter.
    shortlist = []
    stage15Count = 0
  }

  if (!shortlist.length) {
    throw new Error(
      `Stage 1.5 SMA prefilter produced zero survivors (stage1=${stage1Hits.length}, below200=${stage15Below200}, below50=${stage15Below50}, missing=${stage15Missing}). ${errors.slice(0, 3).join(' | ')}`,
    )
  }

  const scored = await scoreTickers(
    shortlist.map((hit) => hit.symbol),
    {
      includeBelowSma200: false,
      describe(symbol) {
        const group = resolveGroup(hitBySym.get(symbol.toUpperCase()), symbol)
        return { name: group.name, groupId: group.groupId, groupName: group.groupName }
      },
    },
  )
  const ideas = scored.ideas
  const below200 = scored.belowSma200Count
  const failCount = scored.failed.length
  for (const failure of scored.failed) {
    if (errors.length < 40) errors.push(`${failure.ticker}: ${failure.reason}`)
  }
  if (scored.earningsError) {
    errors.push(`earnings: ${scored.earningsError}`)
  }

  let marketRegime = null
  try {
    const qqq = await fetchSymbolSnapshot('QQQ', { preferYahoo: true })
    marketRegime = computeMarketRegime(qqq.bars)
  } catch (err) {
    errors.push(`qqq regime: ${err instanceof Error ? err.message : String(err)}`)
  }

  if (!ideas.length) {
    throw new Error(
      `Scan produced zero ideas (stage1=${stage1Hits.length}, stage15=${shortlist.length}, below200=${below200}, fails=${failCount}). ${errors.slice(0, 3).join(' | ')}`,
    )
  }

  const payload: ScanCachePayload = {
    source: 'live',
    asOf: new Date().toISOString(),
    groups: buildDynamicGroups(ideas),
    ideas,
    marketRegime,
    scanUniverseSize: stage1Hits.length,
    scanHitCount: ideas.length,
    scanFailCount: failCount,
    scanBelow200Count: below200,
    meta: {
      stage1Source,
      stage1Count: stage1Hits.length,
      stage15Count,
      shortlistCount: shortlist.length,
      stage1Filters,
      stage15Filters,
      stage15BelowSma200Count: stage15Below200,
      stage15BelowSma50Count: stage15Below50,
      stage15MissingSmaCount: stage15Missing,
      stage15QuoteFailCount: stage15QuoteFails,
      scanDurationMs: Date.now() - t0,
      errors: errors.slice(0, 50),
      emergencyFallback,
    },
  }

  saveScanCache(payload)
  return payload
}

export async function triggerScan(
  reason: string,
): Promise<{ started: boolean; status: string }> {
  if (!beginScanLock()) {
    return { started: false, status: 'already-scanning' }
  }
  console.log(JSON.stringify({ scan: 'start', reason }))
  try {
    const result = await runFullScan()
    console.log(
      JSON.stringify({
        scan: 'done',
        reason,
        stage1: result.meta.stage1Count,
        stage15: result.meta.stage15Count,
        hits: result.scanHitCount,
        source: result.meta.stage1Source,
        ms: result.meta.scanDurationMs,
        emergencyFallback: result.meta.emergencyFallback,
      }),
    )
    endScanLock(null)
    return { started: true, status: 'completed' }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(JSON.stringify({ scan: 'error', reason, error: msg }))
    endScanLock(msg)
    return { started: true, status: 'error' }
  }
}

export function kickScanOnBoot(): void {
  const cache = loadScanCache()
  if (cache && !isCacheStale(cache)) {
    console.log(
      JSON.stringify({
        scan: 'cache-hot',
        asOf: cache.asOf,
        stage1: cache.meta?.stage1Count,
        hits: cache.scanHitCount,
      }),
    )
    return
  }
  void triggerScan(cache ? 'boot-stale' : 'boot-missing')
}
