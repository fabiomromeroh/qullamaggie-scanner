export type SetupType = 'Range Breakout' | 'Episodic Pivot' | 'Continuation'

/**
 * Setup readiness stage (derived from Kyle-style proxies).
 * - watching: above 200 SMA, building base / on radar
 * - coiled: tight days + near highs + MA surfer
 * - triggering: elevated RVOL / breakout-day heuristic
 */
export type SetupStage = 'watching' | 'coiled' | 'triggering'

/** Heuristic market regime from QQQ (not a signal). */
export type StDirection = 'Uptrend' | 'Sideways' | 'Downtrend'

export interface MarketRegime {
  /** QQQ SMA10 > SMA20 */
  qqq10gt20: boolean
  /** Heuristic: Uptrend / Sideways / Downtrend from QQQ vs SMA50 / slope */
  stDirection: StDirection
  /** Optional detail for tooltips */
  detail?: string
}

/** Characteristics-style tags derived from live bars / catalyst text. */
export type CharacteristicTag =
  | '10MA Surfer'
  | '20MA Surfer'
  | '50MA Surfer'
  | 'near ATH'
  | 'Earnings'
  | 'GAP'
  | 'Below 200MA'

export interface IndustryGroup {
  id: string
  name: string
  rsRank: number
  leaderCount: number
  dayPct: number
  weekPct: number
  monthPct: number
  description: string
}

export interface SparkPoint {
  d: string
  c: number
}

export interface TradingIdea {
  ticker: string
  name: string
  groupId: string
  groupName: string
  price: number
  dayPct: number
  rvol: number
  adrPct: number
  pctFrom52wHigh: number
  perf1M: number
  perf3M: number
  avgDollarVol: number
  /** Daily 200-SMA (Qullamaggie hard trend gate). */
  sma200: number
  /** Daily 50-SMA (soft preference). */
  sma50: number
  aboveSma200: boolean
  aboveSma50: boolean
  /** (price / SMA200 − 1) × 100 */
  pctAboveSma200: number
  /** (price / SMA50 − 1) × 100 */
  pctAboveSma50: number
  setupType: SetupType
  catalyst: string | null
  isAPlus: boolean
  notes: string
  whyQualifies: string
  suggestedEntry: number | null
  suggestedStop: number | null
  sparkline: SparkPoint[]

  // --- Kyle Breakout DB–style proxies (from live bars only) ---
  /** SMA10 of closes */
  sma10: number
  /** SMA20 of closes */
  sma20: number
  aboveSma10: boolean
  aboveSma20: boolean
  /**
   * Inc% / prior-run proxy: % gain from the lowest low in the ~63 sessions
   * before the recent ~15-day consolidation window into that window's high.
   * Documents as "priorRunPct" (Kyle Inc% BBO proxy) — not his exact formula.
   */
  priorRunPct: number
  /**
   * Tight-days proxy: count of last 15 sessions where range < 0.75×20d ADR
   * or close within 1.5% of SMA10/SMA20.
   */
  tightDays: number
  /**
   * Base-length / Over Days proxy: consecutive recent days with below-average
   * range (same tight heuristic), capped at lookback.
   */
  baseLengthDays: number
  /** Alias of avgDollarVol for DolVol column labeling. */
  dollarVolume: number
  /**
   * Heuristic quality 3–5 (not Kyle's official Rating).
   * Used for sorting; A+ implies high score.
   */
  kyleScore: number
  /** Characteristics-style badges (never invent Earnings/GAP without catalyst text). */
  characteristics: CharacteristicTag[]
  /**
   * Setup readiness: watching | coiled | triggering.
   * Only set when aboveSma200; below 200 → excluded from scan results.
   */
  setupStage: SetupStage
}

export interface DashboardData {
  source: 'demo' | 'live'
  asOf: string
  groups: IndustryGroup[]
  ideas: TradingIdea[]
  /** Optional QQQ-derived regime (live when available). */
  marketRegime?: MarketRegime | null
  /** Scan universe size attempted (live). */
  scanUniverseSize?: number
  /** Symbols that returned a valid above-200 idea. */
  scanHitCount?: number
  /** Fetch failures during scan. */
  scanFailCount?: number
  /** Excluded solely for failing 200 SMA. */
  scanBelow200Count?: number
}

export interface IdeaFilters {
  minRvol: number
  maxPctFromHigh: number
  setupTypes: SetupType[]
  aPlusOnly: boolean
  hasCatalyst: boolean
  /** Soft prefer: require price above 50-day SMA (default ON). */
  requireSma50: boolean
  /** Optional: require price above 10-day SMA (Kyle 10MA Surfer). */
  requireSma10: boolean
  /** Optional: require price above 20-day SMA (Kyle 20MA Surfer). */
  requireSma20: boolean
  /** Visible readiness stages (default: coiled + triggering). */
  stages: SetupStage[]
  groupId: string | null
  search: string
}

export const ALL_SETUP_TYPES: SetupType[] = [
  'Range Breakout',
  'Episodic Pivot',
  'Continuation',
]

export const DEFAULT_FILTERS: IdeaFilters = {
  minRvol: 0,
  maxPctFromHigh: 100,
  setupTypes: [...ALL_SETUP_TYPES],
  aPlusOnly: false,
  hasCatalyst: false,
  requireSma50: true,
  requireSma10: false,
  requireSma20: false,
  stages: ['coiled', 'triggering'],
  groupId: null,
  search: '',
}
