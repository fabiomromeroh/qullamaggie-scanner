import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  A_CONFIG,
  APLUS_CONFIG,
  KYLE_SCORE_CONFIG,
  NEAR_ATH_MAX_PCT,
  baseQualityDays,
  baseQualityScore,
  LONG_BASE_MIN_SESSIONS,
  isAHeuristic,
  isAPlusHeuristic,
  isAPlusPlusHeuristic,
  kyleScoreHeuristic,
  type SetupQualityInput,
} from '../src/lib/metrics.ts'
import {
  RANGE_BASE_CONFIG,
  evaluateRangeBase,
  rangeBaseLengthScore,
  type RangeBaseBar,
} from '../src/lib/rangeBase.ts'
import { DEFAULT_FILTERS, GROUP_VIEW_DEFAULT_FILTERS } from '../src/types/index.ts'
import { passesFilters } from '../src/lib/ideaFilters.ts'
import type { TradingIdea } from '../src/types/index.ts'

function quality(partial: Partial<SetupQualityInput> = {}): SetupQualityInput {
  return {
    aboveSma200: true,
    aboveSma50: true,
    adrPct: 3,
    extensionAdr50: 1.2,
    setupStage: 'coiled',
    setupType: 'Range Breakout',
    tightConsolidation: true,
    rangeBaseOk: false,
    earningsStatus: 'clear',
    pctFrom52wHigh: -3,
    hasCatalyst: false,
    catalystStatus: 'unchecked',
    baseLengthDays: 10,
    rangeBaseLengthSessions: 0,
    rangeBaseScore: 0.2,
    ...partial,
  }
}

function bar(i: number, close: number, rangePct: number): RangeBaseBar & { t: number; o: number; v: number } {
  const half = (close * (rangePct / 100)) / 2
  return {
    t: 1_700_000_000 + i * 86_400,
    o: close,
    h: close + half,
    l: Math.max(0.01, close - half),
    c: close,
    v: 1_000_000,
  }
}

test('isA and isAPlus matrix', () => {
  const base = quality()
  assert.equal(isAHeuristic(base), true)
  assert.equal(isAPlusHeuristic(base), false, 'no catalyst, short base')

  assert.equal(isAHeuristic(quality({ aboveSma200: false })), false)
  assert.equal(isAHeuristic(quality({ aboveSma50: false })), false)
  assert.equal(isAHeuristic(quality({ adrPct: A_CONFIG.adrMin - 0.01 })), false)
  assert.equal(isAHeuristic(quality({ adrPct: A_CONFIG.adrMin })), true)
  assert.equal(isAHeuristic(quality({ extensionAdr50: A_CONFIG.ext50MaxAdr })), true)
  assert.equal(isAHeuristic(quality({ extensionAdr50: A_CONFIG.ext50MaxAdr + 0.01 })), false)
  assert.equal(isAHeuristic(quality({ extensionAdr50: null })), true)
  assert.equal(isAHeuristic(quality({ earningsStatus: 'avoid' })), false)
  assert.equal(
    isAHeuristic(quality({ setupStage: 'watching', tightConsolidation: false, rangeBaseOk: false })),
    false,
  )
  assert.equal(
    isAHeuristic(quality({ setupStage: 'watching', rangeBaseOk: true, tightConsolidation: false })),
    false,
  )
  assert.equal(isAHeuristic(quality({ setupStage: 'watching', tightConsolidation: true })), true)
  assert.equal(
    isAHeuristic(quality({ setupStage: 'triggering', hasCatalyst: false, tightConsolidation: false })),
    false,
  )
  assert.equal(isAHeuristic(quality({ setupStage: 'coiled', tightConsolidation: false })), false)
  assert.equal(isAHeuristic(quality({ setupType: 'Continuation', tightConsolidation: true })), false)
  assert.equal(isAHeuristic(quality({ setupType: 'Episodic Pivot', tightConsolidation: true })), false)
  assert.equal(isAHeuristic(quality({ setupType: 'Range Breakout', tightConsolidation: true })), true)

  const plus = quality({
    hasCatalyst: true,
    catalystStatus: 'checked',
    pctFrom52wHigh: -NEAR_ATH_MAX_PCT,
    baseLengthDays: 63,
  })
  assert.equal(isAHeuristic(plus), true)
  assert.equal(isAPlusHeuristic(plus), true)
  assert.equal(isAPlusHeuristic({ ...plus, hasCatalyst: true, catalystStatus: 'pending' }), false)
  assert.equal(isAPlusHeuristic({ ...plus, hasCatalyst: true, catalystStatus: 'unchecked' }), false)
  assert.equal(isAPlusHeuristic({ ...plus, hasCatalyst: false, catalystStatus: 'checked' }), false)
  assert.equal(isAPlusHeuristic({ ...plus, pctFrom52wHigh: -NEAR_ATH_MAX_PCT - 0.1 }), false)
  assert.equal(isAPlusHeuristic({ ...plus, earningsStatus: 'avoid' }), false)

  const short = quality({
    hasCatalyst: true,
    catalystStatus: 'checked',
    pctFrom52wHigh: -2,
    baseLengthDays: 10,
    rangeBaseLengthSessions: 0,
    rangeBaseScore: 0.2,
  })
  assert.equal(baseQualityScore(baseQualityDays(short)) < APLUS_CONFIG.baseQualityMin, true)
  assert.equal(isAPlusHeuristic(short), false)

  const long = quality({
    hasCatalyst: true,
    catalystStatus: 'checked',
    pctFrom52wHigh: -2,
    baseLengthDays: 21,
    rangeBaseLengthSessions: 63,
    rangeBaseScore: 0.4,
  })
  assert.equal(baseQualityScore(21) < APLUS_CONFIG.baseQualityMin, true)
  assert.equal(baseQualityScore(63) >= APLUS_CONFIG.baseQualityMin, true)
  assert.equal(baseQualityScore(252), APLUS_CONFIG.baseQualityCap)
  assert.equal(isAPlusHeuristic(long), true)

  const scorePath = quality({
    hasCatalyst: true,
    catalystStatus: 'checked',
    pctFrom52wHigh: -1,
    baseLengthDays: 5,
    rangeBaseLengthSessions: 0,
    rangeBaseScore: APLUS_CONFIG.rangeBaseScoreMin,
  })
  assert.equal(isAPlusHeuristic(scorePath), true)
  assert.equal(isAPlusPlusHeuristic(scorePath), false)
  assert.equal(isAPlusHeuristic({ ...scorePath, rangeBaseScore: APLUS_CONFIG.rangeBaseScoreMin - 0.01 }), false)

  const days62 = quality({
    hasCatalyst: true,
    catalystStatus: 'checked',
    pctFrom52wHigh: -2,
    baseLengthDays: LONG_BASE_MIN_SESSIONS - 1,
    rangeBaseLengthSessions: 0,
  })
  const days63 = quality({
    hasCatalyst: true,
    catalystStatus: 'checked',
    pctFrom52wHigh: -2,
    baseLengthDays: 21,
    rangeBaseLengthSessions: LONG_BASE_MIN_SESSIONS,
  })
  assert.equal(LONG_BASE_MIN_SESSIONS, 63)
  assert.equal(isAPlusHeuristic(days62), true)
  assert.equal(isAPlusPlusHeuristic(days62), false)
  assert.equal(isAPlusPlusHeuristic(days63), true)
  assert.equal(
    isAPlusPlusHeuristic(quality({ ...days63, baseLengthDays: LONG_BASE_MIN_SESSIONS, rangeBaseLengthSessions: 0 })),
    true,
  )
  assert.equal(isAPlusPlusHeuristic(plus), true)
})

test('kyleScore A bump stays under the A+ floor when the raw score is under it', () => {
  const bare = {
    aboveSma200: true,
    aboveSma50: false,
    aboveSma10: false,
    aboveSma20: false,
    pctFrom52wHigh: -40,
    rvol: 0.5,
    adrPct: 1,
    priorRunPct: 0,
    isAPlus: false,
  }
  const plain = kyleScoreHeuristic(bare)
  const bumped = kyleScoreHeuristic({ ...bare, isA: true })
  const floored = kyleScoreHeuristic({ ...bare, isA: true, isAPlus: true })
  // A++ is isAPlus, so it uses this same floor. kyleScoreHeuristic has no extra bump.
  const expectedBump = Math.round((plain + KYLE_SCORE_CONFIG.aBump) * 100) / 100
  const underFloor = Math.round((KYLE_SCORE_CONFIG.aPlusFloor - 0.01) * 100) / 100
  assert.equal(bumped, Math.min(expectedBump, underFloor))
  assert.ok(bumped < KYLE_SCORE_CONFIG.aPlusFloor)
  assert.equal(floored, KYLE_SCORE_CONFIG.aPlusFloor)
  assert.ok(floored <= KYLE_SCORE_CONFIG.clampMax)
})

test('range-base length score: a month is below a year', () => {
  const month = rangeBaseLengthScore(RANGE_BASE_CONFIG.monthSessions)
  const quarter = rangeBaseLengthScore(63)
  const year = rangeBaseLengthScore(RANGE_BASE_CONFIG.yearSessions)
  assert.ok(month > 0 && month < quarter && quarter < year)
  assert.equal(year, 1)
  assert.equal(RANGE_BASE_CONFIG.monthSessions, APLUS_CONFIG.monthSessions)
})

test('range base: tight contained bars pass; a wide messy series fails', () => {
  const bars: RangeBaseBar[] = []
  for (let i = 0; i < 220; i += 1) {
    const close = 50 + (i / 220) * 45
    bars.push(bar(i, close, 3.5))
  }
  for (let i = 0; i < 40; i += 1) {
    const close = 96 + (i % 2 === 0 ? 0.4 : -0.3)
    bars.push(bar(220 + i, close, 1.2))
  }
  const tight = evaluateRangeBase(bars, 3.2, true)
  assert.equal(tight.ok, true, tight.failedReasons.join(','))
  assert.ok(tight.lengthSessions >= RANGE_BASE_CONFIG.minSessions)
  assert.ok(tight.containment >= RANGE_BASE_CONFIG.containmentMin)
  assert.ok((tight.compression ?? 99) <= RANGE_BASE_CONFIG.compressionMax)
  assert.equal(tight.higherLows, true)
  assert.ok(tight.score > 0 && tight.score <= 1)

  const messy: RangeBaseBar[] = []
  for (let i = 0; i < 80; i += 1) {
    const close = 40 + (i % 2 === 0 ? i * 1.4 : i * 0.2)
    messy.push(bar(i, close, 12))
  }
  const wide = evaluateRangeBase(messy, 8, false)
  assert.equal(wide.ok, false)
  assert.ok(wide.failedReasons.length > 0)
  assert.ok(wide.score < tight.score)
})

test('imperfect high within ADR slack still counts as contained', () => {
  const bars: RangeBaseBar[] = []
  for (let i = 0; i < 200; i += 1) {
    bars.push(bar(i, 80 + i * 0.05, 2))
  }
  for (let i = 0; i < 16; i += 1) {
    bars.push({ h: 100.4, l: 98.2, c: 99.2 })
  }
  for (let i = 0; i < 16; i += 1) {
    bars.push({ h: 101.2, l: 98.6, c: 100.15 })
  }
  const detail = evaluateRangeBase(bars, 4, false)
  assert.equal(detail.ok, true, detail.failedReasons.join(','))
  assert.ok(detail.containment >= RANGE_BASE_CONFIG.containmentMin)
})

test('default Ext50 is 5 on the scan and Any in group view', () => {
  assert.equal(DEFAULT_FILTERS.maxExtensionAdr50, A_CONFIG.ext50MaxAdr)
  assert.equal(GROUP_VIEW_DEFAULT_FILTERS.maxExtensionAdr50, null)
  assert.equal(DEFAULT_FILTERS.requireA, false)
  assert.equal(DEFAULT_FILTERS.requireAPlus, false)
  const row = { extensionAdr50: 5.01, aboveSma50: true, aboveSma200: true, setupStage: 'coiled', setupType: 'Range Breakout', isAPlus: false, isA: true, earningsStatus: 'clear', catalyst: null, rvol: 1, pctFrom52wHigh: -1, aboveSma10: true, aboveSma20: true, ticker: 'AAA', name: 'A', groupName: 'G' } as TradingIdea
  assert.equal(passesFilters(row, DEFAULT_FILTERS), false)
  assert.equal(passesFilters({ ...row, extensionAdr50: 5 }, DEFAULT_FILTERS), true)
  assert.equal(passesFilters({ ...row, extensionAdr50: null }, DEFAULT_FILTERS), true)
})
