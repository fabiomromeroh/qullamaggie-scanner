export type SetupType = 'Range Breakout' | 'Episodic Pivot' | 'Continuation'

/**
 * Setup readiness stage (derived from Kyle-style proxies).
 * - watching: above 200 SMA, building base / on radar
 * - coiled: tight days + near highs + MA surfer
 * - triggering: elevated RVOL / breakout-day heuristic
 */
export type SetupStage = 'watching' | 'coiled' | 'triggering'

/**
 * Earnings proximity (critical trading rule).
 * - avoid: same day or next trading day (hard fail for entry)
 * - alert: ~2 trading days out
 * - clear: further out / none soon
 */
export type EarningsStatus = 'avoid' | 'alert' | 'clear'

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
  /**
   * Internal ranking: members within 10% of the 52w high.
   * Finviz: scan ideas whose industry label matches this group.
   * Absent when that count cannot be computed from real scan data.
   */
  leaderCount?: number
  dayPct?: number
  weekPct?: number
  monthPct?: number
  /** ~21 trading days, or Finviz 1-month performance. */
  perf1m?: number
  /** ~63 trading days, or Finviz 13-week performance. */
  perf3m?: number
  /** ~126 trading days, or Finviz 6-month performance. */
  perf6m?: number
  /** Finviz 1-year performance when the feed includes it. */
  perf1y?: number
  /** Finviz year-to-date performance when the feed includes it. */
  perfYtd?: number
  description: string
  /** Finviz industry slug (`f=ind_<slug>`). Same as `id` for Finviz rows. */
  slug?: string
  source?: 'finviz' | 'internal'
  /** Relative screener path from the Finviz payload, when present. */
  screenerUrl?: string
}

/** `GET /api/groups` payload. */
export interface GroupsResponse {
  source: 'finviz' | 'fallback'
  stale: boolean
  /** When Finviz was fetched, or when the internal fallback ranking was computed. */
  fetchedAt: string
  sourceUrl: string
  groups: IndustryGroup[]
}

/** Leading-groups period. Drives rank, Finviz `o=`, and drill-down. */
export type GroupPeriod = '1d' | '1w' | '1m' | '3m' | '6m'

/**
 * One stock from a group's Finviz performance screener (first page, ≤20).
 * `inScan` is null when the scan cache is not ready.
 */
export interface FinvizLeader {
  ticker: string
  company: string
  /** Selected-period performance percent. Null when Finviz shows "—". */
  perf: number | null
  price: number | null
  changePct: number | null
  relVolume: number | null
  avgVolume: number | null
  inScan: boolean | null
}

/** One slug inside `GET /api/groups/leaders`. */
export interface GroupLeadersEntry {
  slug: string
  period: GroupPeriod
  fetchedAt: string | null
  stale: boolean
  error?: string
  leaders: FinvizLeader[]
  /** Up to 5, best selected-period performance first. */
  top5: FinvizLeader[]
  /**
   * How many parsed rows are leaders (perf > 0 and in the current scan).
   * Null when the scan cache is not ready or the screener failed.
   */
  inScanCount: number | null
  /** Finviz rows actually parsed. Denominator for the "N/20" display. */
  parsedCount: number
}

/** `GET /api/groups/leaders?period=&slugs=` */
export interface GroupLeadersResponse {
  period: GroupPeriod
  order: string
  groups: GroupLeadersEntry[]
}

export interface GroupStockFailure {
  ticker: string
  reason: string
}

/** `GET /api/groups/:slug/stocks?period=` */
export interface GroupStocksResponse {
  slug: string
  label: string
  period: GroupPeriod
  order: string
  source: 'finviz'
  fetchedAt: string
  stale: boolean
  ideas: TradingIdea[]
  failed: GroupStockFailure[]
  /** Selected-period Finviz performance percent, keyed by ticker. Null when Finviz shows "—". */
  finvizPerf: Record<string, number | null>
  /** Rows parsed from the Finviz screener page (≤20). */
  parsedCount: number
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
  /** ~126 trading-day performance (close vs ~6 months ago). */
  perf6M: number
  /** ISO date (YYYY-MM-DD) of next earnings, if known. */
  earningsDate: string | null
  /** Trading days until next earnings (null if unknown / none in window). */
  daysToEarnings: number | null
  /** avoid = same/next trading day; alert ≈ 2 days; clear otherwise. */
  earningsStatus: EarningsStatus
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
  /** Stage-1 universe source label (yahoo-screener / predefined / emergency). */
  stage1Source?: string
  /** Stage-1 ticker count before SMA prefilter. */
  stage1Count?: number
  /** Stage 1.5 survivors (above 200 SMA AND above 50 SMA via Yahoo quotes). */
  stage15Count?: number
  /** Deep-scan shortlist size (usually == stage15Count). */
  shortlistCount?: number
  /** True when Stage-1 Yahoo failed and emergency SCAN_UNIVERSE was used. */
  emergencyFallback?: boolean
  /** Last full scan wall time in ms. */
  scanDurationMs?: number
  /** Stage-1 filter snapshot for UI/debug. */
  stage1Filters?: Record<string, unknown>
  /** Stage 1.5 SMA prefilter snapshot. */
  stage15Filters?: Record<string, unknown>
  stage15BelowSma200Count?: number
  stage15BelowSma50Count?: number
  stage15MissingSmaCount?: number
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
  /** Visible earnings proximity statuses (default: all). */
  earningsStatuses: EarningsStatus[]
  groupId: string | null
  search: string
}

export const ALL_SETUP_TYPES: SetupType[] = [
  'Range Breakout',
  'Episodic Pivot',
  'Continuation',
]

export const ALL_EARNINGS_STATUSES: EarningsStatus[] = ['clear', 'alert', 'avoid']

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
  earningsStatuses: [...ALL_EARNINGS_STATUSES],
  groupId: null,
  search: '',
}
