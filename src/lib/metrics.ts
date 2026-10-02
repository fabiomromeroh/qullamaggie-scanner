import type {
  CharacteristicTag,
  EarningsStatus,
  MarketRegime,
  SetupType,
  SparkPoint,
  StDirection,
  TradingIdea,
} from '../types'
import { resolvePrevClose } from './prevClose'
import { setupStageHeuristic } from './setupStage'
import { compactSurferDetail, evaluateSurfer } from './surfer'
import { compactTightDetail, evaluateTightConsolidation } from './tightConsolidation'

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
  /** Unix seconds of the print in `price` (Yahoo `regularMarketTime`). */
  regularMarketTime?: number
  /** Exchange UTC offset in seconds (Yahoo `meta.gmtoffset`). */
  gmtoffset?: number
  exchangeTimezoneName?: string
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

/** Periods passed to {@link smaClose} for idea metrics and the QQQ regime. */
export const SMA_PERIODS = { sma10: 10, sma20: 20, sma50: 50, sma200: 200 } as const

/** Session windows used by {@link computeIdeaMetrics}. */
export const BAR_WINDOWS = {
  /** Prior sessions for RVOL, ADR%, and dollar volume (excludes the latest bar). */
  rvolSessions: 20,
  adrSessions: 20,
  dolVolSessions: 20,
  /** Max high over this many sessions is the 52-week high. */
  high52Sessions: 252,
  perf1mSessions: 21,
  perf3mSessions: 63,
  perf6mSessions: 126,
  sparkSessions: 40,
} as const

/**
 * priorRunPctProxy lookbacks. The short-history fallback uses
 * `shortHistoryOffset` sessions (the 3-month-style window), not `runLookback`.
 */
export const PRIOR_RUN_PROXY = {
  runLookback: 63,
  baseLookback: 15,
  /** Need run + base + this many bars or the short-history fallback is used. */
  minExtraBars: 5,
  shortHistoryOffset: 63,
} as const

/** tightDaysProxy: narrow range vs the window average, or a close near SMA10/20. */
export const TIGHT_DAYS_PROXY = {
  lookback: 15,
  /** Return 0 when bars.length < lookback + historyExtra. */
  historyExtra: 20,
  /** A day is tight when (high−low)/close < rangeFactor × the window's mean range%. */
  rangeFactor: 0.75,
  /** Or when |close vs SMA10 or SMA20| is within this percent. */
  maProximityPct: 1.5,
} as const

/** baseLengthDaysProxy: trailing streak of narrow-range days. */
export const BASE_LENGTH_PROXY = {
  maxLookback: 40,
  /** Return 0 when fewer than this many bars exist. */
  minBars: 25,
  /** Window length is min(maxLookback, bars.length − historyReserve). */
  historyReserve: 20,
  rangeFactor: 0.75,
} as const

/** classifyEarningsProximity trading-day buckets. Weekends are skipped; holidays are not. */
export const EARNINGS_PROXIMITY = {
  /** days <= this → avoid (same calendar day is 0, next trading day is 1). */
  avoidMaxTradingDays: 1,
  /** days === this → alert. Further out, missing, or already past → clear. */
  alertTradingDays: 2,
} as const

/**
 * isAPlusHeuristic gates. "Surfer" in the soft path is loose aboveSma10 || aboveSma20.
 */
export const APLUS_CONFIG = {
  adrMin: 2.5,
  nearHighPct: 5,
  nearHighSoftPct: 10,
  rvolOrRunRvol: 1.5,
  rvolOrRunPrior: 30,
  softPathRvol: 1.2,
} as const

/**
 * kyleScoreHeuristic points. Below the 200 SMA returns `below200Score` and skips
 * the 3–5 clamp. Otherwise the score starts at `base` and is clamped to
 * [clampMin, clampMax] after rounding to 2 decimals. isAPlus lifts the score
 * to at least `aPlusFloor` before the clamp.
 */
export const KYLE_SCORE_CONFIG = {
  below200Score: 1,
  base: 3,
  aboveSma50: 0.4,
  aboveSma20: 0.3,
  aboveSma10: 0.3,
  nearHighPct: 5,
  nearHighPoints: 0.5,
  nearHighSoftPct: 10,
  nearHighSoftPoints: 0.25,
  rvolHigh: 1.5,
  rvolHighPoints: 0.3,
  rvolMid: 1.2,
  rvolMidPoints: 0.15,
  priorRunHigh: 40,
  priorRunHighPoints: 0.25,
  priorRunMid: 25,
  priorRunMidPoints: 0.1,
  adrMin: 2.5,
  adrMax: 8,
  adrPoints: 0.15,
  aPlusFloor: 4.5,
  clampMin: 3,
  clampMax: 5,
} as const

/** setupTypeHeuristic, checked in this order. */
export const SETUP_TYPE_CONFIG = {
  episodicRvol: 2.5,
  episodicDayPct: 3,
  rangeHighPct: 8,
  rangeRvol: 1.2,
} as const

/** deriveCharacteristics "near ATH" band: pctFrom52wHigh >= -this. */
export const NEAR_ATH_PCT = 5

/** computeMarketRegime thresholds on QQQ daily bars. */
export const REGIME_CONFIG = {
  minBars: 55,
  /** SMA50 slope compares the current SMA50 with SMA50 on closes dropping this many sessions. */
  slopeLookbackSessions: 5,
  upSlopeMinPct: 0.15,
  downSlopeMaxPct: -0.15,
} as const

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
  if (days <= EARNINGS_PROXIMITY.avoidMaxTradingDays) {
    return { daysToEarnings: days, earningsStatus: 'avoid' }
  }
  if (days === EARNINGS_PROXIMITY.alertTradingDays) {
    return { daysToEarnings: days, earningsStatus: 'alert' }
  }
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
  runLookback = PRIOR_RUN_PROXY.runLookback,
  baseLookback = PRIOR_RUN_PROXY.baseLookback,
): number {
  if (bars.length < runLookback + baseLookback + PRIOR_RUN_PROXY.minExtraBars) {
    // Fallback: 3M perf-style when history is short
    const last = bars[bars.length - 1]!
    const older = bars[Math.max(0, bars.length - 1 - PRIOR_RUN_PROXY.shortHistoryOffset)]!
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
export function tightDaysProxy(bars: DailyBar[], lookback = TIGHT_DAYS_PROXY.lookback): number {
  if (bars.length < lookback + TIGHT_DAYS_PROXY.historyExtra) return 0
  const window = bars.slice(-lookback)
  const ranges = window.map((b) => (b.c > 0 ? ((b.h - b.l) / b.c) * 100 : 0))
  const meanRange = avg(ranges)
  const threshold = meanRange * TIGHT_DAYS_PROXY.rangeFactor
  const closesAll = bars.map((b) => b.c)
  let count = 0
  for (let i = 0; i < window.length; i++) {
    const globalIdx = bars.length - lookback + i
    const b = window[i]!
    const rangePct = ranges[i]!
    const sma10 = smaClose(closesAll.slice(0, globalIdx + 1), 10)
    const sma20 = smaClose(closesAll.slice(0, globalIdx + 1), 20)
    const nearMa =
      (sma10 != null && Math.abs(pctChange(sma10, b.c)) <= TIGHT_DAYS_PROXY.maProximityPct) ||
      (sma20 != null && Math.abs(pctChange(sma20, b.c)) <= TIGHT_DAYS_PROXY.maProximityPct)
    if (rangePct < threshold || nearMa) count += 1
  }
  return count
}

/**
 * Base-length / Over Days proxy: consecutive trailing days (from most recent)
 * that pass the tight heuristic, looking back up to `maxLookback`.
 */
export function baseLengthDaysProxy(
  bars: DailyBar[],
  maxLookback = BASE_LENGTH_PROXY.maxLookback,
): number {
  if (bars.length < BASE_LENGTH_PROXY.minBars) return 0
  const n = Math.min(maxLookback, bars.length - BASE_LENGTH_PROXY.historyReserve)
  const window = bars.slice(-n)
  const ranges = window.map((b) => (b.c > 0 ? ((b.h - b.l) / b.c) * 100 : 0))
  const meanRange = avg(ranges)
  const threshold = meanRange * BASE_LENGTH_PROXY.rangeFactor
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
 *
 * "Surfer" here is the loose price-above-SMA10/20 flags (`aboveSma10` / `aboveSma20`),
 * not the strict ride-the-MA booleans (`surfer10` / `surfer20`).
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
  if (m.adrPct < APLUS_CONFIG.adrMin) return false
  const nearHigh = m.pctFrom52wHigh >= -APLUS_CONFIG.nearHighPct
  const nearHighSoft = m.pctFrom52wHigh >= -APLUS_CONFIG.nearHighSoftPct
  const volumeOrRun = m.rvol >= APLUS_CONFIG.rvolOrRunRvol || m.priorRunPct >= APLUS_CONFIG.rvolOrRunPrior
  const surfer = m.aboveSma10 || m.aboveSma20
  if (nearHigh && volumeOrRun) return true
  if (nearHighSoft && volumeOrRun && surfer && m.rvol >= APLUS_CONFIG.softPathRvol) return true
  return false
}

/**
 * Kyle-style quality score 3–5 (heuristic, not official Rating).
 * Starts at 3 when above 200; +points for 50, surfers, near ATH, RVOL/run, ADR.
 * Surfer points use loose `aboveSma10` / `aboveSma20`, not strict `surfer10` / `surfer20`.
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
  const k = KYLE_SCORE_CONFIG
  if (!m.aboveSma200) return k.below200Score // should be excluded from setups
  // `base` is a numeric literal under `as const`; the running total is a number.
  let score: number = k.base
  if (m.aboveSma50) score += k.aboveSma50
  if (m.aboveSma20) score += k.aboveSma20
  if (m.aboveSma10) score += k.aboveSma10
  if (m.pctFrom52wHigh >= -k.nearHighPct) score += k.nearHighPoints
  else if (m.pctFrom52wHigh >= -k.nearHighSoftPct) score += k.nearHighSoftPoints
  if (m.rvol >= k.rvolHigh) score += k.rvolHighPoints
  else if (m.rvol >= k.rvolMid) score += k.rvolMidPoints
  if (m.priorRunPct >= k.priorRunHigh) score += k.priorRunHighPoints
  else if (m.priorRunPct >= k.priorRunMid) score += k.priorRunMidPoints
  if (m.adrPct >= k.adrMin && m.adrPct <= k.adrMax) score += k.adrPoints
  if (m.isAPlus) score = Math.max(score, k.aPlusFloor)
  return Math.min(k.clampMax, Math.max(k.clampMin, round2(score)))
}

/** Simple setup label heuristic from RVOL / distance-from-highs. */
export function setupTypeHeuristic(m: {
  rvol: number
  pctFrom52wHigh: number
  dayPct: number
}): SetupType {
  if (m.rvol >= SETUP_TYPE_CONFIG.episodicRvol && m.dayPct >= SETUP_TYPE_CONFIG.episodicDayPct) {
    return 'Episodic Pivot'
  }
  if (m.pctFrom52wHigh >= -SETUP_TYPE_CONFIG.rangeHighPct && m.rvol >= SETUP_TYPE_CONFIG.rangeRvol) {
    return 'Range Breakout'
  }
  return 'Continuation'
}

/**
 * Characteristics badges. Earnings/GAP only if catalyst text mentions them —
 * never invent.
 */
export function deriveCharacteristics(m: {
  aboveSma200: boolean
  pctFrom52wHigh: number
  catalyst: string | null
  /** Strict ride-the-MA flags. Tags are not awarded from loose aboveSma*. */
  surfer10: boolean
  surfer20: boolean
  surfer50: boolean
}): CharacteristicTag[] {
  const tags: CharacteristicTag[] = []
  if (!m.aboveSma200) tags.push('Below 200MA')
  if (m.surfer10) tags.push('10MA Surfer')
  if (m.surfer20) tags.push('20MA Surfer')
  if (m.surfer50) tags.push('50MA Surfer')
  if (m.pctFrom52wHigh >= -NEAR_ATH_PCT) tags.push('near ATH')
  const cat = (m.catalyst ?? '').toLowerCase()
  if (cat && /\bearnings?\b|\beps\b/.test(cat)) tags.push('Earnings')
  if (cat && /\bgap\b|\bgapped?\b/.test(cat)) tags.push('GAP')
  return tags
}

/**
 * QQQ regime: 10>20 from SMA10 vs SMA20; ST direction from price vs SMA50 + SMA50 slope.
 */
export function computeMarketRegime(bars: DailyBar[]): MarketRegime | null {
  if (bars.length < REGIME_CONFIG.minBars) return null
  const sorted = [...bars].sort((a, b) => a.t - b.t)
  const closes = sorted.map((b) => b.c)
  const price = closes[closes.length - 1]!
  const sma10 = smaClose(closes, SMA_PERIODS.sma10)
  const sma20 = smaClose(closes, SMA_PERIODS.sma20)
  const sma50 = smaClose(closes, SMA_PERIODS.sma50)
  if (sma10 == null || sma20 == null || sma50 == null) return null

  const qqq10gt20 = sma10 > sma20
  const sma50Prev = smaClose(closes.slice(0, -REGIME_CONFIG.slopeLookbackSessions), 50)
  const slopePct = sma50Prev != null ? pctChange(sma50Prev, sma50) : 0
  const vs50 = pctChange(sma50, price)

  let stDirection: StDirection
  if (price > sma50 && slopePct >= REGIME_CONFIG.upSlopeMinPct) stDirection = 'Uptrend'
  else if (price < sma50 && slopePct <= REGIME_CONFIG.downSlopeMaxPct) stDirection = 'Downtrend'
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
  // Re-resolve so a provider previous close that is really a pre-range
  // chartPreviousClose cannot survive into dayPct.
  const prevClose =
    resolvePrevClose({
      bars,
      price,
      metaPreviousClose: snap.prevClose,
      range: '1y',
      regularMarketTime: snap.regularMarketTime,
      gmtoffset: snap.gmtoffset,
      exchangeTimezoneName: snap.exchangeTimezoneName,
    }) ?? prev.c
  const dayPct = pctChange(prevClose, price)

  const lookbackVol = bars.slice(-(BAR_WINDOWS.rvolSessions + 1), -1)
  const avgVol20 = avg(lookbackVol.map((b) => b.v))
  const rvol = avgVol20 > 0 ? last.v / avgVol20 : 0

  const lookbackAdr = bars.slice(-(BAR_WINDOWS.adrSessions + 1), -1)
  const adrPct = avg(
    lookbackAdr.map((b) => (b.c > 0 ? ((b.h - b.l) / b.c) * 100 : 0)),
  )

  const yearBars = bars.slice(-BAR_WINDOWS.high52Sessions)
  const high52 = Math.max(...yearBars.map((b) => b.h))
  const pctFrom52wHigh = high52 > 0 ? ((price / high52) - 1) * 100 : 0

  const closes = bars.map((b) => b.c)
  const sma200 = smaClose(closes, SMA_PERIODS.sma200)
  const sma50 = smaClose(closes, SMA_PERIODS.sma50)
  const sma20 = smaClose(closes, SMA_PERIODS.sma20)
  const sma10 = smaClose(closes, SMA_PERIODS.sma10)
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
  const perf1M = pctChange(closeAt(BAR_WINDOWS.perf1mSessions), price)
  const perf3M = pctChange(closeAt(BAR_WINDOWS.perf3mSessions), price)
  const perf6M = pctChange(closeAt(BAR_WINDOWS.perf6mSessions), price)

  const lookbackDol = bars.slice(-(BAR_WINDOWS.dolVolSessions + 1), -1)
  const avgDollarVol = avg(lookbackDol.map((b) => b.c * b.v))
  const priorRunPct = priorRunPctProxy(bars)
  const tightDays = tightDaysProxy(bars)
  const baseLengthDays = baseLengthDaysProxy(bars)
  const surferEval = evaluateSurfer(bars, undefined, adrPct, price)
  const surfer10 = surferEval.sma10.ok
  const surfer20 = surferEval.sma20.ok
  const surfer50 = surferEval.sma50.ok
  const surferDetail = compactSurferDetail(surferEval)
  const tightEval = evaluateTightConsolidation(bars, price)
  const tightConsolidation = tightEval.ok
  const tightDetail = compactTightDetail(tightEval)

  const sparkSrc = bars.slice(-BAR_WINDOWS.sparkSessions)
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
    tightConsolidation,
  })
  // Below 200 should already be gated by callers; keep a fallback stage for typing.
  const stage = setupStage ?? 'watching'
  const characteristics = deriveCharacteristics({
    aboveSma200,
    pctFrom52wHigh: metricsCore.pctFrom52wHigh,
    catalyst,
    surfer10,
    surfer20,
    surfer50,
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
    notes: `Live metrics via ${snap.provider}. Catalyst is filled after the scan from news inside 48 hours. Kyle-style proxies from bars only.`,
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
    surfer10,
    surfer20,
    surfer50,
    surferDetail,
    tightConsolidation,
    tightDetail,
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
