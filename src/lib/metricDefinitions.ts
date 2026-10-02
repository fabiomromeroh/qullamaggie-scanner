/**
 * Single source for metric tooltip copy. Numbers are interpolated from the
 * same constants the scanners use. Add a metric by extending {@link METRIC_DEFS},
 * then render it with `<MetricTip id="...">` or `{...metricTipAttrs('...')}`.
 */
import { AUTO_ADD_MIN_KYLE_SCORE, STAGE_CONFIG } from './setupStage'
import { SURFER_CONFIG, type MaKey } from './surfer'
import { TIGHT_CONFIG } from './tightConsolidation'
import {
  APLUS_CONFIG,
  BAR_WINDOWS,
  BASE_LENGTH_PROXY,
  EARNINGS_PROXIMITY,
  KYLE_SCORE_CONFIG,
  NEAR_ATH_PCT,
  PRIOR_RUN_PROXY,
  REGIME_CONFIG,
  SETUP_TYPE_CONFIG,
  SMA_PERIODS,
  TIGHT_DAYS_PROXY,
} from './metrics'
import {
  FALLBACK_LEADER_NEAR_HIGH_PCT,
  FINVIZ_GROUPS_CACHE_MS,
  GROUP_PERIODS,
  GROUPS_POLL_MS,
  MEMBERSHIP_STALE_DAYS,
} from './groupPeriod'
import { LEADER_POOL_SIZE, PERIOD_SESSIONS } from './memberPerf'
import { SCAN_MIN_AVG_VOL_DEFAULT, SCAN_MIN_PRICE_DEFAULT, SCAN_STAGE1_CAP_DEFAULT, SCAN_STAGE1_PAGE_SIZE } from './scanDefaults'
import { DEFAULT_FILTERS } from '../types'
import type { GroupPeriod } from '../types'

export interface MetricDef {
  label: string
  /** One line, shown under the label. */
  short: string
  /** How it is calculated. One to three sentences. */
  how: string
  /** Caveats, filter behavior, or thresholds that do not fit in `how`. */
  notes?: string
}

function d(label: string, short: string, how: string, notes?: string): MetricDef {
  return notes ? { label, short, how, notes } : { label, short, how }
}

const SURFER_PERIOD: Record<MaKey, number> = {
  sma10: SMA_PERIODS.sma10,
  sma20: SMA_PERIODS.sma20,
  sma50: SMA_PERIODS.sma50,
}

/** Strict ride-the-MA rule for one average. Numbers come from {@link SURFER_CONFIG}. */
export function surferRuleText(key: MaKey): string {
  const period = SURFER_PERIOD[key]
  const window = SURFER_CONFIG.windowSessions[key]
  const touches = SURFER_CONFIG.minTouches[key]
  const slope = SURFER_CONFIG.slopeLookback[key]
  return `Over the last ${window} sessions, every close must stay within ${SURFER_CONFIG.closeBreakTolerancePct}% under that bar's ${period}-day SMA (the average of the ${period} closes ending on the bar). A touch is a low at most ${SURFER_CONFIG.touchProximityPct}% above the SMA, or through it, with the high still reaching the SMA; consecutive touches are one episode and at least ${touches} are required. Each closed episode must bounce within ${SURFER_CONFIG.bounceSessions} sessions (close above the SMA and above the touch close), the latest close must be above the SMA, and the SMA must be strictly higher than ${slope} sessions ago.`
}

/** Strict contraction rule. Numbers come from {@link TIGHT_CONFIG}. */
export function tightRuleText(): string {
  const c = TIGHT_CONFIG
  return `All of these must pass over the last ${c.recentWindow} sessions versus the prior ${c.baselineSessions}: average daily range% ratio <= ${c.rangeRatioMax}, close-to-close spread ((max close − min close) / min close × 100) <= min(${c.closeSpreadMaxMultipleOfAdr} × baseline ADR%, ${c.closeSpreadAbsMaxPct}%), and average volume / the trailing ${c.volumeAvgSessions}-session average <= ${c.volumeRatioMax}. Price must also sit within ${c.nearHighMaxPct}% of the ${c.highLookback}-session high (pctFrom52wHigh >= -${c.nearHighMaxPct}) and above both SMA${c.smaFast} and SMA${c.smaSlow}.`
}

/** Stage rule. Numbers come from {@link STAGE_CONFIG}. */
export function stageRuleText(stage: 'watching' | 'coiled' | 'triggering'): string {
  const s = STAGE_CONFIG
  if (stage === 'triggering') {
    return `Triggering when price is above the 200-day SMA and any path hits: RVOL >= ${s.triggerRvolNearHigh} with pctFrom52wHigh >= -${s.nearHighPct} and day% >= ${s.triggerDayPctNearHigh}; or RVOL >= ${s.triggerRvolStrong} and day% >= ${s.triggerDayPctStrong}; or RVOL >= ${s.triggerRvolTight} with pctFrom52wHigh >= -${s.nearHighTightPct} and day% >= ${s.triggerDayPctTight}. This is tested before coiled. Names that are not above the 200-day SMA are not staged.`
  }
  if (stage === 'coiled') {
    return `Coiled when not triggering and either rule matches. Legacy: tightDays >= ${s.coiledTightDaysMin}, pctFrom52wHigh >= -${s.nearHighPct}, price above SMA${SMA_PERIODS.sma10} or SMA${SMA_PERIODS.sma20} (loose flags), and (priorRunPct >= ${s.coiledPriorRunMin} or pctFrom52wHigh >= -${s.nearHighTightPct}). Tight route, because TIGHT_CONFIG.useInCoiled is ${TIGHT_CONFIG.useInCoiled}: tightConsolidation and pctFrom52wHigh >= -${s.nearHighPct}.`
  }
  return `Watching when price is above the 200-day SMA and the name is neither triggering nor coiled. setupStageHeuristic returns null when price is not above that SMA, so the badge then reads Below 200 instead of a stage.`
}

/** A+ gate. Numbers come from {@link APLUS_CONFIG}. */
export function aPlusRuleText(): string {
  const a = APLUS_CONFIG
  return `isAPlusHeuristic fails when earningsStatus is avoid, when price is not above both the ${SMA_PERIODS.sma200}- and ${SMA_PERIODS.sma50}-day SMAs, or when ADR% < ${a.adrMin}. It passes when pctFrom52wHigh >= -${a.nearHighPct} and (RVOL >= ${a.rvolOrRunRvol} or priorRunPct >= ${a.rvolOrRunPrior}), or when pctFrom52wHigh >= -${a.nearHighSoftPct}, that same volume-or-run test, price is above SMA${SMA_PERIODS.sma10} or SMA${SMA_PERIODS.sma20}, and RVOL >= ${a.softPathRvol}. The surfer test here is the loose above-SMA flags, not the strict ride. Not a signal and not Kyle's official Rating.`
}

/** Point build. Numbers come from {@link KYLE_SCORE_CONFIG}. */
export function kyleScoreRuleText(): string {
  const k = KYLE_SCORE_CONFIG
  return `Returns ${k.below200Score} when price is not above the 200-day SMA. Otherwise it starts at ${k.base} and adds ${k.aboveSma50} above SMA${SMA_PERIODS.sma50}, ${k.aboveSma20} above SMA${SMA_PERIODS.sma20}, ${k.aboveSma10} above SMA${SMA_PERIODS.sma10}, ${k.nearHighPoints} when pctFrom52wHigh >= -${k.nearHighPct} (else ${k.nearHighSoftPoints} when >= -${k.nearHighSoftPct}), ${k.rvolHighPoints} when RVOL >= ${k.rvolHigh} (else ${k.rvolMidPoints} when >= ${k.rvolMid}), ${k.priorRunHighPoints} when priorRunPct >= ${k.priorRunHigh} (else ${k.priorRunMidPoints} when >= ${k.priorRunMid}), and ${k.adrPoints} when ADR% is from ${k.adrMin} through ${k.adrMax}. An A+ result is lifted to at least ${k.aPlusFloor}, then the score is rounded to 2 decimals and clamped to ${k.clampMin}–${k.clampMax}.`
}

function rvolHow(): string {
  const n = BAR_WINDOWS.rvolSessions
  return `Latest bar volume divided by the average volume of the prior ${n} sessions (bars.slice(-${n + 1}, -1), latest bar excluded). Zero when that average is 0.`
}

function adrHow(): string {
  const n = BAR_WINDOWS.adrSessions
  return `Mean of (high − low) / close × 100 over the prior ${n} sessions, excluding the latest bar. A non-positive close contributes 0.`
}

function highHow(): string {
  const n = BAR_WINDOWS.high52Sessions
  return `(price / maximum high of the last ${n} sessions − 1) × 100. Negative means below that high. A non-positive high yields 0.`
}

function dayHow(): string {
  return `Day% is (price / previous regular-session close − 1) × 100. resolvePrevClose picks the close of the session before the one that printed price. Yahoo chartPreviousClose on a 1-year chart is the close before that range, about a year ago, and is not used.`
}

function perfHow(label: string, sessions: number): string {
  return `${label} is (price / close ${sessions} sessions earlier − 1) × 100. The anchor is bars[max(0, length − 1 − ${sessions})].c.`
}

function dolHow(): string {
  const n = BAR_WINDOWS.dolVolSessions
  return `Average of close × volume over the prior ${n} sessions, excluding the latest bar. The cell formats that average with K, M, or B.`
}

function smaHow(period: number): string {
  return `Simple average of the last ${period} closes. "Above" means price > that average, so a price equal to the average is not above. Distance percent is (price / SMA − 1) × 100.`
}

function priorRunHow(): string {
  const p = PRIOR_RUN_PROXY
  return `Lowest low in the ${p.runLookback} sessions before the recent ${p.baseLookback}-session base, then percent from that low to the base high. With fewer than run + base + ${p.minExtraBars} bars, it uses percent from the low ${p.shortHistoryOffset} sessions back to the latest high. Proxy only, not Kyle's Inc%.`
}

function tightDaysHow(): string {
  const t = TIGHT_DAYS_PROXY
  return `In the last ${t.lookback} sessions, count days whose (high − low) / close is below ${t.rangeFactor} × that window's average range, or whose close is within ${t.maProximityPct}% of that bar's SMA${SMA_PERIODS.sma10} or SMA${SMA_PERIODS.sma20}. Returns 0 when history is shorter than lookback + ${t.historyExtra}. This is not the strict tight-consolidation flag.`
}

function baseLengthHow(): string {
  const b = BASE_LENGTH_PROXY
  return `Trailing streak of sessions whose (high − low) / close is below ${b.rangeFactor} × the mean range of a window of up to ${b.maxLookback} sessions (length min(maxLookback, bars − ${b.historyReserve})). Returns 0 below ${b.minBars} bars. The MA-proximity test used by tight days is not applied.`
}

function earningsHow(): string {
  const e = EARNINGS_PROXIMITY
  return `classifyEarningsProximity counts weekdays from today to the earnings date (weekends skipped, exchange holidays not). avoid when that count is <= ${e.avoidMaxTradingDays} (same day is 0, next trading day is 1). alert when the count is ${e.alertTradingDays}. clear when the date is further out, missing, or already past.`
}

function regimeHow(): string {
  const r = REGIME_CONFIG
  return `Needs at least ${r.minBars} QQQ daily bars. 10>20 is ON when SMA${SMA_PERIODS.sma10} > SMA${SMA_PERIODS.sma20}. ST is Uptrend when price > SMA${SMA_PERIODS.sma50} and the SMA50 slope over ${r.slopeLookbackSessions} sessions is >= ${r.upSlopeMinPct}%, Downtrend when price < SMA${SMA_PERIODS.sma50} and the slope is <= ${r.downSlopeMaxPct}%, otherwise Sideways. Slope is (SMA50 now / SMA50 after dropping the last ${r.slopeLookbackSessions} closes − 1) × 100.`
}

function setupTypeHow(): string {
  const s = SETUP_TYPE_CONFIG
  return `Episodic Pivot when RVOL >= ${s.episodicRvol} and day% >= ${s.episodicDayPct}. Otherwise Range Breakout when pctFrom52wHigh >= -${s.rangeHighPct} and RVOL >= ${s.rangeRvol}. Otherwise Continuation.`
}

const FINVIZ_PERF: Record<GroupPeriod, string> = {
  '1d': 'perfT (today change), stored as dayPct',
  '1w': 'perfW (Perf Week), stored as weekPct',
  '1m': 'perfM (Perf Month), stored as perf1m',
  '3m': 'perfQ (Perf Quart, 13-week), stored as perf3m',
  '6m': 'perfH (Perf Half), stored as perf6m',
}

const FALLBACK_PERF: Record<GroupPeriod, string> = {
  '1d': "the average of scan members' dayPct",
  '1w': "the average of scan members' 1-month performance divided by 4 (not a 5-session return)",
  '1m': `the average of scan members' perf1M (${BAR_WINDOWS.perf1mSessions} sessions)`,
  '3m': `the average of scan members' perf3M (${BAR_WINDOWS.perf3mSessions} sessions)`,
  '6m': `the average of scan members' perf6M (${BAR_WINDOWS.perf6mSessions} sessions)`,
}

function groupColumn(period: GroupPeriod): MetricDef {
  const meta = GROUP_PERIODS[period]
  const sessions = PERIOD_SESSIONS[period]
  const member =
    period === '1d'
      ? 'price / prevClose − 1, with prevClose from resolvePrevClose'
      : `price versus the close ${sessions} completed sessions before the price session`
  return d(
    meta.label,
    `Group ${meta.label} performance.`,
    `Finviz groups page field ${FINVIZ_PERF[period]}. Screener order token is ${meta.order}. The internal fallback writes this field as ${FALLBACK_PERF[period]}. Leader and drill-down member returns use ${member}.`,
    `Selecting ${meta.label} re-ranks with rankGroups (this field descending, then ${meta.tieBreak.join(', ')}), saves localStorage qm-groups-period, and reloads leaders plus an open drill-down. Finviz week/month/quarter/half windows are about 5/20/65/130 sessions, so member figures (${PERIOD_SESSIONS['1w']}/${PERIOD_SESSIONS['1m']}/${PERIOD_SESSIONS['3m']}/${PERIOD_SESSIONS['6m']}) can differ by a few points. 1W has no table column.`,
  )
}

function chartSma(period: number): MetricDef {
  return d(
    `SMA ${period}`,
    `Toggle the ${period}-session average line.`,
    `smaSeries is the average of the last ${period} closes on the daily bars loaded for this chart. The first ${period - 1} points are null. The chip shows or hides that line. Same average as the scan's SMA${period}.`,
  )
}

const looseAboveNote = (period: number, flag: string) =>
  `The FiltersBar chip keeps rows where ${flag} is true (price > SMA${period}). It does not require the strict surfer. Default for the 50-day chip on a normal scan is ${DEFAULT_FILTERS.requireSma50 ? 'on' : 'off'}; 10- and 20-day chips default off. Group view does not require them.`

const stageChipNote = (stage: string) =>
  `The stage chip includes or excludes "${stage}". Clearing the last chip selects every stage again. A normal scan starts on coiled and triggering; group view starts with every stage.`

const setupChipNote = (name: string) =>
  `The setup-type chip includes or excludes ${name}. Clearing the last chip selects every setup type again.`

const earningsChipNote = (status: string) =>
  `The earnings chip includes or excludes status "${status}". Clearing the last chip selects every status again.`

export const METRIC_DEFS = {
  ticker: d(
    'Ticker',
    'Symbol on the scan row.',
    'The ticker string from the scan or group drill-down. It is not a calculated metric.',
  ),
  name: d(
    'Name',
    'Company name on the row.',
    'Quote long or short name when the feed sent one, otherwise the name stored with the universe entry.',
  ),
  ideaGroup: d(
    'Group',
    'Industry label on the idea.',
    'Yahoo sector/industry when the scan resolved one, otherwise the static WATCHLIST_GROUPS name for a known ticker. This is the idea\'s group, not the Finviz groups-table rank.',
  ),
  price: d(
    'Price',
    'Last price used for every percent.',
    'snap.price when the quote price differs from the last daily bar, otherwise that bar\'s close. Rounded to cents in the idea payload.',
  ),
  dayPct: d('Day%', 'Session change versus the prior close.', dayHow(), 'Ideas table, detail, watchlist, and the chart header all use this field.'),
  rvol: d(
    'RVOL',
    'Last volume versus the prior 20 sessions.',
    rvolHow(),
    `Finviz relative volume uses about a 3-month average, so these values differ, and an intraday print is not scaled up. The Min RVOL box hides ideas with rvol below the number; a blank input is stored as ${DEFAULT_FILTERS.minRvol}. The amber cell color starts at RVOL >= ${KYLE_SCORE_CONFIG.rvolHigh}.`,
  ),
  adrPct: d('ADR%', 'Average daily range of the prior sessions.', adrHow()),
  pctFrom52wHigh: d(
    '% from 52w high',
    'Distance from the 252-session high.',
    highHow(),
    `Near ATH in characteristics is pctFrom52wHigh >= -${NEAR_ATH_PCT}. The ideas cell turns green when the absolute value is within ${NEAR_ATH_PCT}.`,
  ),
  perf1m: d('1M', 'Idea return over about one month.', perfHow('1M', BAR_WINDOWS.perf1mSessions)),
  perf3m: d('3M', 'Idea return over about three months.', perfHow('3M', BAR_WINDOWS.perf3mSessions), 'The detail sparkline is green when this value is >= 0.'),
  perf6m: d('6M', 'Idea return over about six months.', perfHow('6M', BAR_WINDOWS.perf6mSessions)),
  aboveSma200: d(
    'Above 200 SMA',
    'Hard trend gate.',
    smaHow(SMA_PERIODS.sma200),
    'Below-200 names are not valid setups. The Above 200 DMA chip (requireAbove200, default on) drops them. A normal scan also drops them in Stage 1.5 before they are scored, so turning the chip off only reveals names that are actually in the payload. Group view includes below-200 members and the chip hides them until it is turned off.',
  ),
  belowSma200: d(
    'Below 200 SMA',
    'Fails the hard trend gate.',
    `Shown when aboveSma200 is false, which is price <= the ${SMA_PERIODS.sma200}-day SMA (price > average is the only pass). The characteristic tag is Below 200MA. setupStageHeuristic returns null, and the stage badge reads Below 200.`,
  ),
  aboveSma50: d(
    'Above 50 SMA',
    'Loose price versus the 50-day average.',
    smaHow(SMA_PERIODS.sma50),
    looseAboveNote(SMA_PERIODS.sma50, 'aboveSma50'),
  ),
  aboveSma10: d(
    'Above 10 SMA',
    'Loose price versus the 10-day average.',
    smaHow(SMA_PERIODS.sma10),
    `${looseAboveNote(SMA_PERIODS.sma10, 'aboveSma10')} Strict riding is the 10MA Surfer chip.`,
  ),
  aboveSma20: d(
    'Above 20 SMA',
    'Loose price versus the 20-day average.',
    smaHow(SMA_PERIODS.sma20),
    `${looseAboveNote(SMA_PERIODS.sma20, 'aboveSma20')} Strict riding is the 20MA Surfer chip.`,
  ),
  pctAboveSma200: d(
    'vs 200 SMA',
    'Percent the price sits above or below SMA200.',
    smaHow(SMA_PERIODS.sma200),
  ),
  pctAboveSma50: d(
    'vs 50 SMA',
    'Percent the price sits above or below SMA50.',
    smaHow(SMA_PERIODS.sma50),
  ),
  sma200: d('SMA200', '200-session average of closes.', smaHow(SMA_PERIODS.sma200)),
  sma50: d('SMA50', '50-session average of closes.', smaHow(SMA_PERIODS.sma50)),
  sma10: d('SMA10', '10-session average of closes.', smaHow(SMA_PERIODS.sma10)),
  sma20: d('SMA20', '20-session average of closes.', smaHow(SMA_PERIODS.sma20)),
  surfer10: d(
    '10MA Surfer',
    'Strict ride of the 10-day SMA.',
    surferRuleText('sma10'),
    'Badge 10S. The strict filter keeps rows where surfer10 is true. Price merely above the SMA is the Above 10 SMA chip. Points in kyleScore still use the loose flag.',
  ),
  surfer20: d(
    '20MA Surfer',
    'Strict ride of the 20-day SMA.',
    surferRuleText('sma20'),
    'Badge 20S. The strict filter keeps rows where surfer20 is true. Price merely above the SMA is the Above 20 SMA chip.',
  ),
  surfer50: d(
    '50MA Surfer',
    'Strict ride of the 50-day SMA.',
    surferRuleText('sma50'),
    'Badge 50S. The strict filter keeps rows where surfer50 is true. The 50-day window asks for fewer touches because a slow average rarely prints three clean tests.',
  ),
  nearAth: d(
    'Near ATH',
    'Within a few percent of the 52-week high.',
    `Characteristic "near ATH" when pctFrom52wHigh >= -${NEAR_ATH_PCT}. The percent itself is ${highHow()}`,
  ),
  surferColumn: d(
    'Surfer column',
    'Strict surfer badges, near ATH, and Tight.',
    `10S, 20S, and 50S are the strict surfer flags. ATH is near ATH (within ${NEAR_ATH_PCT}%). Tight is the strict consolidation flag, separate from the tight-days count.`,
  ),
  tightConsolidation: d(
    'Tight consolidation',
    'Range and volume contraction near the highs.',
    tightRuleText(),
    'The Tight badge and the Tight consolidation chip use this flag (requireTight). It is independent of the tightDays proxy. When useInCoiled is on, a pass near the highs is an extra coiled route.',
  ),
  tightRangeRatio: d(
    'Range contraction',
    'Recent range versus the baseline range.',
    `recent ${TIGHT_CONFIG.recentWindow}-session average of (high−low)/close, divided by the same average over the prior ${TIGHT_CONFIG.baselineSessions} sessions. Passes at <= ${TIGHT_CONFIG.rangeRatioMax}.`,
  ),
  tightVolumeRatio: d(
    'Volume ratio',
    'Recent volume versus the longer average.',
    `Average volume of the last ${TIGHT_CONFIG.recentWindow} sessions divided by the average of the last ${TIGHT_CONFIG.volumeAvgSessions} sessions (the recent window is included in that average). Passes at <= ${TIGHT_CONFIG.volumeRatioMax}.`,
  ),
  tightCloseSpread: d(
    'Close spread',
    'How far closes drifted inside the window.',
    `Over the last ${TIGHT_CONFIG.recentWindow} closes, (max − min) / min × 100. The cap is the minimum of ${TIGHT_CONFIG.closeSpreadMaxMultipleOfAdr} × baseline ADR% and ${TIGHT_CONFIG.closeSpreadAbsMaxPct}%.`,
  ),
  tightWindowDays: d(
    'Tight window',
    'How many sessions the contraction looks at.',
    `The recent window is ${TIGHT_CONFIG.recentWindow} sessions (TIGHT_CONFIG.recentWindow). The stored detail.days is that same length.`,
  ),
  tightNearHigh: d(
    'Near 52-week high',
    'Tight rule distance from the high.',
    `${highHow()} The tight rule passes this part when the percent is >= -${TIGHT_CONFIG.nearHighMaxPct}.`,
  ),
  tightAboveMas: d(
    'Above SMA10 and SMA20',
    'Loose moving-average half of the tight rule.',
    `Price must be above both SMA${TIGHT_CONFIG.smaFast} and SMA${TIGHT_CONFIG.smaSlow}. These are the loose comparisons, not the strict surfer flags.`,
  ),
  priorRunPct: d(
    'Prior run%',
    'Percent from the prior low into the base high.',
    priorRunHow(),
  ),
  tightDays: d('Tight days', 'Sessions that were quiet or pinned to a short SMA.', tightDaysHow(), 'The cell prints tightDays/baseLengthDays. The number after the slash is base length.'),
  baseLengthDays: d('Base length', 'Trailing streak of narrow-range days.', baseLengthHow()),
  dolVol: d('DolVol', 'Average dollar volume.', dolHow()),
  setupType: d(
    'Setup type',
    'Episodic Pivot, Range Breakout, or Continuation.',
    setupTypeHow(),
    'Checked in that order. The chips under Setup type toggle which labels stay visible.',
  ),
  setupRangeBreakout: d('Range Breakout', 'Near the highs with some volume.', setupTypeHow(), setupChipNote('Range Breakout')),
  setupEpisodicPivot: d('Episodic Pivot', 'Wide day with heavy relative volume.', setupTypeHow(), setupChipNote('Episodic Pivot')),
  setupContinuation: d('Continuation', 'Everything that is not the other two labels.', setupTypeHow(), setupChipNote('Continuation')),
  setupStage: d(
    'Setup stage',
    'Watching, coiled, or triggering.',
    `Order is triggering, then coiled, then watching, and only when price is above the 200-day SMA. ${stageRuleText('triggering')} ${stageRuleText('coiled')} ${stageRuleText('watching')}`,
  ),
  stageWatching: d('Watching', 'Above the 200-day SMA, not yet coiled.', stageRuleText('watching'), stageChipNote('watching')),
  stageCoiled: d('Coiled', 'Tight and near the highs, or strict contraction.', stageRuleText('coiled'), stageChipNote('coiled')),
  stageTriggering: d('Triggering', 'Elevated RVOL on a breakout-style day.', stageRuleText('triggering'), stageChipNote('triggering')),
  kyleScore: d(
    'kyleScore',
    'Heuristic quality score, not the official Rating.',
    kyleScoreRuleText(),
    'Surfer additions use loose above-SMA10/20 flags. Auto-add to the watchlist requires this score >= ' +
      String(AUTO_ADD_MIN_KYLE_SCORE) +
      ' and a coiled or triggering stage.',
  ),
  aPlus: d(
    'A+',
    'Heuristic A+ flag.',
    aPlusRuleText(),
    'The A+ only chip keeps rows where isAPlus is true. An earnings avoid status forces the flag off and the cell shows AVOID instead.',
  ),
  earningsStatus: d(
    'Earnings',
    'How close the next report is.',
    earningsHow(),
    'AVOID is a hard fail for the A+ flag. The column badge prints the status or the trading-day count.',
  ),
  earningsAvoid: d('Earnings avoid', 'Same day or next trading day.', earningsHow(), earningsChipNote('avoid')),
  earningsAlert: d('Earnings alert', 'Two trading days out.', earningsHow(), earningsChipNote('alert')),
  earningsClear: d('Earnings clear', 'Further out, unknown, or already reported.', earningsHow(), earningsChipNote('clear')),
  catalyst: d(
    'Catalyst',
    'Hand-entered reason, never filled by the APIs.',
    'The scan stores null. The Has catalyst chip keeps rows where catalyst is non-null. Earnings and GAP characteristic tags are added only when this text matches earnings/eps or gap/gapped.',
  ),
  charEarnings: d(
    'Earnings tag',
    'Catalyst text mentions earnings.',
    'Added only when the catalyst matches /\\bearnings?\\b|\\beps\\b/i. An empty catalyst never invents the tag.',
  ),
  charGap: d(
    'GAP tag',
    'Catalyst text mentions a gap.',
    'Added only when the catalyst matches /\\bgap\\b|\\bgapped?\\b/i. An empty catalyst never invents the tag.',
  ),
  sparkline: d(
    'Sparkline',
    'Recent daily closes.',
    `The last ${BAR_WINDOWS.sparkSessions} closes, rounded to cents. The line is red when 3M performance is negative and green otherwise.`,
  ),
  trendGate: d(
    'Trend gate',
    'The four loose above-SMA flags.',
    `aboveSma200/50/20/10 are price > SMA${SMA_PERIODS.sma200}/${SMA_PERIODS.sma50}/${SMA_PERIODS.sma20}/${SMA_PERIODS.sma10}. Strict surfers are separate booleans.`,
  ),
  whyQualifies: d(
    'Why it qualifies',
    'Sentence rewritten from the same gates.',
    'avoid earnings replaces the sentence with the hard-fail line. Otherwise an A+ pass uses the A+ summary, a name above the 200-day SMA uses the watchlist line, and a name at or under that SMA uses the Below 200MA line.',
  ),
  ideaNotes: d(
    'Notes',
    'Provider note stored on the idea.',
    'Live scans store which provider produced the bars and that the catalyst was left blank. It is not a second score.',
  ),
  filterSearch: d(
    'Search',
    'Substring match across the row.',
    'Case-insensitive includes() over ticker, name, group name, setup stage, and the characteristic tags joined with spaces. An empty box matches everything.',
  ),
  filterMinRvol: d(
    'Min RVOL',
    'Hide names under a relative-volume floor.',
    `${rvolHow()} passesFilters drops the row when rvol < minRvol.`,
    `A blank or non-numeric input is stored as ${DEFAULT_FILTERS.minRvol}, which hides nothing. Finviz uses about a 3-month average, so this RVOL will not match Finviz.`,
  ),
  filterMaxPctFromHigh: d(
    'Max % from highs',
    'Hide names too far under the high.',
    `${highHow()} The filter distance is the absolute value of min(0, pctFrom52wHigh), so a print above the high counts as 0. Rows with distance > maxPctFromHigh are hidden.`,
    `The box default is ${DEFAULT_FILTERS.maxPctFromHigh}.`,
  ),
  filterGroup: d(
    'Group filter',
    'Keep one industry, or all of them.',
    'All groups clears groupId. On a normal scan, a chosen id keeps ideas with that groupId. When the groups source is Finviz, the match is normalized name equality (ideaMatchesFinvizGroup: lowercase, non-alphanumerics removed) against the group id, slug, and name — not a substring. Changing the selection resets group-view filters to the group baseline and does not copy those fields onto the scan filters.',
  ),
  filterReset: d(
    'Reset filters',
    'Put the chips back to the baseline.',
    'applyFilterReset restores the scan filters to DEFAULT_FILTERS but keeps the current groupId, and restores group-view filters to the group baseline (every stage, Above 200 DMA still on, 10/20/50 and strict surfer/tight not required). It does not start a new scan.',
  ),
  filterShowAll: d(
    'Show all group members',
    'Drop the group-view gates, including below the 200-day SMA.',
    'applyShowAllGroup replaces group filters with every stage, every setup type, every earnings status, Above 200 DMA off, SMA and surfer and tight requirements off, min RVOL 0, max percent from high 100, A+ only off, catalyst off, and search cleared. Scan filters are left as they are.',
  ),
  filterActiveCount: d(
    'Active filters',
    'How many controls differ from the baseline.',
    'countActiveFilters increments once per field that differs from the baseline: search, min RVOL, max % from high, group, setup types, stages, each SMA / surfer / tight / Above 200 DMA flag, earnings statuses, A+ only, and catalyst. The baseline is the normal defaults, or the group-view baseline while a group is open. Above 200 DMA counts when it is off against a baseline that has it on.',
  ),
  watchlistPin: d(
    'Pin',
    'Keep a name on the dynamic watchlist.',
    `Pin writes the ticker into the localStorage watchlist and keeps it when a later scan would not auto-add it. Unpin removes that protection. Auto-add still requires kyleScore >= ${AUTO_ADD_MIN_KYLE_SCORE} and stage coiled or triggering.`,
  ),
  watchlistAutoAdd: d(
    'Auto-add',
    'Coiled and triggering names land on the watchlist.',
    `After a scan, names with kyleScore >= ${AUTO_ADD_MIN_KYLE_SCORE} and stage coiled or triggering are inserted with source auto. Pin keeps a row; unpin or remove drops it. The list is sorted pinned first, then by kyleScore.`,
  ),
  watchlistMissing: d(
    'Not in the scan',
    'The watchlist ticker has no current idea.',
    'The row is stored locally but the current dashboard ideas do not include it. That happens when it is at or under the 200-day SMA, failed the fetch, or was filtered out of the loaded set before this map was built from data.ideas.',
  ),
  groupRank: d(
    '#',
    'Rank after the selected period sort.',
    'rankGroups sorts by the selected period descending, breaks ties with the next-longer periods and then the other performance fields, puts missing numbers last, and rewrites rsRank as 1..n. Clicking this header sorts by that rank (first click ascending) instead of by a performance field.',
  ),
  groupName: d(
    'Group name',
    'Finviz industry, or the scan group on fallback.',
    'Finviz label from the groups page, or the scan idea groupName when the panel fell back to buildDynamicGroups. Clicking the row loads that industry\'s drill-down when the source is Finviz, and filters by groupId on the internal fallback.',
    'The detail line can include 1W (Finviz perfW), 1Y (perfY), and YTD (perfYtd) when those numbers exist. They are not table columns. The fallback builder does not set 1Y or YTD. The external-link icon opens the Finviz screener for the slug at the selected period order; it is not a metric.',
  ),
  groupLeaders: d(
    'Leaders',
    'In-scan leaders over names with a number.',
    `countGroupLeaders: N is how many of the pool have selected-period performance > 0 and also appear in the current scan. D is parsedCount, the pool rows that were passed in. The pool is the top ${LEADER_POOL_SIZE} snapshot members that have a real performance number, from names that cleared price > ${SCAN_MIN_PRICE_DEFAULT} and average volume > ${SCAN_MIN_AVG_VOL_DEFAULT} when the file was built. Scan membership stands in for above the 200-day and 50-day SMAs. inScanCount is null when the scan cache is not ready.`,
    `On the internal fallback the cell is leaderCount instead: scan members in the group with pctFrom52wHigh >= -${FALLBACK_LEADER_NEAR_HIGH_PCT}. Leaders are requested for the first 25 groups in the current sort, plus the selected group. The amber line under the count lists the top names and whether each is in the scan.`,
  ),
  groupPerf1d: groupColumn('1d'),
  groupPerf1w: groupColumn('1w'),
  groupPerf1m: groupColumn('1m'),
  groupPerf3m: groupColumn('3m'),
  groupPerf6m: groupColumn('6m'),
  groupSourceFinviz: d(
    'Finviz source',
    'Industry table came from the Finviz groups page.',
    `GET /api/groups parsed FinvizInitGroupsPerformance. A payload younger than ${FINVIZ_GROUPS_CACHE_MS / 60000} minutes is served from cache. The panel re-reads about every ${GROUPS_POLL_MS / 60000} minutes and keeps the last good payload if a request fails.`,
  ),
  groupSourceFallback: d(
    'Fallback ranking',
    'Finviz groups were unavailable, so the scan built the table.',
    'Used when Finviz is blocked or unparseable and no cached groups payload exists. buildDynamicGroups averages dayPct, perf1M, perf3M, and perf6M of current scan ideas by industry, and sets weekPct to the average of perf1M/4. Nothing is copied from Finviz.',
  ),
  groupPayloadStale: d(
    'Groups stale',
    'Last good Finviz groups payload.',
    `Set when a refetch of the groups page fails and an older payload is still in memory. A cache hit younger than ${FINVIZ_GROUPS_CACHE_MS / 60000} minutes is not marked stale.`,
  ),
  groupMembershipStale: d(
    'Membership stale',
    'The snapshot file is old.',
    `isMembershipStale is true when generatedAt is older than ${MEMBERSHIP_STALE_DAYS} days. Leaders and drill-down still run; the tag is only a reminder to rebuild the file.`,
  ),
  groupMembershipSnapshot: d(
    'Membership snapshot',
    'Date the industry membership file was built.',
    `The YYYY-MM-DD prefix of membership.generatedAt. That file lists Finviz screener members (price > ${SCAN_MIN_PRICE_DEFAULT}, average volume > ${SCAN_MIN_AVG_VOL_DEFAULT}) and is read at request time. It is not rebuilt on the server.`,
  ),
  groupScoreStale: d(
    'Score cache stale',
    'Last good scored drill-down.',
    `The group-stocks response sets stale when rebuilding the scored members throws and a previous cache entry exists. That is separate from the ${MEMBERSHIP_STALE_DAYS}-day membership flag. A fresh snapshot build stores stale: false.`,
  ),
  groupPeriodControl: d(
    'Period',
    'Which window ranks groups and leaders.',
    `The segments are ${GROUP_PERIODS['1d'].label}, ${GROUP_PERIODS['1w'].label}, ${GROUP_PERIODS['1m'].label}, ${GROUP_PERIODS['3m'].label}, and ${GROUP_PERIODS['6m'].label}. The choice is stored in localStorage qm-groups-period (default 3M). It re-ranks the table, highlights the matching column when one exists, and reloads leaders and an open drill-down for that window.`,
  ),
  groupReset: d(
    'Reset group',
    'Leave the industry drill-down.',
    'Clears the selected group and puts the existing dashboard scan back in the ideas table. It does not start a new scan. The next group starts from the group-view filter baseline.',
  ),
  groupFailedTickers: d(
    'Tickers with no data',
    'Snapshot members that could not be scored.',
    'The drill-down lists tickers that produced no bars in failed: [{ ticker, reason }]. They are omitted from the table. The count is failed.length of parsedCount.',
  ),
  memberPeriodPerf: d(
    'Member period performance',
    'Selected-window return for this drill-down row.',
    `On a snapshot drill-down, finvizPerf is the computed member return for the selected period (1D is price/prevClose via resolvePrevClose; 1W/1M/3M/6M are ${PERIOD_SESSIONS['1w']}/${PERIOD_SESSIONS['1m']}/${PERIOD_SESSIONS['3m']}/${PERIOD_SESSIONS['6m']} completed sessions). When the live Finviz screener path is on, the same map is that page's period percent. It is not copied onto the idea's 1M/3M columns.`,
  ),
  marketRegime10gt20: d(
    'QQQ 10>20',
    'Short average versus the 20-day on QQQ.',
    regimeHow(),
  ),
  marketRegimeSt: d(
    'ST direction',
    'QQQ versus its 50-day average and slope.',
    regimeHow(),
    'Downtrend pushes triggering names lower in the ideas sort when scores tie, and shows the soft warning. It does not remove rows.',
  ),
  marketRegimeWarn: d(
    'Downtrend warning',
    'Soft warning only.',
    `Shown when ST is Downtrend (price < SMA${SMA_PERIODS.sma50} and SMA50 slope over ${REGIME_CONFIG.slopeLookbackSessions} sessions <= ${REGIME_CONFIG.downSlopeMaxPct}%). The ideas sort deprioritizes triggering names when other keys tie. Rows stay on screen.`,
  ),
  scanUniverse: d(
    'Scan size',
    'How many symbols the run started with.',
    `scanUniverseSize is the Stage 1 list length after the cap. Stage 1 asks Yahoo for US equities (quote type EQUITY) on NMS, NYQ, NGM, and NCM, price above the default ${SCAN_MIN_PRICE_DEFAULT}, average 3-month volume at least the default ${SCAN_MIN_AVG_VOL_DEFAULT}, page size ${SCAN_STAGE1_PAGE_SIZE}, cap default ${SCAN_STAGE1_CAP_DEFAULT}. Env overrides of those three numbers are applied on the server and are not shown here.`,
  ),
  stage1Universe: d(
    'Stage 1 universe',
    'Liquid names returned before the SMA prefilter.',
    `stage1Count is the equity list from the Yahoo screener (or the predefined-screen fallback, or the emergency fixed list). Same price, volume, exchange, and cap rules as the scan size. Defaults when env is unset: price > ${SCAN_MIN_PRICE_DEFAULT}, average volume >= ${SCAN_MIN_AVG_VOL_DEFAULT}, cap ${SCAN_STAGE1_CAP_DEFAULT}.`,
  ),
  stage15Sma: d(
    'Stage 1.5 SMA',
    'Names above both the 200- and 50-day averages.',
    `Cheap Yahoo quotes (or spark closes if the quote is blocked). A name survives only when regularMarketPrice > twoHundredDayAverage and regularMarketPrice > fiftyDayAverage. A missing average or a failed quote is dropped. stage15Count is that survivor count and is the Stage 2 shortlist.`,
  ),
  stage2Deep: d(
    'Deep scan',
    'Stage 2 shortlist size.',
    'shortlistCount is how many Stage 1.5 survivors were sent through full bar history, computeIdeaMetrics, and the earnings overlay. It is usually equal to stage15Count.',
  ),
  emergencyUniverse: d(
    'Emergency universe',
    'Stage 1 could not build a Yahoo list.',
    'Shown when the Yahoo screener and the predefined screens fail or come back too thin. The run then scores the fixed SCAN_UNIVERSE list instead of the live liquid screen.',
  ),
  shownCount: d(
    'Shown',
    'Rows on screen after filters.',
    'filteredIdeas.length. On a normal scan that is the cached ideas that pass the filter bar, sorted by earnings-avoid last, then stage, A+, kyleScore, above SMA50, a downtrend tie-break on triggering, then RVOL. In group view it is the drill-down rows that pass the group filters.',
  ),
  asOf: d(
    'As of',
    'Timestamp of the loaded dashboard.',
    'data.asOf formatted in the Europe/Dublin zone. Live mode is the scan cache time; it is not a per-ticker quote time.',
  ),
  scanHits: d(
    'Scan hits',
    'Ideas the deep scan returned.',
    'scanHitCount is the number of ideas written by Stage 2 (computeIdeaMetrics on the SMA survivors) before the client filters. The ideas table can show fewer after the filter bar.',
  ),
  scanBelow200: d(
    'Below 200 dropped',
    'Stage 2 names that failed the 200-day gate.',
    `scanBelow200Count counts survivors whose recomputed price was not above the ${SMA_PERIODS.sma200}-day SMA, so they were not returned as setups. Stage 1.5 already tried to drop those names; this is the bar-based check.`,
  ),
  scanFails: d(
    'Scan failures',
    'Symbols whose bars could not be scored.',
    'scanFailCount counts Stage 2 symbols that threw or returned no metrics (fetch or history shorter than 200 sessions). They are not invented as rows.',
  ),
  stage15Below200: d(
    'Prefilter below 200',
    'Stage 1.5 drops under the 200-day quote average.',
    'stage15BelowSma200Count is how many Stage 1 symbols had regularMarketPrice at or under twoHundredDayAverage on the cheap quote (or the spark SMA). They never reach Stage 2.',
  ),
  stage15Below50: d(
    'Prefilter below 50',
    'Stage 1.5 drops under the 50-day quote average.',
    'stage15BelowSma50Count is how many Stage 1 symbols failed regularMarketPrice > fiftyDayAverage. They never reach Stage 2 even if they were above the 200-day average.',
  ),
  stage15Missing: d(
    'Prefilter missing SMA',
    'Quote had no usable average.',
    'stage15MissingSmaCount is symbols dropped because a 50- or 200-day average was missing or the quote failed. The prefilter fails closed.',
  ),
  chartSma10: chartSma(SMA_PERIODS.sma10),
  chartSma20: chartSma(SMA_PERIODS.sma20),
  chartSma50: chartSma(SMA_PERIODS.sma50),
  chartSma200: chartSma(SMA_PERIODS.sma200),
  chartVolume: d(
    'Volume',
    'Share volume of the hovered daily bar.',
    'toVolume uses that session\'s share volume. The bar is tinted with the up color when close >= open, and the down color otherwise. It is not dollar volume.',
  ),
  chartOhlc: d(
    'OHLC',
    'Hovered daily bar.',
    'Open, high, low, and close from the daily candles drawn for this symbol. The date is that bar\'s session.',
  ),
  chartDaily: d(
    'Daily',
    'The chart timeframe.',
    'The panel loads daily OHLCV (about the last 260 sessions, capped at 500) and overlays the SMA lines you toggle. It does not draw intraday bars.',
  ),
  marketCap: d(
    'Market cap',
    'Finnhub profile figure, scaled to dollars.',
    'profile2 marketCapitalization is in millions of USD. The server multiplies by 1,000,000 and the client formats the dollars with T, B, M, or K (one decimal above one thousand).',
  ),
  profileIndustry: d(
    'Industry',
    'Finnhub industry label.',
    'finnhubIndustry from profile2, when the profile request returned one. It is not the Finviz group slug.',
  ),
  profileExchange: d(
    'Exchange',
    'Finnhub exchange code.',
    'The exchange string on the Finnhub profile2 payload. Empty when the profile call did not return one.',
  ),
  newsSource: d(
    'News source',
    'Where the headlines were loaded from.',
    'Finnhub company-news when that call returns items, otherwise Yahoo search. The list is capped at 8 headlines. Headlines are not turned into catalysts.',
  ),
} as const satisfies Record<string, MetricDef>

export type MetricId = keyof typeof METRIC_DEFS

const METRIC_ID_SET: ReadonlySet<string> = new Set(Object.keys(METRIC_DEFS))

export function isMetricId(value: string): value is MetricId {
  return METRIC_ID_SET.has(value)
}

export function getMetricDef(id: MetricId): MetricDef {
  return METRIC_DEFS[id]
}

/** Label, one-line summary, calculation, notes, then an optional per-row extra. */
export function metricTooltipText(id: MetricId, params?: { extra?: string }): string {
  const def = METRIC_DEFS[id]
  const lines = [def.label, def.short, def.how]
  if (def.notes) lines.push(def.notes)
  const extra = params?.extra?.trim()
  if (extra) lines.push(extra)
  return lines.join('\n')
}

/** Attributes for a control that is already focusable (button, input, label, link). */
export function metricTipAttrs(
  id: MetricId,
  extra?: string,
): { 'data-metric': MetricId; 'data-metric-extra'?: string } {
  return extra ? { 'data-metric': id, 'data-metric-extra': extra } : { 'data-metric': id }
}
