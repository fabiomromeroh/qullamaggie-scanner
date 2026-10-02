/**
 * Setup readiness stages for Kyle / Qullamaggie-style breakout spotting.
 *
 * - watching   — passes hard trend gate (above 200 SMA), building / on radar
 * - coiled     — tight coil + near highs + MA surfer (ready to break)
 * - triggering — elevated RVOL / breakout-day heuristic
 *
 * Names below 200 SMA are never staged as setups (callers exclude them).
 *
 * Coiled "surfer" is the loose aboveSma10 || aboveSma20 gate (price above the
 * SMA, not the strict ride-the-MA flags). An extra OR-route from
 * tightConsolidation is behind TIGHT_CONFIG.useInCoiled (on after a live scan
 * showed +1.5% coiled).
 */
import type { SetupStage } from '../types'
import { TIGHT_CONFIG } from './tightConsolidation'

export const ALL_SETUP_STAGES: SetupStage[] = ['triggering', 'coiled', 'watching']

/** Default UI: coiled + triggering first (watching opt-in via filter). */
export const DEFAULT_VISIBLE_STAGES: SetupStage[] = ['coiled', 'triggering']

/** Auto-add to user watchlist when kyleScore >= this AND stage is coiled/triggering. */
export const AUTO_ADD_MIN_KYLE_SCORE = 4

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

  const nearHighs = m.pctFrom52wHigh >= -10
  const nearHighsTight = m.pctFrom52wHigh >= -5

  // Breakout / trigger day: volume expansion near highs (or strong green + RVOL).
  const triggering =
    (m.rvol >= 1.8 && nearHighs && m.dayPct >= 1) ||
    (m.rvol >= 2.2 && m.dayPct >= 2) ||
    (m.rvol >= 1.5 && nearHighsTight && m.dayPct >= 2.5)

  if (triggering) return 'triggering'

  if (coiledByLegacyRule(m) || coiledByTightRoute(m, nearHighs)) return 'coiled'

  return 'watching'
}

/** Existing coiled rule: tightDays + near highs + loose MA surfer + prior run / closer high. */
export function coiledByLegacyRule(m: {
  aboveSma10: boolean
  aboveSma20: boolean
  pctFrom52wHigh: number
  tightDays: number
  priorRunPct: number
}): boolean {
  const nearHighs = m.pctFrom52wHigh >= -10
  const surfer = m.aboveSma10 || m.aboveSma20
  const tight = m.tightDays >= 5
  return tight && nearHighs && surfer && (m.priorRunPct >= 15 || m.pctFrom52wHigh >= -5)
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
