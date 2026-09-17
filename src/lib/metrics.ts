import type {
  CharacteristicTag,
  EarningsStatus,
  MarketRegime,
  SetupType,
  SparkPoint,
  StDirection,
  TradingIdea,
} from '../types'
import { setupStageHeuristic } from './setupStage'

export interface DailyBar {
  /** Unix seconds */
  t: number
  o: number
  h: number
  l: number
  c: number
  v: number
}

export interface SymbolBars {
  symbol: string
  name?: string
  bars: DailyBar[]
  /** Preferred last price if quote differs from last bar close */
  price?: number
  prevClose?: number
  provider: string
}

function avg(nums: number[]): number {
  if (!nums.length) return 0
  return nums.reduce((a, b) => a + b, 0) / nums.length
}

function pctChange(from: number, to: number): number {
  if (!from || !Number.isFinite(from)) return 0
  return ((to - from) / from) * 100
}

function barDate(t: number): string {
  return new Date(t * 1000).toISOString().slice(0, 10)
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

/** True if local calendar day is Sat/Sun. */
export function isWeekend(d: Date): boolean {
  const day = d.getUTCDay()
  return day === 0 || day === 6
}

/** Advance a UTC date by one calendar day (mutates copy). */
function addUtcDays(d: Date, n: number): Date {
  const x = new Date(d.getTime())
  x.setUTCDate(x.getUTCDate() + n)
  return x
}

/** Count trading days from `from` (inclusive of from if trading) to `to` exclusive of after-to. */
export function tradingDaysUntil(fromIsoDate: string, toIsoDate: string): number {
  const from = new Date(`${fromIsoDate}T12:00:00Z`)
  const to = new Date(`${toIsoDate}T12:00:00Z`)
  if (to < from) return -1
  let count = 0
  let cur = new Date(from.getTime())
  // Same calendar day → 0 trading days out
  if (fromIsoDate === toIsoDate) return 0
  cur = addUtcDays(cur, 1)
  while (cur <= to) {
    if (!isWeekend(cur)) count += 1
    if (cur.toISOString().slice(0, 10) === toIsoDate) break
    cur = addUtcDays(cur, 1)
    if (count > 400) break
  }
  return count
}

/**
 * Classify earnings proximity.
 * - avoid: same day or next trading day (≤1 trading day)
 * - alert: about 2 trading days out
 * - clear: further / unknown
 */
export function classifyEarningsProximity(
  earningsDate: string | null,
  todayIso?: string,
): { daysToEarnings: number | null; earningsStatus: EarningsStatus } {
  if (!earningsDate) {
    return { daysToEarnings: null, earningsStatus: 'clear' }
  }
  const today =
    todayIso ??
    new Date().toISOString().slice(0, 10)
  const days = tradingDaysUntil(today, earningsDate)
  if (days < 0) {
    // Past date — treat as clear (already reported)
    return { daysToEarnings: null, earningsStatus: 'clear' }
  }
  if (days <= 1) return { daysToEarnings: days, earningsStatus: 'avoid' }
  if (days === 2) return { daysToEarnings: days, earningsStatus: 'alert' }
  return { daysToEarnings: days, earningsStatus: 'clear' }
}

/** Simple moving average of the last `period` closes, or null if insufficient history. */
export function smaClose(closes: number[], period: number): number | null {
  if (closes.length < period || period <= 0) return null
  return avg(closes.slice(-period))
}

/**
 * Prior-run / Inc% BBO proxy.
 * Lookback: find the lowest low in bars[-(baseLookback+runLookback) .. -baseLookback]
 * (default run=63, base=15), then measure % from that low into the high of the
 * recent base window. Clear documented proxy — not Kyle's exact Inc%.
 */
export function priorRunPctProxy(
  bars: DailyBar[],
  runLookback = 63,
  baseLookback = 15,
): number {
  if (bars.length < runLookback + baseLookback + 5) {
    // Fallback: 3M perf-style when history is short
    const last = bars[bars.length - 1]!
    const older = bars[Math.max(0, bars.length - 1 - 63)]!
    return round2(pctChange(older.l, last.h))
  }
  const baseStart = bars.length - baseLookback
  const runStart = Math.max(0, baseStart - runLookback)
  const runBars = bars.slice(runStart, baseStart)
  const baseBars = bars.slice(baseStart)
  const low = Math.min(...runBars.map((b) => b.l))
  const baseHigh = Math.max(...baseBars.map((b) => b.h))
  return round2(pctChange(low, baseHigh))
}

/**
 * Tight-days proxy: in the last `lookback` sessions, count days where
 * (high−low)/close < 0.75 × average ADR of that window, OR close within 1.5% of SMA10 or SMA20.
 */
export function tightDaysProxy(bars: DailyBar[], lookback = 15): number {
  if (bars.length < lookback + 20) return 0
  const window = bars.slice(-lookback)
  const ranges = window.map((b) => (b.c > 0 ? ((b.h - b.l) / b.c) * 100 : 0))
  const meanRange = avg(ranges)
  const threshold = meanRange * 0.75
  const closesAll = bars.map((b) => b.c)
  let count = 0
  for (let i = 0; i < window.length; i++) {
    const globalIdx = bars.length - lookback + i
    const b = window[i]!
    const rangePct = ranges[i]!
    const sma10 = smaClose(closesAll.slice(0, globalIdx + 1), 10)
    const sma20 = smaClose(closesAll.slice(0, globalIdx + 1), 20)
    const nearMa =
      (sma10 != null && Math.abs(pctChange(sma10, b.c)) <= 1.5) ||
      (sma20 != null && Math.abs(pctChange(sma20, b.c)) <= 1.5)
    if (rangePct < threshold || nearMa) count += 1
  }
  return count
}

/**
 * Base-length / Over Days proxy: consecutive trailing days (from most recent)
 * that pass the tight heuristic, looking back up to `maxLookback`.
 */
export function baseLengthDaysProxy(bars: DailyBar[], maxLookback = 40): number {
  if (bars.length < 25) return 0
  const n = Math.min(maxLookback, bars.length - 20)
  const window = bars.slice(-n)
  const ranges = window.map((b) => (b.c > 0 ? ((b.h - b.l) / b.c) * 100 : 0))
  const meanRange = avg(ranges)
  const threshold = meanRange * 0.75
  let streak = 0
  for (let i = window.length - 1; i >= 0; i--) {
    if (ranges[i]! < threshold) streak += 1
    else break
  }
  return streak
}

/**
 * A+ heuristic (tightened Kyle-style): above 200+50 SMA, near highs (≤5% or ≤10% with surfer),
 * decent ADR, elevated RVOL or prior run, preferably MA surfer.
 * Heuristic only — not a trading signal / not Kyle's official Rating.
 */
export function isAPlusHeuristic(m: {
  pctFrom52wHigh: number
  rvol: number
  adrPct: number
  aboveSma200: boolean
  aboveSma50: boolean
  aboveSma10: boolean
  aboveSma20: boolean
  priorRunPct: number
  /** Hard fail: earnings same day / next trading day cannot be tradeable A+. */
  earningsStatus?: EarningsStatus
}): boolean {
  if (m.earningsStatus === 'avoid') return false
  if (!m.aboveSma200 || !m.aboveSma50) return false
  if (m.adrPct < 2.5) return false
  const nearHigh = m.pctFrom52wHigh >= -5
  const nearHighSoft = m.pctFrom52wHigh >= -10
  const volumeOrRun = m.rvol >= 1.5 || m.priorRunPct >= 30
  const surfer = m.aboveSma10 || m.aboveSma20
  if (nearHigh && volumeOrRun) return true
  if (nearHighSoft && volumeOrRun && surfer && m.rvol >= 1.2) return true
  return false
}

/**
 * Kyle-style quality score 3–5 (heuristic, not official Rating).
 * Starts at 3 when above 200; +points for 50, surfers, near ATH, RVOL/run, ADR.
 */
export function kyleScoreHeuristic(m: {
  aboveSma200: boolean
  aboveSma50: boolean
  aboveSma10: boolean
  aboveSma20: boolean
  pctFrom52wHigh: number
  rvol: number
  adrPct: number
  priorRunPct: number
  isAPlus: boolean
}): number {
  if (!m.aboveSma200) return 1 // should be excluded from setups
  let score = 3
  if (m.aboveSma50) score += 0.4
  if (m.aboveSma20) score += 0.3
  if (m.aboveSma10) score += 0.3
  if (m.pctFrom52wHigh >= -5) score += 0.5
  else if (m.pctFrom52wHigh >= -10) score += 0.25
  if (m.rvol >= 1.5) score += 0.3
  else if (m.rvol >= 1.2) score += 0.15
  if (m.priorRunPct >= 40) score += 0.25
  else if (m.priorRunPct >= 25) score += 0.1
  if (m.adrPct >= 2.5 && m.adrPct <= 8) score += 0.15
  if (m.isAPlus) score = Math.max(score, 4.5)
  return Math.min(5, Math.max(3, round2(score)))
}

/** Simple setup label heuristic from RVOL / distance-from-highs. */
export function setupTypeHeuristic(m: {
  rvol: number
  pctFrom52wHigh: number
  dayPct: number
}): SetupType {
  if (m.rvol >= 2.5 && m.dayPct >= 3) return 'Episodic Pivot'
  if (m.pctFrom52wHigh >= -8 && m.rvol >= 1.2) return 'Range Breakout'
  return 'Continuation'
}

/**
 * Characteristics badges. Earnings/GAP only if catalyst text mentions them —
 * never invent.
 */
export function deriveCharacteristics(m: {
  aboveSma10: boolean
  aboveSma20: boolean
  aboveSma50: boolean
  aboveSma200: boolean
  pctFrom52wHigh: number
  catalyst: string | null
}): CharacteristicTag[] {
  const tags: CharacteristicTag[] = []
  if (!m.aboveSma200) tags.push('Below 200MA')
  if (m.aboveSma10) tags.push('10MA Surfer')
  if (m.aboveSma20) tags.push('20MA Surfer')
  if (m.aboveSma50) tags.push('50MA Surfer')
  if (m.pctFrom52wHigh >= -5) tags.push('near ATH')
  const cat = (m.catalyst ?? '').toLowerCase()
  if (cat && /\bearnings?\b|\beps\b/.test(cat)) tags.push('Earnings')
  if (cat && /\bgap\b|\bgapped?\b/.test(cat)) tags.push('GAP')
  return tags
}

/**
 * QQQ regime: 10>20 from SMA10 vs SMA20; ST direction from price vs SMA50 + SMA50 slope.
 */
export function computeMarketRegime(bars: DailyBar[]): MarketRegime | null {
  if (bars.length < 55) return null
  const sorted = [...bars].sort((a, b) => a.t - b.t)
  const closes = sorted.map((b) => b.c)
  const price = closes[closes.length - 1]!
  const sma10 = smaClose(closes, 10)
  const sma20 = smaClose(closes, 20)
  const sma50 = smaClose(closes, 50)
  if (sma10 == null || sma20 == null || sma50 == null) return null

  const qqq10gt20 = sma10 > sma20
  const sma50Prev = smaClose(closes.slice(0, -5), 50) // ~1 week ago SMA50
  const slopePct = sma50Prev != null ? pctChange(sma50Prev, sma50) : 0
  const vs50 = pctChange(sma50, price)

  let stDirection: StDirection
  if (price > sma50 && slopePct >= 0.15) stDirection = 'Uptrend'
  else if (price < sma50 && slopePct <= -0.15) stDirection = 'Downtrend'
  else stDirection = 'Sideways'

  return {
    qqq10gt20,
    stDirection,
    detail: `QQQ vs SMA50 ${round2(vs50)}% · SMA50 slope(5d) ${round2(slopePct)}% · SMA10 ${round2(sma10)} / SMA20 ${round2(sma20)}`,
  }
}

/**
 * Compute idea metrics from daily bars.
 * Requires ≥200 daily bars so the 200-SMA trend gate can be evaluated.
 * Names below the 200-SMA are still returned (with aboveSma200=false) so callers
 * can hard-exclude them; they must not be shown as valid setups.
 */
export function computeIdeaMetrics(
  entry: { ticker: string; name: string; groupId: string; groupName: string },
  snap: SymbolBars,
  earnings?: { earningsDate: string | null } | null,
): TradingIdea | null {
  const bars = [...snap.bars].sort((a, b) => a.t - b.t)
  // Need 200 sessions for SMA200 (Qullamaggie hard trend gate).
  if (bars.length < 200) return null

  const last = bars[bars.length - 1]!
  const prev = bars[bars.length - 2]!
  const price = snap.price ?? last.c
  const prevClose = snap.prevClose ?? prev.c
  const dayPct = pctChange(prevClose, price)

  const lookback20 = bars.slice(-21, -1)
  const avgVol20 = avg(lookback20.map((b) => b.v))
  const rvol = avgVol20 > 0 ? last.v / avgVol20 : 0

  const adrPct = avg(
    lookback20.map((b) => (b.c > 0 ? ((b.h - b.l) / b.c) * 100 : 0)),
  )

  const yearBars = bars.slice(-252)
  const high52 = Math.max(...yearBars.map((b) => b.h))
  const pctFrom52wHigh = high52 > 0 ? ((price / high52) - 1) * 100 : 0

  const closes = bars.map((b) => b.c)
  const sma200 = smaClose(closes, 200)
  const sma50 = smaClose(closes, 50)
  const sma20 = smaClose(closes, 20)
  const sma10 = smaClose(closes, 10)
  if (sma200 == null || sma50 == null || sma20 == null || sma10 == null) return null

  const aboveSma200 = price > sma200
  const aboveSma50 = price > sma50
  const aboveSma20 = price > sma20
  const aboveSma10 = price > sma10
  const pctAboveSma200 = pctChange(sma200, price)
  const pctAboveSma50 = pctChange(sma50, price)

  const closeAt = (offset: number): number => {
    const idx = bars.length - 1 - offset
    return bars[Math.max(0, idx)]!.c
  }
  const perf1M = pctChange(closeAt(21), price)
  const perf3M = pctChange(closeAt(63), price)
  const perf6M = pctChange(closeAt(126), price)

  const avgDollarVol = avg(lookback20.map((b) => b.c * b.v))
  const priorRunPct = priorRunPctProxy(bars)
  const tightDays = tightDaysProxy(bars)
  const baseLengthDays = baseLengthDaysProxy(bars)

  const sparkSrc = bars.slice(-40)
  const sparkline: SparkPoint[] = sparkSrc.map((b) => ({
    d: barDate(b.t),
    c: Math.round(b.c * 100) / 100,
  }))

  const catalyst: string | null = null

  const earningsDate = earnings?.earningsDate ?? null
  const { daysToEarnings, earningsStatus } = classifyEarningsProximity(earningsDate)

  const metricsCore = {
    pctFrom52wHigh: round2(pctFrom52wHigh),
    rvol: round2(rvol),
    adrPct: round2(adrPct),
    dayPct: round2(dayPct),
    aboveSma200,
    aboveSma50,
    aboveSma10,
    aboveSma20,
    priorRunPct,
    earningsStatus,
  }

  const isAPlus = isAPlusHeuristic(metricsCore)
  const setupType = setupTypeHeuristic(metricsCore)
  const kyleScore = kyleScoreHeuristic({ ...metricsCore, isAPlus })
  const setupStage = setupStageHeuristic({
    aboveSma200,
    aboveSma10,
    aboveSma20,
    pctFrom52wHigh: metricsCore.pctFrom52wHigh,
    tightDays,
    rvol: metricsCore.rvol,
    dayPct: metricsCore.dayPct,
    priorRunPct,
  })
  // Below 200 should already be gated by callers; keep a fallback stage for typing.
  const stage = setupStage ?? 'watching'
  const characteristics = deriveCharacteristics({
    aboveSma10,
    aboveSma20,
    aboveSma50,
    aboveSma200,
    pctFrom52wHigh: metricsCore.pctFrom52wHigh,
    catalyst,
  })

  return {
    ticker: entry.ticker,
    name: snap.name?.trim() || entry.name,
    groupId: entry.groupId,
    groupName: entry.groupName,
    price: round2(price),
    dayPct: metricsCore.dayPct,
    rvol: metricsCore.rvol,
    adrPct: metricsCore.adrPct,
    pctFrom52wHigh: metricsCore.pctFrom52wHigh,
    perf1M: round2(perf1M),
    perf3M: round2(perf3M),
    perf6M: round2(perf6M),
    avgDollarVol: Math.round(avgDollarVol),
    sma200: round2(sma200),
    sma50: round2(sma50),
    aboveSma200,
    aboveSma50,
    pctAboveSma200: round2(pctAboveSma200),
    pctAboveSma50: round2(pctAboveSma50),
    setupType,
    catalyst,
    isAPlus,
    notes: `Live metrics via ${snap.provider}. Catalyst left blank for brief fill-in. Kyle-style proxies from bars only.`,
    whyQualifies:
      earningsStatus === 'avoid'
        ? 'Earnings same day or next trading day — AVOID entry (hard fail). Not tradeable A+ regardless of other metrics.'
        : isAPlus
          ? 'Heuristic A+: above 200 & 50 SMA, near highs, ADR≥2.5, elevated RVOL or prior run, preferably MA surfer; earnings clear/alert (not a signal / not Kyle Rating).'
          : aboveSma200
            ? 'On watchlist above 200 SMA; does not meet heuristic A+ thresholds today.'
            : 'Below daily 200 SMA — fails Qullamaggie hard trend gate (not a valid setup). Tag: Below 200MA.',
    suggestedEntry: null,
    suggestedStop: null,
    sparkline,
    sma10: round2(sma10),
    sma20: round2(sma20),
    aboveSma10,
    aboveSma20,
    priorRunPct,
    tightDays,
    baseLengthDays,
    dollarVolume: Math.round(avgDollarVol),
    kyleScore,
    characteristics,
    setupStage: stage,
    earningsDate,
    daysToEarnings,
    earningsStatus,
  }
}

/** Re-apply earnings fields and recompute A+ (after async calendar fetch). */
export function applyEarningsToIdea(
  idea: TradingIdea,
  earningsDate: string | null,
): TradingIdea {
  const { daysToEarnings, earningsStatus } = classifyEarningsProximity(earningsDate)
  const isAPlus = isAPlusHeuristic({
    pctFrom52wHigh: idea.pctFrom52wHigh,
    rvol: idea.rvol,
    adrPct: idea.adrPct,
    aboveSma200: idea.aboveSma200,
    aboveSma50: idea.aboveSma50,
    aboveSma10: idea.aboveSma10,
    aboveSma20: idea.aboveSma20,
    priorRunPct: idea.priorRunPct,
    earningsStatus,
  })
  const kyleScore = kyleScoreHeuristic({
    aboveSma200: idea.aboveSma200,
    aboveSma50: idea.aboveSma50,
    aboveSma10: idea.aboveSma10,
    aboveSma20: idea.aboveSma20,
    pctFrom52wHigh: idea.pctFrom52wHigh,
    rvol: idea.rvol,
    adrPct: idea.adrPct,
    priorRunPct: idea.priorRunPct,
    isAPlus,
  })
  let whyQualifies = idea.whyQualifies
  if (earningsStatus === 'avoid') {
    whyQualifies =
      'Earnings same day or next trading day — AVOID entry (hard fail). Not tradeable A+ regardless of other metrics.'
  } else if (isAPlus && !idea.isAPlus) {
    whyQualifies =
      'Heuristic A+: above 200 & 50 SMA, near highs, ADR≥2.5, elevated RVOL or prior run, preferably MA surfer; earnings clear/alert (not a signal / not Kyle Rating).'
  } else if (!isAPlus && idea.isAPlus) {
    whyQualifies = 'On watchlist above 200 SMA; does not meet heuristic A+ thresholds today.'
  }
  return {
    ...idea,
    earningsDate,
    daysToEarnings,
    earningsStatus,
    isAPlus,
    kyleScore,
    whyQualifies,
  }
}
