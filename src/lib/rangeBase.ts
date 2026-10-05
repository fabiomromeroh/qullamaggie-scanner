/**
 * Range-base detector for imperfect highs and lows.
 *
 * The reference band is the older half of a lookback window: that half's
 * minimum low and maximum high, expanded on each side by
 * `adrSlack × ADR%` of the latest close. A newer-half bar counts as contained
 * when its close or its midpoint `(high+low)/2` lies inside the expanded band.
 * Slack is what lets a high or low miss a perfect horizontal line by a fraction
 * of an ADR and still count.
 *
 * The full window's own min/max is not the test band. Every close already sits
 * inside that span, so the fraction could not fail. The older half defines the
 * band; the newer half is the test.
 *
 * A trending older half would make a huge band and a later pause would look
 * like a year-long base. `bandRangeOverAdrMax` rejects those windows. The
 * search keeps the longest window that also clears containment, the above-50
 * fraction, and `minSessions`. `lengthSessions` is 0 when no such window exists.
 * Recent-session compression is a separate gate on `ok`.
 */
import type { RangeBaseDetail } from '../types'

/** Bar fields the detector reads. DailyBar from metrics.ts is compatible. */
export interface RangeBaseBar {
  h: number
  l: number
  c: number
}

export interface RangeBaseConfig {
  /** Sessions in the recent-range compression window, including the latest bar. */
  recentSessions: number
  /**
   * recentRangePct / adrPct must be <= this. Equality passes.
   * Same shape as the Range Breakout range/ADR ratio, over a longer window.
   */
  compressionMax: number
  /** Longest lookback the search will try. About one trading year. */
  maxLookbackSessions: number
  /** Structural bases shorter than this fail the length gate. */
  minSessions: number
  /**
   * Fraction of newer-half bars whose close or midpoint is inside the band.
   * Equality passes.
   */
  containmentMin: number
  /**
   * Each side of the band grows by this many ADR%. 0.5 and ADR% 4 expand the
   * band by 2% of the latest close. That is the imperfect high/low slack.
   */
  adrSlack: number
  /**
   * Older-half (max high − min low) / latest close, divided by ADR%, must be
   * <= this. Stops a trending older half from counting as a range.
   */
  bandRangeOverAdrMax: number
  /** Fraction of lookback closes strictly above that bar's SMA. Equality passes. */
  above50Min: number
  smaPeriod: number
  /** ~1 month of sessions. Shared scale with A+ base quality. */
  monthSessions: number
  /** ~1 year of sessions. lengthScore reaches 1 here. */
  yearSessions: number
  /** Added to the 0–1 score when the Range Breakout higher-low check passed. Not a hard fail. */
  higherLowsBonus: number
  /** When true, missing higher lows fails `ok`. Default false: bonus only. */
  higherLowsHardFail: boolean
  /** Score weights. They sum to 1 before the higher-low bonus. The total is then clamped to 0–1. */
  weightCompression: number
  weightContainment: number
  weightLength: number
  weightAbove50: number
}

export const RANGE_BASE_CONFIG: RangeBaseConfig = {
  recentSessions: 12,
  compressionMax: 4.5,
  maxLookbackSessions: 252,
  minSessions: 10,
  containmentMin: 0.7,
  adrSlack: 0.5,
  bandRangeOverAdrMax: 8,
  above50Min: 0.75,
  smaPeriod: 50,
  monthSessions: 21,
  yearSessions: 252,
  higherLowsBonus: 0.05,
  higherLowsHardFail: false,
  weightCompression: 0.25,
  weightContainment: 0.3,
  weightLength: 0.3,
  weightAbove50: 0.15,
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0
  if (n < 0) return 0
  if (n > 1) return 1
  return n
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000
}

/**
 * lengthScore = log1p(sessions / monthSessions) / log1p(yearSessions / monthSessions),
 * clamped to 0–1. A month (~21) scores about 0.27. A year (~252) scores 1.
 * Month-scale bases score lower than multi-month and year bases.
 */
export function rangeBaseLengthScore(
  sessions: number,
  config: RangeBaseConfig = RANGE_BASE_CONFIG,
): number {
  if (!(sessions > 0) || !(config.monthSessions > 0) || !(config.yearSessions > 0)) return 0
  const denom = Math.log1p(config.yearSessions / config.monthSessions)
  if (!(denom > 0)) return 0
  return clamp01(Math.log1p(sessions / config.monthSessions) / denom)
}

function rollingSma(closes: readonly number[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array(closes.length).fill(null)
  if (period <= 0) return out
  let sum = 0
  for (let i = 0; i < closes.length; i += 1) {
    sum += closes[i]!
    if (i >= period) sum -= closes[i - period]!
    if (i >= period - 1) out[i] = sum / period
  }
  return out
}

/** (max high − min low) / latest close × 100. Null when the window or the close is unusable. */
function windowRangePct(bars: readonly RangeBaseBar[], start: number, end: number): number | null {
  if (end - start < 1) return null
  const close = bars[end - 1]!.c
  if (!(close > 0) || !Number.isFinite(close)) return null
  let maxH = -Infinity
  let minL = Infinity
  for (let i = start; i < end; i += 1) {
    const bar = bars[i]!
    if (bar.h > maxH) maxH = bar.h
    if (bar.l < minL) minL = bar.l
  }
  if (!Number.isFinite(maxH) || !Number.isFinite(minL)) return null
  return ((maxH - minL) / close) * 100
}

interface WindowMeasure {
  containment: number
  above50Frac: number
  bandRangeOverAdr: number | null
}

function measureWindow(
  bars: readonly RangeBaseBar[],
  sma: readonly (number | null)[],
  start: number,
  end: number,
  adrPct: number,
  config: RangeBaseConfig,
): WindowMeasure {
  const length = end - start
  const olderLen = Math.floor(length / 2)
  const newerLen = length - olderLen
  if (olderLen < 1 || newerLen < 1) {
    return { containment: 0, above50Frac: 0, bandRangeOverAdr: null }
  }
  let minL = Infinity
  let maxH = -Infinity
  for (let i = start; i < start + olderLen; i += 1) {
    const bar = bars[i]!
    if (bar.l < minL) minL = bar.l
    if (bar.h > maxH) maxH = bar.h
  }
  const ref = bars[end - 1]!.c
  const slack =
    ref > 0 && adrPct > 0 && Number.isFinite(adrPct) ? ref * ((config.adrSlack * adrPct) / 100) : 0
  const bandLow = minL - slack
  const bandHigh = maxH + slack
  let inside = 0
  for (let i = start + olderLen; i < end; i += 1) {
    const bar = bars[i]!
    const mid = (bar.h + bar.l) / 2
    const closeIn = bar.c >= bandLow && bar.c <= bandHigh
    const midIn = mid >= bandLow && mid <= bandHigh
    if (closeIn || midIn) inside += 1
  }
  let above = 0
  let known = 0
  for (let i = start; i < end; i += 1) {
    const average = sma[i]
    if (average == null || !Number.isFinite(average)) continue
    known += 1
    if (bars[i]!.c > average) above += 1
  }
  const olderRange = windowRangePct(bars, start, start + olderLen)
  const bandRangeOverAdr =
    olderRange == null || !(adrPct > 0) ? null : olderRange / adrPct
  return {
    containment: newerLen > 0 ? inside / newerLen : 0,
    above50Frac: known > 0 ? above / known : 0,
    bandRangeOverAdr,
  }
}

function compressionScore(ratio: number | null, max: number): number {
  if (ratio == null || !Number.isFinite(ratio) || !(max > 0)) return 0
  if (ratio <= max) return 1
  return clamp01(1 - (ratio - max) / max)
}

/**
 * @param adrPct ADR% on the same scale as the idea (already a percent, not a fraction).
 * @param higherLows Range Breakout `hasHigherLows` (15-session half-window or swing). Bonus only unless `higherLowsHardFail`.
 */
export function evaluateRangeBase(
  bars: readonly RangeBaseBar[],
  adrPct: number,
  higherLows = false,
  config: RangeBaseConfig = RANGE_BASE_CONFIG,
): RangeBaseDetail {
  const n = bars.length
  const recentPct = windowRangePct(bars, Math.max(0, n - config.recentSessions), n)
  const compressionRaw =
    recentPct == null || !(adrPct > 0) || !Number.isFinite(adrPct) ? null : recentPct / adrPct
  const compression = compressionRaw == null ? null : round3(compressionRaw)
  const compressionOk = compression != null && compression <= config.compressionMax

  const closes = bars.map((bar) => bar.c)
  const sma = rollingSma(closes, config.smaPeriod)
  const maxL = Math.min(config.maxLookbackSessions, n)

  let bestL = 0
  let bestContainment = 0
  let bestAbove = 0
  let found = false
  let diagnosticContainment = 0
  let diagnosticAbove = 0
  let diagnosticBand: number | null = null
  if (maxL >= 2) {
    const diag = measureWindow(bars, sma, n - maxL, n, adrPct, config)
    diagnosticContainment = round3(diag.containment)
    diagnosticAbove = round3(diag.above50Frac)
    diagnosticBand = diag.bandRangeOverAdr == null ? null : round3(diag.bandRangeOverAdr)
  }
  if (maxL >= config.minSessions) {
    for (let length = maxL; length >= config.minSessions; length -= 1) {
      const start = n - length
      const measured = measureWindow(bars, sma, start, n, adrPct, config)
      const containmentR = round3(measured.containment)
      const aboveR = round3(measured.above50Frac)
      const bandR = measured.bandRangeOverAdr == null ? null : round3(measured.bandRangeOverAdr)
      const bandOk = bandR != null && bandR <= config.bandRangeOverAdrMax
      if (containmentR >= config.containmentMin && aboveR >= config.above50Min && bandOk) {
        bestL = length
        bestContainment = containmentR
        bestAbove = aboveR
        found = true
        break
      }
    }
  }

  const lengthSessions = bestL
  const lengthScore = round3(rangeBaseLengthScore(lengthSessions, config))
  const containment = found ? bestContainment : diagnosticContainment
  const above50Frac = found ? bestAbove : diagnosticAbove

  const failedReasons: string[] = []
  if (lengthSessions < config.minSessions) failedReasons.push('length')
  if (!compressionOk) failedReasons.push('compression')
  if (containment < config.containmentMin) failedReasons.push('containment')
  if (above50Frac < config.above50Min) failedReasons.push('above50')
  if (!found && diagnosticBand != null && diagnosticBand > config.bandRangeOverAdrMax) {
    failedReasons.push('bandWidth')
  }
  if (config.higherLowsHardFail && !higherLows) failedReasons.push('higherLows')

  const structural = found && bestL >= config.minSessions
  const ok =
    structural &&
    compressionOk &&
    containment >= config.containmentMin &&
    above50Frac >= config.above50Min &&
    (!config.higherLowsHardFail || higherLows)

  const score = round3(
    clamp01(
      config.weightCompression * compressionScore(compression, config.compressionMax) +
        config.weightContainment * containment +
        config.weightLength * lengthScore +
        config.weightAbove50 * above50Frac +
        (higherLows ? config.higherLowsBonus : 0),
    ),
  )

  return {
    ok,
    score,
    compression,
    containment,
    lengthSessions,
    lengthScore,
    above50Frac,
    higherLows,
    failedReasons,
  }
}
