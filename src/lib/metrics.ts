import type {
  CharacteristicTag,
  EarningsStatus,
  MarketRegime,
  RangeBreakoutDetail,
  SetupType,
  SparkPoint,
  StDirection,
  TradingIdea,
} from '../types'
import { extensionAdrFrom50, roundExtensionAdr50 } from './extensionAdr'
import { resolvePrevClose } from './prevClose'
import { evaluateRangeBase } from './rangeBase'
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
 * isA gates. The previous A+ hard gate required price above the 200-day SMA
 * and above the 50-day SMA. Those booleans stay on isA (they were not numeric
 * fields). A price equal to the SMA is not above. Catalyst is not required.
 *
 * Constructive path (any one): setupStage coiled or triggering, OR
 * tightConsolidation, OR rangeBase.ok. Episodic Pivot by itself is not a path.
 * Earnings `avoid` fails A, and therefore fails A+ and A++.
 *
 * On top of those gates, isA also requires setupType === 'Range Breakout'
 * and tightConsolidation === true (the existing strict tight-consolidation
 * boolean). A name can still need the constructive path; tight is required
 * even when coiled, triggering, or a range base already supplies that path.
 * A+ requires isA, so A+ inherits both. A++ requires A+ plus a long base
 * ({@link LONG_BASE_MIN_SESSIONS}).
 */
export const A_CONFIG = {
  /** ADR% floor. Equality passes. */
  adrMin: 2.5,
  /**
   * Known extensionAdr50 strictly above this fails isA.
   * Null passes. Equality passes. Same comparison as the Max Ext50 filter
   * (`extensionAdr50 > T` is excluded). The normal-scan default T is this 5.
   */
  ext50MaxAdr: 5,
} as const

/**
 * isAPlus gates on top of isA. Near-ATH uses {@link NEAR_ATH_MAX_PCT}.
 *
 * baseQuality = clamp(log1p(days / monthSessions), 0, baseQualityCap).
 * days = max(baseLengthDays, range-base lengthSessions). lengthSessions is 0
 * when no structural range base was found, so a failed detection does not
 * grant a year of credit. A month (21 sessions) scores log1p(1) ≈ 0.69, which
 * is under baseQualityMin. About 37 sessions clears 1. A quarter (63) scores
 * about 1.39. A year (252) scores log1p(12) ≈ 2.56 and is capped at 2.
 * Month-scale bases score lower than multi-month and year bases.
 *
 * The range-base score is an alternate path: rangeBaseScore >= rangeBaseScoreMin.
 */
export const APLUS_CONFIG = {
  monthSessions: 21,
  baseQualityCap: 2,
  baseQualityMin: 1,
  rangeBaseScoreMin: 0.85,
} as const

/**
 * A++ base length. About one quarter of sessions (252 / 4 = 63), longer than
 * a normal month-scale base. isAPlusPlus requires isAPlus and
 * max(baseLengthDays, range-base lengthSessions) >= this. Equality passes.
 * 62 fails. A++ uses the same kyleScore floor as A+ ({@link KYLE_SCORE_CONFIG.aPlusFloor});
 * it does not add another bump.
 */
export const LONG_BASE_MIN_SESSIONS = 63

/**
 * kyleScoreHeuristic points. Below the 200 SMA returns `below200Score` and skips
 * the 3–5 clamp. Otherwise the score starts at `base` and is clamped to
 * [clampMin, clampMax] after rounding to 2 decimals. isAPlus lifts the score
 * to at least `aPlusFloor` before the clamp. A++ is isAPlus, so it gets that
 * same floor and no further lift. isA adds `aBump` and does not receive that floor.
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
  /**
   * Added when isA is true and isAPlus is false. Applied before the clamp.
   * If the raw score is still under aPlusFloor, the bump cannot cross that
   * floor (it stops 0.01 below). A raw score already at the floor can still rise.
   */
  aBump: 0.15,
  clampMin: 3,
  clampMax: 5,
} as const

/** Episodic Pivot gate. setupTypeHeuristic checks this before Range Breakout. */
export const SETUP_TYPE_CONFIG = {
  episodicRvol: 2.5,
  episodicDayPct: 3,
} as const

/**
 * Range Breakout gates. All five are required. Episodic Pivot still wins when
 * its own gate hits, even if these pass. priorLegMinPct reads idea.priorRunPct
 * (priorRunPctProxy). Kyle score and the coiled stage keep using that same number.
 * The A and A+ flags do not.
 */
export interface RangeBreakoutConfig {
  /** ADR% must be at least this. Compared on the rounded idea.adrPct. */
  adrMinPct: number
  /** priorRunPct must be at least this. */
  priorLegMinPct: number
  /** recentRangePct / adrPct must be <= this. Equality passes. Null fails. */
  rangeOverAdrMax: number
  /** Sessions in recentRangePct, including the latest bar. */
  recentRangeSessions: number
  /**
   * Higher-low base. Equal to PRIOR_RUN_PROXY.baseLookback so the prior leg
   * and the higher-low window share the same 15 sessions.
   */
  higherLowsBaseSessions: number
  /**
   * Half-window floor rise. 0 would mean strictly higher. 0.1 drops float
   * noise under 0.1%. The test is strict: newerMin > olderMin × (1 + this/100).
   */
  higherLowsMinRisePct: number
  /** A pivot low is strictly lower than this many bars on each side. */
  pivotRadius: number
  /** Last this many confirmed pivots must each be strictly higher. */
  higherLowsMinPivots: number
  /**
   * Sessions before the base that may still hold a confirmed pivot.
   * Matches pivotRadius so a low on the first base bar can confirm.
   */
  higherLowsPivotPad: number
}

export const RANGE_BREAKOUT_CONFIG: RangeBreakoutConfig = {
  adrMinPct: 3,
  priorLegMinPct: 30,
  rangeOverAdrMax: 3,
  recentRangeSessions: 5,
  higherLowsBaseSessions: PRIOR_RUN_PROXY.baseLookback,
  higherLowsMinRisePct: 0.1,
  pivotRadius: 2,
  higherLowsMinPivots: 2,
  higherLowsPivotPad: 2,
}

/** deriveCharacteristics "near ATH" band: pctFrom52wHigh >= -this. */
export const NEAR_ATH_PCT = 5

/**
 * A+ near-high gate, and the same band as the "near ATH" tag.
 * pctFrom52wHigh >= -NEAR_ATH_MAX_PCT. Alias of {@link NEAR_ATH_PCT}.
 */
export const NEAR_ATH_MAX_PCT = NEAR_ATH_PCT

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
 * Mean of (high − low) / close × 100 over the prior `sessions` bars,
 * excluding the latest bar. A non-positive close contributes 0.
 * Empty lookback yields 0 (same as the previous inline average).
 */
export function adrPctFromBars(
  bars: DailyBar[],
  sessions = BAR_WINDOWS.adrSessions,
): number {
  const lookback = bars.slice(-(sessions + 1), -1)
  return avg(lookback.map((b) => (b.c > 0 ? ((b.h - b.l) / b.c) * 100 : 0)))
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

export interface SetupQualityInput {
  aboveSma200: boolean
  aboveSma50: boolean
  adrPct: number
  extensionAdr50?: number | null
  setupStage: 'watching' | 'coiled' | 'triggering'
  tightConsolidation: boolean
  /** True only when evaluateRangeBase returned ok. */
  rangeBaseOk: boolean
  earningsStatus?: EarningsStatus
  pctFrom52wHigh: number
  hasCatalyst?: boolean
  catalystStatus?: 'checked' | 'pending' | 'unchecked' | 'error'
  baseLengthDays: number
  /**
   * Sessions of a structural range base. 0 when none was found.
   * Counted toward base quality even when recent compression failed `ok`.
   */
  rangeBaseLengthSessions: number
  rangeBaseScore: number | null
  /** A requires this to be Range Breakout. Other labels fail even when the other gates pass. */
  setupType: SetupType
}

/** Null and non-finite extensions pass. A known value fails only when it is above the cap. */
export function extensionPassesAGate(extensionAdr50: number | null | undefined): boolean {
  if (typeof extensionAdr50 !== 'number' || !Number.isFinite(extensionAdr50)) return true
  return extensionAdr50 <= A_CONFIG.ext50MaxAdr
}

/** Coiled, triggering, strict tight consolidation, or a passing range base. No catalyst. */
export function constructiveSetup(
  m: Pick<SetupQualityInput, 'setupStage' | 'tightConsolidation' | 'rangeBaseOk'>,
): boolean {
  return (
    m.setupStage === 'coiled' ||
    m.setupStage === 'triggering' ||
    m.tightConsolidation === true ||
    m.rangeBaseOk === true
  )
}

/**
 * log1p(days / monthSessions), capped. Month-scale scores lower than a
 * quarter or a year. See {@link APLUS_CONFIG}.
 */
export function baseQualityScore(
  days: number,
  config: typeof APLUS_CONFIG = APLUS_CONFIG,
): number {
  if (!(days > 0) || !(config.monthSessions > 0)) return 0
  const raw = Math.log1p(days / config.monthSessions)
  if (!Number.isFinite(raw) || raw <= 0) return 0
  return Math.min(config.baseQualityCap, raw)
}

/** Days that feed base quality: the tight-streak proxy, or a structural range-base length. */
export function baseQualityDays(
  m: Pick<SetupQualityInput, 'baseLengthDays' | 'rangeBaseLengthSessions'>,
): number {
  const streak = typeof m.baseLengthDays === 'number' && Number.isFinite(m.baseLengthDays) ? m.baseLengthDays : 0
  const range =
    typeof m.rangeBaseLengthSessions === 'number' && Number.isFinite(m.rangeBaseLengthSessions)
      ? m.rangeBaseLengthSessions
      : 0
  return Math.max(0, streak, range)
}

/**
 * Constructive A. Above the 200-day and 50-day SMAs, ADR at the floor,
 * extension within the cap (or unknown), and one constructive path.
 * Also requires a Range Breakout label and strict tight consolidation.
 * Earnings avoid fails. Catalyst is not read.
 */
export function isAHeuristic(m: SetupQualityInput): boolean {
  if (m.earningsStatus === 'avoid') return false
  if (!m.aboveSma200 || !m.aboveSma50) return false
  if (!(m.adrPct >= A_CONFIG.adrMin)) return false
  if (!extensionPassesAGate(m.extensionAdr50)) return false
  if (!constructiveSetup(m)) return false
  if (m.setupType !== 'Range Breakout') return false
  if (m.tightConsolidation !== true) return false
  return true
}

/**
 * Checked catalyst only. Pending and unchecked are false even if the boolean
 * was left true. A missing boolean is false. The display string is not used.
 */
export function catalystCountsForAPlus(
  m: Pick<SetupQualityInput, 'hasCatalyst' | 'catalystStatus'>,
): boolean {
  if (m.catalystStatus === 'pending' || m.catalystStatus === 'unchecked') return false
  return m.hasCatalyst === true
}

/**
 * A+ is A, plus a checked catalyst, the near-ATH band, and base quality.
 * baseQuality >= baseQualityMin, or rangeBaseScore >= rangeBaseScoreMin.
 * Heuristic only — not a signal and not Kyle's official Rating.
 */
export function isAPlusHeuristic(m: SetupQualityInput): boolean {
  if (!isAHeuristic(m)) return false
  if (!catalystCountsForAPlus(m)) return false
  if (!(m.pctFrom52wHigh >= -NEAR_ATH_MAX_PCT)) return false
  const quality = baseQualityScore(baseQualityDays(m))
  const rangeScore = m.rangeBaseScore
  const rangeScoreOk =
    typeof rangeScore === 'number' && Number.isFinite(rangeScore) && rangeScore >= APLUS_CONFIG.rangeBaseScoreMin
  return quality >= APLUS_CONFIG.baseQualityMin || rangeScoreOk
}

/**
 * A++ is A+ with a base longer than normal.
 * Days are max(baseLengthDays, range-base lengthSessions), the same pair
 * base quality uses. Equality at {@link LONG_BASE_MIN_SESSIONS} passes.
 */
export function isAPlusPlusHeuristic(m: SetupQualityInput): boolean {
  if (!isAPlusHeuristic(m)) return false
  return baseQualityDays(m) >= LONG_BASE_MIN_SESSIONS
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
  /** Small bump. Does not grant the A+ floor. */
  isA?: boolean
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
  score = round2(score)
  if (m.isAPlus) {
    score = Math.max(score, k.aPlusFloor)
  } else if (m.isA) {
    const bumped = round2(score + k.aBump)
    const underFloor = round2(k.aPlusFloor - 0.01)
    score = score >= k.aPlusFloor ? bumped : Math.min(bumped, underFloor)
  }
  return Math.min(k.clampMax, Math.max(k.clampMin, score))
}

/**
 * (max high − min low) / latest close × 100 over the last `sessions` bars.
 * The latest close is the denominator. Null when history or the close is unusable.
 */
export function recentRangePct(
  bars: DailyBar[],
  sessions: number = RANGE_BREAKOUT_CONFIG.recentRangeSessions,
): number | null {
  if (sessions <= 0 || bars.length < sessions) return null
  const window = bars.slice(-sessions)
  const close = window[window.length - 1]!.c
  if (!(close > 0) || !Number.isFinite(close)) return null
  let maxH = -Infinity
  let minL = Infinity
  for (const bar of window) {
    if (bar.h > maxH) maxH = bar.h
    if (bar.l < minL) minL = bar.l
  }
  if (!Number.isFinite(maxH) || !Number.isFinite(minL)) return null
  return ((maxH - minL) / close) * 100
}

/** recentRangePct / adrPct. Null when ADR% is not positive or the range is missing. */
export function rangeOverAdr(recentRangePctValue: number | null, adrPct: number): number | null {
  if (recentRangePctValue == null || !Number.isFinite(recentRangePctValue)) return null
  if (!(adrPct > 0) || !Number.isFinite(adrPct)) return null
  return recentRangePctValue / adrPct
}

export interface PivotLow {
  index: number
  low: number
}

/**
 * Confirmed pivot lows. The bar's low is strictly lower than `radius` bars
 * on each side, so the last `radius` bars cannot be pivots yet.
 */
export function confirmedPivotLows(bars: DailyBar[], radius: number): PivotLow[] {
  if (radius <= 0 || bars.length < radius * 2 + 1) return []
  const pivots: PivotLow[] = []
  for (let i = radius; i < bars.length - radius; i++) {
    const low = bars[i]!.l
    let isPivot = true
    for (let k = 1; k <= radius; k++) {
      if (!(low < bars[i - k]!.l && low < bars[i + k]!.l)) {
        isPivot = false
        break
      }
    }
    if (isPivot) pivots.push({ index: i, low })
  }
  return pivots
}

/**
 * Half-window floor rise over the base. Older and newer halves are floor(n/2);
 * an odd bar goes to the newer half. Non-positive lows fail closed.
 */
export function halfWindowFloorRise(
  bars: DailyBar[],
  config: RangeBreakoutConfig = RANGE_BREAKOUT_CONFIG,
): boolean {
  const n = Math.min(config.higherLowsBaseSessions, bars.length)
  if (n < 2) return false
  const window = bars.slice(-n)
  const olderLen = Math.floor(n / 2)
  const older = window.slice(0, olderLen)
  const newer = window.slice(olderLen)
  if (!older.length || !newer.length) return false
  const olderMin = Math.min(...older.map((bar) => bar.l))
  const newerMin = Math.min(...newer.map((bar) => bar.l))
  if (!(olderMin > 0) || !(newerMin > 0)) return false
  return newerMin > olderMin * (1 + config.higherLowsMinRisePct / 100)
}

/**
 * Last `higherLowsMinPivots` confirmed pivots inside the base, plus
 * `higherLowsPivotPad` sessions before it, each strictly above the previous.
 * Needs at least two pivots.
 */
export function swingLowStaircase(
  bars: DailyBar[],
  config: RangeBreakoutConfig = RANGE_BREAKOUT_CONFIG,
): boolean {
  const pivots = confirmedPivotLows(bars, config.pivotRadius)
  const baseStart = Math.max(0, bars.length - config.higherLowsBaseSessions)
  const padStart = Math.max(0, baseStart - config.higherLowsPivotPad)
  const inWindow = pivots.filter((pivot) => pivot.index >= padStart)
  if (inWindow.length < 2) return false
  const last = inWindow.slice(-config.higherLowsMinPivots)
  if (last.length < 2) return false
  for (let i = 1; i < last.length; i++) {
    if (!(last[i]!.low > last[i - 1]!.low)) return false
  }
  return true
}

export interface HigherLowsResult {
  hasHigherLows: boolean
  higherLowsRule: 'half' | 'swing' | null
}

/** Half-window first. Swing is reported only when the floor did not rise. */
export function evaluateHigherLows(
  bars: DailyBar[],
  config: RangeBreakoutConfig = RANGE_BREAKOUT_CONFIG,
): HigherLowsResult {
  if (halfWindowFloorRise(bars, config)) {
    return { hasHigherLows: true, higherLowsRule: 'half' }
  }
  if (swingLowStaircase(bars, config)) {
    return { hasHigherLows: true, higherLowsRule: 'swing' }
  }
  return { hasHigherLows: false, higherLowsRule: null }
}

export interface RangeBreakoutGateInput {
  adrPct: number
  aboveSma50: boolean
  priorRunPct: number
  rangeOverAdr: number | null
  hasHigherLows: boolean
}

/** All five Range Breakout gates. Does not apply the Episodic Pivot override. */
export function rangeBreakoutGatesPass(
  m: RangeBreakoutGateInput,
  config: RangeBreakoutConfig = RANGE_BREAKOUT_CONFIG,
): boolean {
  return (
    m.adrPct >= config.adrMinPct &&
    m.aboveSma50 === true &&
    m.priorRunPct >= config.priorLegMinPct &&
    m.rangeOverAdr != null &&
    Number.isFinite(m.rangeOverAdr) &&
    m.rangeOverAdr <= config.rangeOverAdrMax &&
    m.hasHigherLows === true
  )
}

/**
 * Setup label. Episodic Pivot first (RVOL and day% only), then Range Breakout
 * when every gate passes, otherwise Continuation.
 */
export function setupTypeHeuristic(
  m: RangeBreakoutGateInput & {
    rvol: number
    dayPct: number
  },
): SetupType {
  if (m.rvol >= SETUP_TYPE_CONFIG.episodicRvol && m.dayPct >= SETUP_TYPE_CONFIG.episodicDayPct) {
    return 'Episodic Pivot'
  }
  if (rangeBreakoutGatesPass(m)) return 'Range Breakout'
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
  if (m.pctFrom52wHigh >= -NEAR_ATH_MAX_PCT) tags.push('near ATH')
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

const WHY_AVOID =
  'Earnings same day or next trading day — AVOID entry (hard fail). Not tradeable A or A+ regardless of other metrics.'
const WHY_APLUS_PLUS =
  'Heuristic A++: an A+ setup whose base is at least one quarter of sessions (longer than a normal base). Same score floor as A+. Not a signal and not Kyle Rating.'
const WHY_APLUS =
  'Heuristic A+: an A setup with a checked catalyst, inside the near-ATH band, and a longer base. A month-scale base scores lower than a multi-month or year base. Not a signal and not Kyle Rating.'
const WHY_A =
  'Heuristic A: Range Breakout, strict tight consolidation, above the 200-day and 50-day SMAs, ADR at the A floor, extension from the 50 SMA within the cap or unknown, and a constructive path (coiled, triggering, tight consolidation, or a range base). Catalyst is not required.'
const WHY_WATCH = 'On watchlist above 200 SMA; does not meet the heuristic A thresholds today.'
const WHY_BELOW =
  'Below daily 200 SMA — fails Qullamaggie hard trend gate (not a valid setup). Tag: Below 200MA.'

export function qualityInputFromIdea(idea: TradingIdea): SetupQualityInput {
  const detail = idea.rangeBaseDetail
  const storedScore = detail?.score ?? idea.rangeBaseScore
  return {
    aboveSma200: idea.aboveSma200 === true,
    aboveSma50: idea.aboveSma50 === true,
    adrPct: typeof idea.adrPct === 'number' && Number.isFinite(idea.adrPct) ? idea.adrPct : 0,
    extensionAdr50: idea.extensionAdr50 ?? null,
    setupStage: idea.setupStage ?? 'watching',
    tightConsolidation: idea.tightConsolidation === true,
    rangeBaseOk: detail?.ok === true,
    earningsStatus: idea.earningsStatus,
    pctFrom52wHigh: typeof idea.pctFrom52wHigh === 'number' && Number.isFinite(idea.pctFrom52wHigh) ? idea.pctFrom52wHigh : 0,
    hasCatalyst: idea.hasCatalyst,
    catalystStatus: idea.catalystStatus,
    baseLengthDays:
      typeof idea.baseLengthDays === 'number' && Number.isFinite(idea.baseLengthDays) ? idea.baseLengthDays : 0,
    rangeBaseLengthSessions:
      typeof detail?.lengthSessions === 'number' && Number.isFinite(detail.lengthSessions) ? detail.lengthSessions : 0,
    rangeBaseScore: typeof storedScore === 'number' && Number.isFinite(storedScore) ? storedScore : null,
    setupType: idea.setupType,
  }
}

function whyQualifiesFor(idea: TradingIdea, isA: boolean, isAPlus: boolean, isAPlusPlus: boolean): string {
  if (idea.earningsStatus === 'avoid') return WHY_AVOID
  if (isAPlusPlus) return WHY_APLUS_PLUS
  if (isAPlus) return WHY_APLUS
  if (isA) return WHY_A
  if (idea.aboveSma200) return WHY_WATCH
  return WHY_BELOW
}

/** Recompute isA, isAPlus, isAPlusPlus, kyleScore, and the qualify sentence from the idea's current fields. */
export function applyQualityFlags(idea: TradingIdea): TradingIdea {
  const input = qualityInputFromIdea(idea)
  const isA = isAHeuristic(input)
  const isAPlus = isAPlusHeuristic(input)
  const isAPlusPlus = isAPlusPlusHeuristic(input)
  const kyleScore = kyleScoreHeuristic({
    aboveSma200: idea.aboveSma200 === true,
    aboveSma50: idea.aboveSma50 === true,
    aboveSma10: idea.aboveSma10 === true,
    aboveSma20: idea.aboveSma20 === true,
    pctFrom52wHigh: input.pctFrom52wHigh,
    rvol: typeof idea.rvol === 'number' && Number.isFinite(idea.rvol) ? idea.rvol : 0,
    adrPct: input.adrPct,
    priorRunPct: typeof idea.priorRunPct === 'number' && Number.isFinite(idea.priorRunPct) ? idea.priorRunPct : 0,
    isA,
    isAPlus,
  })
  return {
    ...idea,
    isA,
    isAPlus,
    isAPlusPlus,
    kyleScore,
    whyQualifies: whyQualifiesFor(idea, isA, isAPlus, isAPlusPlus),
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

  const adrPct = adrPctFromBars(bars)

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
  const extensionAdr50 = roundExtensionAdr50(extensionAdrFrom50(price, sma50, adrPct))

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

  const higherLows = evaluateHigherLows(bars)
  const recentRangeRaw = recentRangePct(bars)
  // Gate on the same 2-decimal ADR and ratio the detail panel shows.
  const rangeOverAdrRaw = rangeOverAdr(recentRangeRaw, metricsCore.adrPct)
  const rangeGate: RangeBreakoutGateInput = {
    adrPct: metricsCore.adrPct,
    aboveSma50,
    priorRunPct,
    rangeOverAdr: rangeOverAdrRaw == null ? null : round2(rangeOverAdrRaw),
    hasHigherLows: higherLows.hasHigherLows,
  }
  const rangeBreakoutDetail: RangeBreakoutDetail = {
    ...rangeGate,
    recentRangePct: recentRangeRaw == null ? null : round2(recentRangeRaw),
    higherLowsRule: higherLows.higherLowsRule,
    passed: rangeBreakoutGatesPass(rangeGate),
  }
  const setupType = setupTypeHeuristic({
    rvol: metricsCore.rvol,
    dayPct: metricsCore.dayPct,
    ...rangeGate,
  })
  const rangeBaseDetail = evaluateRangeBase(bars, metricsCore.adrPct, higherLows.hasHigherLows)
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

  return applyQualityFlags({
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
    extensionAdr50,
    setupType,
    catalyst,
    isA: false,
    isAPlus: false,
    isAPlusPlus: false,
    notes: `Live metrics via ${snap.provider}. Catalyst is filled after the scan from news inside 48 hours. Kyle-style proxies from bars only.`,
    whyQualifies: '',
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
    kyleScore: 0,
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
    rangeBreakoutDetail,
    rangeBaseScore: rangeBaseDetail.score,
    rangeBaseDetail,
  })
}

/** Re-apply earnings fields and recompute A+ (after async calendar fetch). */
export function applyEarningsToIdea(
  idea: TradingIdea,
  earningsDate: string | null,
): TradingIdea {
  const { daysToEarnings, earningsStatus } = classifyEarningsProximity(earningsDate)
  return applyQualityFlags({
    ...idea,
    earningsDate,
    daysToEarnings,
    earningsStatus,
  })
}
