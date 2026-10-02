/**
 * Setup readiness stages for Kyle / Qullamaggie-style breakout spotting.
 *
 * - watching   — passes hard trend gate (above 200 SMA), building / on radar
 * - coiled     — tight coil + near highs + MA surfer (ready to break)
 * - triggering — elevated RVOL / breakout-day heuristic
 *
 * Names below 200 SMA are never staged as setups (callers exclude them).
 *
 * The legacy coiled rule uses a loose aboveSma10 || aboveSma20 gate (price
 * above a short SMA). That local flag is unrelated to the strict ADR-based
 * surfer label (`surfer10` / `surfer20` / `surfer50`). An extra OR-route from
 * tightConsolidation (price above the 50 and 200 SMAs, plus contraction near
 * highs) is behind TIGHT_CONFIG.useInCoiled.
 */
import type { SetupStage } from '../types'
import { TIGHT_CONFIG } from './tightConsolidation'

export const ALL_SETUP_STAGES: SetupStage[] = ['triggering', 'coiled', 'watching']

/** Default UI: coiled + triggering first (watching opt-in via filter). */
export const DEFAULT_VISIBLE_STAGES: SetupStage[] = ['coiled', 'triggering']

/** Auto-add to user watchlist when kyleScore >= this AND stage is coiled/triggering. */
export const AUTO_ADD_MIN_KYLE_SCORE = 4

/**
 * Thresholds for {@link setupStageHeuristic}. Comparisons use the negative
 * distance form `pctFrom52wHigh >= -nearHighPct` (same sign as metrics.ts).
 */
export const STAGE_CONFIG = {
  /** Near highs for the first trigger path and the coiled gate. */
  nearHighPct: 10,
  /** Tighter band: third trigger path, and the coiled "closer to the high" OR. */
  nearHighTightPct: 5,
  /** Path 1: RVOL >= this, within nearHighPct, and day% >= triggerDayPctNearHigh. */
  triggerRvolNearHigh: 1.8,
  triggerDayPctNearHigh: 1,
  /** Path 2: RVOL >= this and day% >= triggerDayPctStrong (no near-high test). */
  triggerRvolStrong: 2.2,
  triggerDayPctStrong: 2,
  /** Path 3: RVOL >= this, within nearHighTightPct, and day% >= triggerDayPctTight. */
  triggerRvolTight: 1.5,
  triggerDayPctTight: 2.5,
  /** Legacy coiled: tightDays must be at least this. */
  coiledTightDaysMin: 5,
  /** Legacy coiled: priorRunPct >= this, or the tighter near-high band. */
  coiledPriorRunMin: 15,
} as const

export function setupStageHeuristic(m: {
  aboveSma200: boolean
  aboveSma10: boolean
  aboveSma20: boolean
  pctFrom52wHigh: number
  tightDays: number
  rvol: number
  dayPct: number
  priorRunPct: number
  /** Strict tight-consolidation flag. Used only when TIGHT_CONFIG.useInCoiled. */
  tightConsolidation?: boolean
}): SetupStage | null {
  if (!m.aboveSma200) return null

  const nearHighs = m.pctFrom52wHigh >= -STAGE_CONFIG.nearHighPct
  const nearHighsTight = m.pctFrom52wHigh >= -STAGE_CONFIG.nearHighTightPct

  // Breakout / trigger day: volume expansion near highs (or strong green + RVOL).
  const triggering =
    (m.rvol >= STAGE_CONFIG.triggerRvolNearHigh &&
      nearHighs &&
      m.dayPct >= STAGE_CONFIG.triggerDayPctNearHigh) ||
    (m.rvol >= STAGE_CONFIG.triggerRvolStrong && m.dayPct >= STAGE_CONFIG.triggerDayPctStrong) ||
    (m.rvol >= STAGE_CONFIG.triggerRvolTight &&
      nearHighsTight &&
      m.dayPct >= STAGE_CONFIG.triggerDayPctTight)

  if (triggering) return 'triggering'

  if (coiledByLegacyRule(m) || coiledByTightRoute(m, nearHighs)) return 'coiled'

  return 'watching'
}

/**
 * Existing coiled rule: tightDays + near highs + price above SMA10 or SMA20
 * + prior run / closer high. `aboveShortMas` is the loose price-above flag.
 * It is not the strict surfer label.
 */
export function coiledByLegacyRule(m: {
  aboveSma10: boolean
  aboveSma20: boolean
  pctFrom52wHigh: number
  tightDays: number
  priorRunPct: number
}): boolean {
  const nearHighs = m.pctFrom52wHigh >= -STAGE_CONFIG.nearHighPct
  const aboveShortMas = m.aboveSma10 || m.aboveSma20
  const tight = m.tightDays >= STAGE_CONFIG.coiledTightDaysMin
  return (
    tight &&
    nearHighs &&
    aboveShortMas &&
    (m.priorRunPct >= STAGE_CONFIG.coiledPriorRunMin ||
      m.pctFrom52wHigh >= -STAGE_CONFIG.nearHighTightPct)
  )
}

/**
 * Extra coiled route: strict tightConsolidation near highs.
 * Gated by TIGHT_CONFIG.useInCoiled (on; live scan inflation was +1.5%).
 */
export function coiledByTightRoute(
  m: { tightConsolidation?: boolean },
  nearHighs: boolean,
  useInCoiled: boolean = TIGHT_CONFIG.useInCoiled,
): boolean {
  return useInCoiled && Boolean(m.tightConsolidation) && nearHighs
}

export function stageSortRank(stage: SetupStage): number {
  if (stage === 'triggering') return 0
  if (stage === 'coiled') return 1
  return 2
}

export function stageLabel(stage: SetupStage): string {
  if (stage === 'triggering') return 'Triggering'
  if (stage === 'coiled') return 'Coiled'
  return 'Watching'
}
