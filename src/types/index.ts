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
  /**
   * Membership file used for leaders and drill-down.
   * Absent when `server/data/finviz-group-members.json` is missing or invalid.
   */
  membership?: {
    source: 'snapshot'
    generatedAt: string
    /** True when `generatedAt` is older than 14 days. */
    stale: boolean
  }
}

/** Leading-groups period. Drives rank, Finviz `o=`, and drill-down. */
export type GroupPeriod = '1d' | '1w' | '1m' | '3m' | '6m'

/** One Finviz industry inside the default Stage-1 universe. */
export interface LeadingGroupRef {
  slug: string
  name: string
  /** 1-based rank on the selected period (default 1-month). */
  rank: number
  /** Unique snapshot members of this group. */
  memberCount: number
  perf3m: number | null
}

/**
 * On the scan cache and `GET /api/market/dashboard` when Stage 1 used the
 * top Finviz groups. `null` when that build failed and Yahoo ran instead.
 */
export interface LeadingGroupsMeta {
  period: GroupPeriod
  groups: LeadingGroupRef[]
  /** Symbols scanned after the Stage-1 cap. */
  symbolCount: number
  snapshotGeneratedAt: string | null
}

/**
 * One stock in a group's leader pool (top 20 snapshot members by the
 * selected period, or the live screener page when that option is on).
 * `inScan` is null when the scan cache is not ready.
 */
export interface FinvizLeader {
  ticker: string
  company: string
  /** Selected-period performance percent. Null when it cannot be computed. */
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
   * How many pool members with data are leaders (perf > 0 and in the current scan).
   * Null when the scan cache is not ready, the group is still computing, or the request failed.
   */
  inScanCount: number | null
  /** Pool members that have a real selected-period performance. Denominator for N/D. */
  parsedCount: number
  /** True while this slug still has snapshot members waiting on market data. */
  pending?: boolean
  /** Snapshot members for the slug, before the top-20 cut. */
  memberCount?: number
  /** Present on the snapshot path. `stale` means generatedAt is older than 14 days. */
  membership?: {
    source: 'snapshot'
    generatedAt: string
    stale: boolean
  }
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
  /** `snapshot` is the default. `finviz` only when FINVIZ_SCREENER_LIVE=1 succeeded. */
  source: 'finviz' | 'snapshot'
  fetchedAt: string
  stale: boolean
  ideas: TradingIdea[]
  failed: GroupStockFailure[]
  /** News-catalyst coverage for this response. Not stored in the group-stocks cache. */
  catalystMeta?: CatalystMeta
  /**
   * Selected-period performance percent, keyed by ticker.
   * Snapshot mode fills this from computed returns (same object as `perfByTicker`).
   * Null when the window cannot be computed.
   */
  finvizPerf: Record<string, number | null>
  /** Same map as `finvizPerf` on the snapshot path. */
  perfByTicker?: Record<string, number | null>
  /** Names in the ranked pool that were sent to the scorer (≤20). */
  parsedCount: number
  /** When the membership file was built. `stale` means older than 14 days. */
  membership?: {
    generatedAt: string
    stale: boolean
  }
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
  /**
   * ADR multiples above (positive) or below (negative) the 50-day SMA.
   * Canonical: (price - sma50) / (price * (adrPct / 100)).
   * Equivalent: pctAboveSma50 / adrPct when pctAboveSma50 = ((price - sma50) / price) * 100.
   * That price-relative percent is not this field's `pctAboveSma50` (SMA50 in the denominator).
   * Null when price ≤ 0, sma50 is missing/non-finite, or adrPct ≤ 0. Rounded to 2 decimals.
   */
  extensionAdr50: number | null
  setupType: SetupType
  /**
   * Display string for the top catalyst headline. The scan stores null;
   * the server fills this when it merges a checked news result.
   */
  catalyst: string | null
  /**
   * True when an important news item (or a past earnings date) falls inside
   * the rolling 48h window. Absent on older payloads; the filter then falls
   * back to a non-null `catalyst` string.
   */
  hasCatalyst?: boolean
  /** Category labels, heaviest first. */
  catalystCategories?: string[]
  catalystDirection?: 'positive' | 'negative' | 'mixed'
  catalystHeadline?: string
  catalystUrl?: string
  catalystSource?: string
  /** ISO publication time of the top item. */
  catalystAt?: string
  catalystAgeHours?: number
  catalystScore?: number
  /** Important items inside the window, including a calendar earnings hit. */
  catalystCount?: number
  /** checked = looked up; pending = candidate not finished; unchecked = not a candidate; error = lookup failed. */
  catalystStatus?: 'checked' | 'pending' | 'unchecked' | 'error'
  /**
   * Constructive setup. No catalyst required. A+ implies A.
   * See `isAHeuristic` in src/lib/metrics.ts.
   */
  isA: boolean
  /**
   * A, plus a checked catalyst, the near-ATH band, and a longer base.
   * Pending or unchecked catalyst status is not a catalyst. See `isAPlusHeuristic`.
   */
  isAPlus: boolean
  /**
   * A+ whose base is at least {@link LONG_BASE_MIN_SESSIONS} sessions
   * (max of baseLengthDays and range-base lengthSessions). See `isAPlusPlusHeuristic`.
   * Implies isAPlus and isA. Kyle score uses the A+ floor.
   */
  isAPlusPlus: boolean
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
  /**
   * Strict 10MA surfer: price rides SMA10 within an ADR-scaled distance
   * (see src/lib/surfer.ts). Distinct from `aboveSma10` (price merely above the SMA).
   */
  surfer10: boolean
  surfer20: boolean
  surfer50: boolean
  /** ADR-relative distance, near-bar count, slope, and recovery per MA. */
  surferDetail?: {
    sma10: SurferMaSnapshot
    sma20: SurferMaSnapshot
    sma50: SurferMaSnapshot
  }
  /**
   * Strict tight consolidation (see src/lib/tightConsolidation.ts).
   * Requires price above the 50-day and 200-day SMAs. Independent of surfer.
   */
  tightConsolidation: boolean
  /** Compact ratios for the Tight badge tooltip and detail panel. */
  tightDetail?: {
    rangeRatio: number
    closeSpreadPct: number
    volumeRatio: number
    days: number
    nearHigh: boolean
    aboveSma50: boolean
    aboveSma200: boolean
    failedReasons?: string[]
  }
  /**
   * Range Breakout gate values from the same pass as setupType.
   * `passed` means all five gates passed. Episodic Pivot is still applied
   * first, so `passed` can be true when setupType is Episodic Pivot.
   */
  rangeBreakoutDetail?: RangeBreakoutDetail
  /**
   * 0–1 range-base score from src/lib/rangeBase.ts.
   * 0 when the series cannot be scored. The A+ base gate can read this.
   */
  rangeBaseScore: number
  /**
   * Range-base gate values. `ok` is the constructive path used by isA.
   * `lengthSessions` is 0 when no window cleared containment, the 50 SMA
   * fraction, the band-width cap, and the minimum length.
   */
  rangeBaseDetail?: RangeBaseDetail
}

/**
 * Range base that tolerates imperfect highs and lows.
 * `compression` is recentRangePct / adrPct over the recent window (null when ADR% is not positive).
 * `containment` is the fraction of newer-half bars inside the older-half band plus ADR slack.
 * `lengthScore` is 0–1 on a log scale from a month of sessions to a year.
 */
export interface RangeBaseDetail {
  ok: boolean
  /** 0–1. Higher-low bonus included, then clamped. */
  score: number
  compression: number | null
  containment: number
  lengthSessions: number
  lengthScore: number
  above50Frac: number
  higherLows: boolean
  failedReasons: string[]
}

/** Which higher-low check passed. Half-window wins when both pass. */
export type HigherLowsRule = 'half' | 'swing'

/** Stored on the idea so the detail panel can show each Range Breakout gate. */
export interface RangeBreakoutDetail {
  adrPct: number
  aboveSma50: boolean
  priorRunPct: number
  /** (max high − min low) / latest close × 100 over recentRangeSessions. Null if it cannot be computed. */
  recentRangePct: number | null
  /** recentRangePct / adrPct. Null when ADR% is not positive. Rounded to 2 decimals; the gate uses this value. */
  rangeOverAdr: number | null
  hasHigherLows: boolean
  /** `half` when the floor rose, else `swing` when the staircase rose, else null. */
  higherLowsRule: HigherLowsRule | null
  passed: boolean
}

/** One MA on `surferDetail`. Mirrors src/lib/surfer.ts without importing it (cycle). */
export interface SurferMaSnapshot {
  ok: boolean
  distancePct: number
  distanceAdr: number
  nearBars: number
  windowBars: number
  minDistancePct: number
  maxCloseBelowPct: number
  recovered: boolean
  slopePct: number
  adrPct: number
  proximityPct: number
  reason?: string
}

/** Coverage of the 48h catalyst lookup. Attached at response time, not in the scan file. */
export interface CatalystMeta {
  checked: number
  pending: number
  failed: number
  unchecked: number
  candidates: number
  asOf: string
  windowHours: number
  finnhubCalls: number
  yahooCalls: number
  maxFinnhubCallsPer60s: number
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
  /** Stage-1 universe source (`leading-groups-top12`, Yahoo, or emergency). */
  stage1Source?: string
  /**
   * Top Finviz groups used as the Stage-1 universe.
   * `null` when that build failed and the Yahoo path ran.
   */
  leadingGroupsMeta?: LeadingGroupsMeta | null
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
  /** Catalyst lookup coverage for the ideas in this payload. */
  catalystMeta?: CatalystMeta
}


/** Near-highs presets (percent under the 52-week high). `null` on the filter is Any. */
export const NEAR_HIGHS_PRESETS = [5, 8, 10, 15, 20] as const

export type NearHighsPreset = (typeof NEAR_HIGHS_PRESETS)[number]

/** Max ADR extension from 50 SMA presets. `null` on the filter is Any (no filter). Includes 4 for the group-view default. */
export const MAX_EXTENSION_ADR50_PRESETS = [5, 4, 3, 2, 1] as const

export type MaxExtensionAdr50Preset = (typeof MAX_EXTENSION_ADR50_PRESETS)[number]

export interface IdeaFilters {
  minRvol: number
  /**
   * Hide names whose average dollar volume (close × volume over the prior
   * 20 sessions, excluding the latest bar) is below this many dollars.
   * `0` hides nothing. A missing average on the row is kept.
   * Normal scan default is {@link DEFAULT_MIN_AVG_DOLLAR_VOL}. Group view uses the same floor.
   */
  minAvgDollarVol: number
  /**
   * Hide names whose distance under the 52-week high is above this percent.
   * Distance is abs(min(0, pctFrom52wHigh)); a print above the high counts as 0.
   * `null` is Any (no filter). Presets: 5, 8, 10, 15, 20.
   */
  maxPctFromHigh: number | null
  /**
   * Hide names whose ADR extension from the 50 SMA is above this threshold.
   * `null` is Any (no filter). When T is set, rows with extensionAdr50 != null
   * AND extensionAdr50 > T are excluded. Null/unknown extensions are kept.
   * Negative extensions (below the 50 SMA) always pass.
   */
  maxExtensionAdr50: number | null
  setupTypes: SetupType[]
  /**
   * Keep rows with `isA`. Off by default.
   * Combined with `requireAPlus` and `requireAPlusPlus` as a union: a row
   * stays if it matches any selected tier. All off means no quality filter.
   * A+ implies A, and A++ implies A+, so the wider chip already includes
   * the stricter tier.
   */
  requireA: boolean
  /**
   * Keep rows with `isAPlus` (includes A++). Off by default.
   * A stored `aPlusOnly: true` migrates here.
   */
  requireAPlus: boolean
  /**
   * Keep rows with `isAPlusPlus` only. Off by default.
   * The A+ chip still keeps these rows because isAPlus stays true.
   */
  requireAPlusPlus: boolean
  hasCatalyst: boolean
  /**
   * Above 200 DMA: require price above the 200-day SMA (`aboveSma200`).
   * Default ON. Older stored objects that omit this field are treated as ON.
   */
  requireAbove200: boolean
  /** Soft prefer: require price above 50-day SMA (default ON in the normal scan). */
  requireSma50: boolean
  /** Optional: require price above 10-day SMA (loose; not a strict ride). */
  requireSma10: boolean
  /** Optional: require price above 20-day SMA (loose; not a strict ride). */
  requireSma20: boolean
  /** Optional: require strict 10MA surfer (`surfer10`). Default off. */
  requireSurfer10: boolean
  /** Optional: require strict 20MA surfer (`surfer20`). Default off. */
  requireSurfer20: boolean
  /** Optional: require strict 50MA surfer (`surfer50`). Default off. */
  requireSurfer50: boolean
  /** Optional: require strict tight consolidation (`tightConsolidation`). Default off. */
  requireTight: boolean
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

/** Normal-scan floor for average dollar volume (20 sessions of close × volume). */
export const DEFAULT_MIN_AVG_DOLLAR_VOL = 30_000_000

/** Group-view cap on ADR extension from the 50 SMA. Selectable in {@link MAX_EXTENSION_ADR50_PRESETS}. */
export const GROUP_VIEW_MAX_EXTENSION_ADR50 = 4

export const DEFAULT_FILTERS: IdeaFilters = {
  minRvol: 0,
  /** $30M. Group view uses the same floor. */
  minAvgDollarVol: DEFAULT_MIN_AVG_DOLLAR_VOL,
  maxPctFromHigh: null,
  /**
   * Hide a known extensionAdr50 above 5. Null extensions stay.
   * Group view uses {@link GROUP_VIEW_MAX_EXTENSION_ADR50} instead.
   */
  maxExtensionAdr50: 5,
  /** Episodic Pivot and Continuation start off. Group view keeps every label. */
  setupTypes: ['Range Breakout'],
  requireA: false,
  requireAPlus: false,
  requireAPlusPlus: false,
  hasCatalyst: false,
  requireAbove200: true,
  requireSma50: true,
  requireSma10: false,
  requireSma20: false,
  requireSurfer10: false,
  requireSurfer20: false,
  requireSurfer50: false,
  requireTight: false,
  stages: ['coiled', 'triggering'],
  earningsStatuses: [...ALL_EARNINGS_STATUSES],
  groupId: null,
  search: '',
}

/**
 * Baseline while a Finviz group is selected.
 * Same gates as {@link DEFAULT_FILTERS} except stage and SMA10/20/50 do not
 * hide members. Above 200 DMA stays on. Min DolVol uses
 * {@link DEFAULT_MIN_AVG_DOLLAR_VOL}. Max ADR extension from 50 SMA is
 * {@link GROUP_VIEW_MAX_EXTENSION_ADR50}.
 *
 * Group-view filters are not persisted (`qm.scanFilters.v2` stores the normal
 * scan only). Opening or changing a group resets this object via
 * applyFilterChange, so no storage migration is needed.
 */
export const GROUP_VIEW_DEFAULT_FILTERS: IdeaFilters = {
  ...DEFAULT_FILTERS,
  /** $30M floor, same as {@link DEFAULT_MIN_AVG_DOLLAR_VOL}. */
  minAvgDollarVol: DEFAULT_MIN_AVG_DOLLAR_VOL,
  /**
   * Hide a known extensionAdr50 above {@link GROUP_VIEW_MAX_EXTENSION_ADR50}.
   * Null extensions stay. The normal scan default is 5.
   */
  maxExtensionAdr50: GROUP_VIEW_MAX_EXTENSION_ADR50,
  requireA: false,
  requireAPlus: false,
  requireAPlusPlus: false,
  requireAbove200: true,
  requireSma50: false,
  requireSma10: false,
  requireSma20: false,
  requireSurfer10: false,
  requireSurfer20: false,
  requireSurfer50: false,
  requireTight: false,
  stages: ['watching', 'coiled', 'triggering'],
  setupTypes: [...ALL_SETUP_TYPES],
  earningsStatuses: [...ALL_EARNINGS_STATUSES],
}
