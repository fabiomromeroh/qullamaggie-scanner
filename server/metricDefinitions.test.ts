import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { test } from 'node:test'
import {
  A_CONFIG,
  APLUS_CONFIG,
  BAR_WINDOWS,
  BASE_LENGTH_PROXY,
  EARNINGS_PROXIMITY,
  KYLE_SCORE_CONFIG,
  LONG_BASE_MIN_SESSIONS,
  NEAR_ATH_MAX_PCT,
  NEAR_ATH_PCT,
  PRIOR_RUN_PROXY,
  RANGE_BREAKOUT_CONFIG,
  REGIME_CONFIG,
  SETUP_TYPE_CONFIG,
  TIGHT_DAYS_PROXY,
  isAHeuristic,
  isAPlusHeuristic,
  isAPlusPlusHeuristic,
  kyleScoreHeuristic,
} from '../src/lib/metrics.ts'
import { RANGE_BASE_CONFIG } from '../src/lib/rangeBase.ts'
import {
  METRIC_DEFS,
  aPlusPlusRuleText,
  aPlusRuleText,
  aRuleText,
  getMetricDef,
  isMetricId,
  kyleScoreRuleText,
  metricTooltipText,
  rangeBaseRuleText,
  stageRuleText,
  surferRuleText,
  tightRuleText,
  type MetricId,
} from '../src/lib/metricDefinitions.ts'
import {
  EXTENSION_ADR50_FORMULA,
  EXTENSION_ADR50_FORMULA_EQUIV,
} from '../src/lib/extensionAdr.ts'
import {
  DEFAULT_FILTERS,
  DEFAULT_MIN_AVG_DOLLAR_VOL,
  GROUP_VIEW_DEFAULT_FILTERS,
  GROUP_VIEW_MAX_EXTENSION_ADR50,
  MAX_EXTENSION_ADR50_PRESETS,
  NEAR_HIGHS_PRESETS,
} from '../src/types/index.ts'
import { STAGE_CONFIG, setupStageHeuristic } from '../src/lib/setupStage.ts'
import { CATALYST_CATEGORIES, CATALYST_WINDOW_HOURS } from '../src/lib/catalyst.ts'
import { SURFER_CONFIG } from '../src/lib/surfer.ts'
import { TIGHT_CONFIG } from '../src/lib/tightConsolidation.ts'
import {
  FALLBACK_LEADER_NEAR_HIGH_PCT,
  MEMBERSHIP_STALE_DAYS,
} from '../src/lib/groupPeriod.ts'
import { LEADER_POOL_SIZE, PERIOD_SESSIONS } from '../src/lib/memberPerf.ts'
import {
  SCAN_MIN_AVG_VOL_DEFAULT,
  SCAN_MIN_PRICE_DEFAULT,
  SCAN_STAGE1_CAP_DEFAULT,
} from '../src/lib/scanDefaults.ts'
import {
  TOOLTIP_GAP,
  TOOLTIP_VIEWPORT_PAD,
  clampToViewport,
  placeTooltip,
} from '../src/lib/tooltipPosition.ts'
import { QUOTE_CACHE_TTL_MS } from '../src/lib/marketQuote.ts'
import { US_EQUITY_SYMBOL_PATTERN } from '../src/lib/tickerSymbol.ts'
import {
  USER_WATCHLIST_CAP,
  USER_WATCHLIST_STORAGE_KEY,
  USER_WATCHLIST_UNDO_MS,
} from '../src/lib/userWatchlistStore.ts'

/** Ids that may live in the registry before a surface renders them. */
const UNUSED_ALLOWLIST: readonly string[] = []

const ID_RE = /['"]([a-z][A-Za-z0-9]*)['"]/g

function quotedIds(chunk: string): string[] {
  return [...chunk.matchAll(ID_RE)].map((match) => match[1]!).filter((id) => isMetricId(id))
}

function balancedCallBodies(source: string, name: string): string[] {
  const bodies: string[] = []
  const re = new RegExp(`${name}\\s*\\(`, 'g')
  let match: RegExpExecArray | null
  while ((match = re.exec(source))) {
    let depth = 1
    let i = match.index + match[0].length
    for (; i < source.length && depth > 0; i++) {
      const ch = source[i]
      if (ch === '(') depth++
      else if (ch === ')') depth--
    }
    bodies.push(source.slice(match.index + match[0].length, i - 1))
  }
  return bodies
}

function openingTags(source: string, tag: string): string[] {
  const tags: string[] = []
  const re = new RegExp(`<${tag}\\b`, 'g')
  let match: RegExpExecArray | null
  while ((match = re.exec(source))) {
    let depth = 0
    let i = match.index + match[0].length
    for (; i < source.length; i++) {
      const ch = source[i]
      if (ch === '{') depth++
      else if (ch === '}') depth = Math.max(0, depth - 1)
      else if (ch === '>' && depth === 0) break
    }
    tags.push(source.slice(match.index, i))
  }
  return tags
}

function idsInAttribute(expr: string): string[] {
  const bare = expr.trim()
  if (/^[a-z][A-Za-z0-9]*$/.test(bare)) return [bare]
  return quotedIds(expr)
}

function idExpressions(tag: string): string[] {
  const attr = tag.match(/\bid\s*=\s*(?:"([^"]*)"|'([^']*)'|\{([\s\S]*)\})/)
  if (!attr) return []
  return [attr[1], attr[2], attr[3]].filter((part): part is string => Boolean(part))
}

function usedMetricIds(dir: string): Set<string> {
  const ids = new Set<string>()
  for (const name of readdirSync(dir)) {
    if (!name.endsWith('.tsx')) continue
    const source = readFileSync(resolve(dir, name), 'utf8')
    for (const body of balancedCallBodies(source, 'metricTipAttrs')) {
      for (const id of quotedIds(body)) ids.add(id)
    }
    for (const tagName of ['MetricTip', 'MetricCell', 'CheckChip']) {
      for (const tag of openingTags(source, tagName)) {
        for (const expr of idExpressions(tag)) {
          for (const id of idsInAttribute(expr)) {
            if (isMetricId(id)) ids.add(id)
          }
        }
      }
    }
    for (const hit of source.matchAll(/\bmetric="([a-z][A-Za-z0-9]*)"/g)) ids.add(hit[1]!)
    for (const hit of source.matchAll(/\bdata-metric="([a-z][A-Za-z0-9]*)"/g)) ids.add(hit[1]!)
  }
  return ids
}

function includes(id: MetricId, needle: string): void {
  assert.ok(
    metricTooltipText(id).includes(needle),
    `${id} tooltip should include ${JSON.stringify(needle)}`,
  )
}

test('every metric definition has label, short, and how', () => {
  const ids = Object.keys(METRIC_DEFS) as MetricId[]
  assert.ok(ids.length > 0)
  for (const id of ids) {
    const def = getMetricDef(id)
    assert.equal(def.label.trim().length > 0, true, id)
    assert.equal(def.short.trim().length > 0, true, id)
    assert.equal(def.how.trim().length > 0, true, id)
    assert.equal(isMetricId(id), true)
    assert.ok(metricTooltipText(id).includes(def.label))
    assert.ok(metricTooltipText(id, { extra: 'row detail' }).includes('row detail'))
  }
})

test('tooltip text is built from the live scanner constants', () => {
  assert.ok(metricTooltipText('surfer10').includes(surferRuleText('sma10')))
  assert.ok(metricTooltipText('surfer20').includes(surferRuleText('sma20')))
  assert.ok(metricTooltipText('surfer50').includes(surferRuleText('sma50')))
  includes('surfer10', `${SURFER_CONFIG.windowSessions.sma10}`)
  includes('surfer10', `${SURFER_CONFIG.kProximity.sma10}`)
  includes('surfer10', `${SURFER_CONFIG.kBreak.sma10}`)
  includes('surfer20', `${SURFER_CONFIG.kProximity.sma20}`)
  includes('surfer20', `${SURFER_CONFIG.maxExtensionAdrMultiple}`)
  includes('surfer50', `${SURFER_CONFIG.slopeLookback.sma50}`)
  includes('surfer50', `${SURFER_CONFIG.windowSessions.sma50}`)
  includes('surfer50', `${SURFER_CONFIG.kProximity.sma50}`)
  assert.equal(metricTooltipText('surfer10').toLowerCase().includes('touch'), false)
  assert.equal(metricTooltipText('surfer20').toLowerCase().includes('touch'), false)
  assert.equal(metricTooltipText('surfer50').toLowerCase().includes('touch'), false)

  assert.ok(metricTooltipText('tightConsolidation').includes(tightRuleText()))
  includes('tightConsolidation', `${TIGHT_CONFIG.recentWindow}`)
  includes('tightConsolidation', `${TIGHT_CONFIG.baselineSessions}`)
  includes('tightConsolidation', `${TIGHT_CONFIG.rangeRatioMax}`)
  includes('tightConsolidation', `${TIGHT_CONFIG.closeSpreadMaxMultipleOfAdr}`)
  includes('tightConsolidation', `${TIGHT_CONFIG.closeSpreadAbsMaxPct}`)
  includes('tightConsolidation', `${TIGHT_CONFIG.volumeRatioMax}`)
  includes('tightConsolidation', `${TIGHT_CONFIG.volumeAvgSessions}`)
  includes('tightConsolidation', `${TIGHT_CONFIG.nearHighMaxPct}`)
  includes('tightAboveSma50', `${TIGHT_CONFIG.sma50Period}`)
  includes('tightAboveSma200', `${TIGHT_CONFIG.sma200Period}`)
  assert.match(tightRuleText(), /50-day SMA/)
  assert.match(tightRuleText(), /200-day SMA/)
  assert.doesNotMatch(tightRuleText(), /SMA10|SMA20|10-day|20-day/)

  includes('hasCatalyst', `${CATALYST_WINDOW_HOURS}`)
  includes('catalyst', `${CATALYST_WINDOW_HOURS}`)
  for (const category of CATALYST_CATEGORIES) {
    includes('hasCatalyst', category.label)
  }
  includes('catalystStatus', 'pending')
  includes('catalystStatus', 'unchecked')

  assert.ok(metricTooltipText('stageTriggering').includes(stageRuleText('triggering')))
  assert.ok(metricTooltipText('stageCoiled').includes(stageRuleText('coiled')))
  assert.ok(metricTooltipText('stageWatching').includes(stageRuleText('watching')))
  includes('stageTriggering', `${STAGE_CONFIG.triggerRvolNearHigh}`)
  includes('stageTriggering', `${STAGE_CONFIG.triggerDayPctNearHigh}`)
  includes('stageTriggering', `${STAGE_CONFIG.triggerRvolStrong}`)
  includes('stageTriggering', `${STAGE_CONFIG.triggerDayPctStrong}`)
  includes('stageTriggering', `${STAGE_CONFIG.triggerRvolTight}`)
  includes('stageTriggering', `${STAGE_CONFIG.triggerDayPctTight}`)
  includes('stageTriggering', `${STAGE_CONFIG.nearHighPct}`)
  includes('stageCoiled', `${STAGE_CONFIG.coiledTightDaysMin}`)
  includes('stageCoiled', `${STAGE_CONFIG.coiledPriorRunMin}`)
  includes('stageCoiled', `${STAGE_CONFIG.nearHighTightPct}`)

  assert.ok(metricTooltipText('qualityA').includes(aRuleText()))
  includes('qualityA', `${A_CONFIG.adrMin}`)
  includes('qualityA', `${A_CONFIG.ext50MaxAdr}`)
  includes('qualityA', 'coiled')
  includes('qualityA', 'Range Breakout')
  includes('qualityA', 'tightConsolidation')
  assert.ok(metricTooltipText('aPlus').includes(aPlusRuleText()))
  assert.ok(metricTooltipText('aPlusPlus').includes(aPlusPlusRuleText()))
  includes('aPlusPlus', `${LONG_BASE_MIN_SESSIONS}`)
  includes('aPlusPlus', `${KYLE_SCORE_CONFIG.aPlusFloor}`)
  assert.equal(getMetricDef('aboveSma10').label, '> 10 SMA')
  assert.equal(getMetricDef('aboveSma20').label, '> 20 SMA')
  assert.equal(getMetricDef('aboveSma50').label, '> 50 SMA')
  includes('aPlus', `${NEAR_ATH_MAX_PCT}`)
  includes('aPlus', `${APLUS_CONFIG.baseQualityMin}`)
  includes('aPlus', `${APLUS_CONFIG.rangeBaseScoreMin}`)
  includes('aPlus', `${APLUS_CONFIG.monthSessions}`)
  includes('aPlus', `${APLUS_CONFIG.baseQualityCap}`)
  assert.equal(NEAR_ATH_MAX_PCT, NEAR_ATH_PCT)
  assert.ok(metricTooltipText('rangeBase').includes(rangeBaseRuleText()))
  includes('rangeBase', `${RANGE_BASE_CONFIG.compressionMax}`)
  includes('rangeBase', `${RANGE_BASE_CONFIG.containmentMin}`)
  includes('rangeBase', `${RANGE_BASE_CONFIG.minSessions}`)
  includes('rangeBase', `${RANGE_BASE_CONFIG.above50Min}`)
  includes('rangeBase', `${RANGE_BASE_CONFIG.adrSlack}`)
  includes('rangeBase', `${RANGE_BASE_CONFIG.monthSessions}`)
  includes('rangeBase', `${RANGE_BASE_CONFIG.yearSessions}`)

  assert.ok(metricTooltipText('kyleScore').includes(kyleScoreRuleText()))
  includes('kyleScore', `${KYLE_SCORE_CONFIG.below200Score}`)
  includes('kyleScore', `${KYLE_SCORE_CONFIG.base}`)
  includes('kyleScore', `${KYLE_SCORE_CONFIG.aboveSma50}`)
  includes('kyleScore', `${KYLE_SCORE_CONFIG.rvolHigh}`)
  includes('kyleScore', `${KYLE_SCORE_CONFIG.priorRunHigh}`)
  includes('kyleScore', `${KYLE_SCORE_CONFIG.adrMin}`)
  includes('kyleScore', `${KYLE_SCORE_CONFIG.adrMax}`)
  includes('kyleScore', `${KYLE_SCORE_CONFIG.aPlusFloor}`)
  includes('kyleScore', `${KYLE_SCORE_CONFIG.aBump}`)
  includes('kyleScore', `${KYLE_SCORE_CONFIG.clampMin}`)
  includes('kyleScore', `${KYLE_SCORE_CONFIG.clampMax}`)

  includes('rvol', `${BAR_WINDOWS.rvolSessions}`)
  includes('adrPct', `${BAR_WINDOWS.adrSessions}`)
  includes('extensionAdr50', EXTENSION_ADR50_FORMULA)
  includes('extensionAdr50', EXTENSION_ADR50_FORMULA_EQUIV)
  includes('extensionAdr50', `${BAR_WINDOWS.adrSessions}`)
  includes('filterMaxExtensionAdr50', EXTENSION_ADR50_FORMULA)
  includes('filterMaxExtensionAdr50', `${BAR_WINDOWS.adrSessions}`)
  includes('filterMaxExtensionAdr50', `${MAX_EXTENSION_ADR50_PRESETS[0]}`)
  includes('filterMaxExtensionAdr50', `${GROUP_VIEW_MAX_EXTENSION_ADR50}`)
  includes('filterMaxExtensionAdr50', 'Any')
  assert.equal(DEFAULT_FILTERS.maxExtensionAdr50, 5)
  assert.equal(GROUP_VIEW_DEFAULT_FILTERS.maxExtensionAdr50, GROUP_VIEW_MAX_EXTENSION_ADR50)
  assert.equal(GROUP_VIEW_DEFAULT_FILTERS.maxExtensionAdr50, 4)
  includes('filterMaxExtensionAdr50', `< ${GROUP_VIEW_DEFAULT_FILTERS.maxExtensionAdr50} ADR`)
  includes('dolVol', `$${GROUP_VIEW_DEFAULT_FILTERS.minAvgDollarVol / 1_000_000}M`)
  includes('filterMinDollarVol', `$${DEFAULT_MIN_AVG_DOLLAR_VOL / 1_000_000}M`)
  includes('filterMinDollarVol', `$${GROUP_VIEW_DEFAULT_FILTERS.minAvgDollarVol / 1_000_000}M`)
  includes('filterMinDollarVol', `${GROUP_VIEW_DEFAULT_FILTERS.minAvgDollarVol}`)
  includes('filterMaxPctFromHigh', `${BAR_WINDOWS.high52Sessions}`)
  includes('filterMaxPctFromHigh', 'abs')
  includes('filterMaxPctFromHigh', 'Any')
  for (const preset of NEAR_HIGHS_PRESETS) {
    includes('filterMaxPctFromHigh', `${preset}%`)
  }
  assert.equal(getMetricDef('filterMaxPctFromHigh').label, 'Near highs ≤')
  assert.equal(DEFAULT_FILTERS.maxPctFromHigh, null)
  assert.doesNotMatch(metricTooltipText('filterMaxPctFromHigh'), /Max % from high/)
  includes('dolVol', `${BAR_WINDOWS.dolVolSessions}`)
  includes('pctFrom52wHigh', `${BAR_WINDOWS.high52Sessions}`)
  includes('perf1m', `${BAR_WINDOWS.perf1mSessions}`)
  includes('perf3m', `${BAR_WINDOWS.perf3mSessions}`)
  includes('perf6m', `${BAR_WINDOWS.perf6mSessions}`)
  includes('sparkline', `${BAR_WINDOWS.sparkSessions}`)
  includes('priorRunPct', `${PRIOR_RUN_PROXY.runLookback}`)
  includes('priorRunPct', `${PRIOR_RUN_PROXY.baseLookback}`)
  includes('priorRunPct', `${PRIOR_RUN_PROXY.shortHistoryOffset}`)
  includes('tightDays', `${TIGHT_DAYS_PROXY.lookback}`)
  includes('tightDays', `${TIGHT_DAYS_PROXY.rangeFactor}`)
  includes('tightDays', `${TIGHT_DAYS_PROXY.maProximityPct}`)
  includes('baseLengthDays', `${BASE_LENGTH_PROXY.maxLookback}`)
  includes('baseLengthDays', `${BASE_LENGTH_PROXY.rangeFactor}`)
  includes('earningsAvoid', `${EARNINGS_PROXIMITY.avoidMaxTradingDays}`)
  includes('earningsAlert', `${EARNINGS_PROXIMITY.alertTradingDays}`)
  includes('marketRegime10gt20', `${REGIME_CONFIG.minBars}`)
  includes('marketRegimeSt', `${REGIME_CONFIG.upSlopeMinPct}`)
  includes('marketRegimeSt', `${REGIME_CONFIG.downSlopeMaxPct}`)
  includes('marketRegimeSt', `${REGIME_CONFIG.slopeLookbackSessions}`)
  includes('setupEpisodicPivot', `${SETUP_TYPE_CONFIG.episodicRvol}`)
  includes('setupEpisodicPivot', `${SETUP_TYPE_CONFIG.episodicDayPct}`)
  includes('setupRangeBreakout', `${RANGE_BREAKOUT_CONFIG.adrMinPct}`)
  includes('setupRangeBreakout', `${RANGE_BREAKOUT_CONFIG.priorLegMinPct}`)
  includes('setupRangeBreakout', `${RANGE_BREAKOUT_CONFIG.rangeOverAdrMax}`)
  includes('setupRangeBreakout', `${RANGE_BREAKOUT_CONFIG.recentRangeSessions}`)
  includes('setupRangeBreakout', `${RANGE_BREAKOUT_CONFIG.higherLowsBaseSessions}`)
  includes('setupRangeBreakout', `${RANGE_BREAKOUT_CONFIG.higherLowsMinRisePct}`)
  includes('setupRangeBreakout', `${RANGE_BREAKOUT_CONFIG.pivotRadius}`)
  includes('setupRangeBreakout', `${RANGE_BREAKOUT_CONFIG.higherLowsMinPivots}`)
  includes('setupRangeBreakout', `${PRIOR_RUN_PROXY.runLookback}`)
  includes('setupRangeBreakout', `${PRIOR_RUN_PROXY.baseLookback}`)
  assert.equal(metricTooltipText('setupRangeBreakout').includes('8%'), false)
  assert.equal(metricTooltipText('setupRangeBreakout').includes('RVOL >= 1.2'), false)
  assert.equal(metricTooltipText('setupRangeBreakout').includes('RVOL ≥ 1.2'), false)
  assert.equal('rangeHighPct' in SETUP_TYPE_CONFIG, false)
  assert.equal('rangeRvol' in SETUP_TYPE_CONFIG, false)
  includes('nearAth', `${NEAR_ATH_PCT}`)
  includes('groupPerf1d', `${PERIOD_SESSIONS['1w']}`)
  includes('groupPerf1w', `${PERIOD_SESSIONS['1w']}`)
  includes('groupPerf1m', `${PERIOD_SESSIONS['1m']}`)
  includes('groupPerf3m', `${PERIOD_SESSIONS['3m']}`)
  includes('groupPerf6m', `${PERIOD_SESSIONS['6m']}`)
  includes('groupLeaders', `${LEADER_POOL_SIZE}`)
  includes('groupLeaders', `${FALLBACK_LEADER_NEAR_HIGH_PCT}`)
  includes('groupLeaders', `${SCAN_MIN_PRICE_DEFAULT}`)
  includes('groupLeaders', `${SCAN_MIN_AVG_VOL_DEFAULT}`)
  includes('groupMembershipStale', `${MEMBERSHIP_STALE_DAYS}`)
  includes('scanUniverse', `${SCAN_MIN_PRICE_DEFAULT}`)
  includes('scanUniverse', `${SCAN_STAGE1_CAP_DEFAULT}`)
})

test('component metric ids match the registry', () => {
  const dir = resolve(process.cwd(), 'src/components')
  const used = usedMetricIds(dir)
  const unknown = [...used].filter((id) => !isMetricId(id))
  assert.deepEqual(unknown, [])
  const unused = (Object.keys(METRIC_DEFS) as string[]).filter(
    (id) => !used.has(id) && !UNUSED_ALLOWLIST.includes(id),
  )
  assert.deepEqual(unused, [])
})

test('tooltip placement clamps and flips', () => {
  const viewport = { width: 400, height: 300 }
  const below = placeTooltip({ top: 10, left: 100, right: 160, bottom: 30 }, 120, 40, viewport)
  assert.equal(below.placement, 'below')
  assert.equal(below.top, 30 + TOOLTIP_GAP)
  assert.equal(below.left, 70)

  const above = placeTooltip({ top: 250, left: 100, right: 180, bottom: 280 }, 80, 40, viewport)
  assert.equal(above.placement, 'above')
  assert.equal(above.top, 250 - TOOLTIP_GAP - 40)

  const clamped = placeTooltip({ top: 20, left: 0, right: 12, bottom: 36 }, 200, 40, viewport)
  assert.equal(clamped.left, TOOLTIP_VIEWPORT_PAD)

  const huge = clampToViewport(-40, -40, 1000, 1000, { width: 200, height: 180 })
  assert.equal(huge.left, TOOLTIP_VIEWPORT_PAD)
  assert.equal(huge.top, TOOLTIP_VIEWPORT_PAD)

  const neither = placeTooltip(
    { top: 140, left: 180, right: 220, bottom: 160 },
    80,
    200,
    viewport,
  )
  assert.equal(neither.placement, 'below')
})

test('stage, A+, and kyle score boundaries stay on the exported constants', () => {
  const coiled = {
    aboveSma200: true,
    aboveSma10: true,
    aboveSma20: false,
    pctFrom52wHigh: -STAGE_CONFIG.nearHighPct,
    tightDays: STAGE_CONFIG.coiledTightDaysMin,
    rvol: 1,
    dayPct: 0,
    priorRunPct: STAGE_CONFIG.coiledPriorRunMin,
    tightConsolidation: false,
  }
  assert.equal(setupStageHeuristic(coiled), 'coiled')
  assert.equal(
    setupStageHeuristic({ ...coiled, tightDays: STAGE_CONFIG.coiledTightDaysMin - 1 }),
    'watching',
  )
  assert.equal(
    setupStageHeuristic({
      ...coiled,
      rvol: STAGE_CONFIG.triggerRvolNearHigh,
      dayPct: STAGE_CONFIG.triggerDayPctNearHigh,
      pctFrom52wHigh: -STAGE_CONFIG.nearHighPct,
    }),
    'triggering',
  )
  assert.equal(
    setupStageHeuristic({
      ...coiled,
      pctFrom52wHigh: -50,
      tightDays: 0,
      priorRunPct: 0,
      aboveSma10: false,
      aboveSma20: false,
      rvol: STAGE_CONFIG.triggerRvolStrong,
      dayPct: STAGE_CONFIG.triggerDayPctStrong,
    }),
    'triggering',
  )
  assert.equal(
    setupStageHeuristic({
      ...coiled,
      rvol: STAGE_CONFIG.triggerRvolTight,
      dayPct: STAGE_CONFIG.triggerDayPctTight,
      pctFrom52wHigh: -STAGE_CONFIG.nearHighTightPct,
      tightDays: 0,
      priorRunPct: 0,
      aboveSma10: false,
      aboveSma20: false,
    }),
    'triggering',
  )

  const sample = {
    aboveSma200: true,
    aboveSma50: true,
    aboveSma10: true,
    aboveSma20: true,
    pctFrom52wHigh: -3,
    rvol: 1.6,
    adrPct: 3,
    priorRunPct: 40,
    extensionAdr50: 1,
    setupStage: 'coiled' as const,
    setupType: 'Range Breakout' as const,
    tightConsolidation: true,
    rangeBaseOk: false,
    earningsStatus: 'clear' as const,
    hasCatalyst: true,
    catalystStatus: 'checked' as const,
    baseLengthDays: 63,
    rangeBaseLengthSessions: 0,
    rangeBaseScore: 0.2,
  }
  assert.equal(isAHeuristic(sample), true)
  assert.equal(isAPlusHeuristic(sample), true)
  assert.equal(isAPlusPlusHeuristic(sample), true)
  assert.equal(isAPlusPlusHeuristic({ ...sample, baseLengthDays: LONG_BASE_MIN_SESSIONS - 1 }), false)
  assert.equal(isAHeuristic({ ...sample, tightConsolidation: false }), false)
  assert.equal(isAHeuristic({ ...sample, setupType: 'Continuation' }), false)
  assert.equal(kyleScoreHeuristic({ ...sample, isA: true, isAPlus: true }), 5)
  assert.equal(
    kyleScoreHeuristic({ ...sample, aboveSma200: false, isA: false, isAPlus: false }),
    KYLE_SCORE_CONFIG.below200Score,
  )
  assert.equal(isAHeuristic({ ...sample, adrPct: A_CONFIG.adrMin - 0.1 }), false)
  assert.equal(isAPlusHeuristic({ ...sample, adrPct: A_CONFIG.adrMin - 0.1 }), false)
  assert.equal(isAHeuristic({ ...sample, earningsStatus: 'avoid' }), false)
  assert.equal(isAPlusHeuristic({ ...sample, hasCatalyst: false }), false)
})

test('MetricTip source keeps one shared portal and a focusable trigger', () => {
  const source = readFileSync(resolve(process.cwd(), 'src/components/MetricTip.tsx'), 'utf8')
  assert.match(source, /data-metric=\{id\}/)
  assert.match(source, /tabIndex=\{0\}/)
  assert.match(source, /role="tooltip"/)
  assert.match(source, /aria-describedby/)
  assert.match(source, /createPortal/)
  assert.match(source, /document\.body/)
  assert.match(source, /Escape/)
  assert.equal(source.includes('stopPropagation'), true)
})

test('watchlist metric ids exist, cite cap/pattern/TTL, and have no auto-add copy', () => {
  for (const id of [
    'watchlistPin',
    'watchlistAdd',
    'watchlistClear',
    'watchlistUndo',
    'watchlistRemove',
    'watchlistOrder',
    'watchlistMissing',
    'watchlistQuoteLoading',
    'watchlistQuoteUnavailable',
    'watchlistNoData',
  ] as const) {
    assert.equal(isMetricId(id), true, id)
  }
  includes('watchlistAdd', `${USER_WATCHLIST_CAP}`)
  includes('watchlistAdd', US_EQUITY_SYMBOL_PATTERN)
  includes('watchlistPin', `${USER_WATCHLIST_CAP}`)
  includes('watchlistPin', USER_WATCHLIST_STORAGE_KEY)
  includes('watchlistOrder', `${USER_WATCHLIST_CAP}`)
  includes('watchlistClear', USER_WATCHLIST_STORAGE_KEY)
  includes('watchlistUndo', `${USER_WATCHLIST_UNDO_MS / 1000}`)
  includes('watchlistMissing', `${QUOTE_CACHE_TTL_MS / 1000}`)
  includes('watchlistQuoteLoading', `${QUOTE_CACHE_TTL_MS / 1000}`)
  for (const id of Object.keys(METRIC_DEFS) as MetricId[]) {
    const text = metricTooltipText(id)
    assert.equal(/auto-?add/i.test(text), false, `${id} tooltip still mentions auto-add`)
    assert.equal(/autoAdd/.test(text), false, `${id} tooltip still mentions autoAdd`)
  }
})
