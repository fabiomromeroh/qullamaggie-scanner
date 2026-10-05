import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  PRIOR_RUN_PROXY,
  RANGE_BREAKOUT_CONFIG,
  SETUP_TYPE_CONFIG,
  computeIdeaMetrics,
  confirmedPivotLows,
  evaluateHigherLows,
  halfWindowFloorRise,
  priorRunPctProxy,
  rangeBreakoutGatesPass,
  rangeOverAdr,
  recentRangePct,
  setupTypeHeuristic,
  swingLowStaircase,
  type DailyBar,
  type RangeBreakoutGateInput,
} from '../src/lib/metrics.ts'

function bar(i: number, l: number, h: number, c: number, v = 1_000_000): DailyBar {
  return { t: 1_700_000_000 + i * 86_400, o: c, h, l, c, v }
}

function fromLows(lows: number[]): DailyBar[] {
  return lows.map((low, i) => bar(i, low, low + 1, low + 0.5))
}

function passGate(patch: Partial<RangeBreakoutGateInput> = {}): RangeBreakoutGateInput {
  return {
    adrPct: RANGE_BREAKOUT_CONFIG.adrMinPct,
    aboveSma50: true,
    priorRunPct: RANGE_BREAKOUT_CONFIG.priorLegMinPct,
    rangeOverAdr: RANGE_BREAKOUT_CONFIG.rangeOverAdrMax,
    hasHigherLows: true,
    ...patch,
  }
}

test('RANGE_BREAKOUT_CONFIG matches the chosen gates', () => {
  assert.equal(RANGE_BREAKOUT_CONFIG.adrMinPct, 3)
  assert.equal(RANGE_BREAKOUT_CONFIG.priorLegMinPct, 30)
  assert.equal(RANGE_BREAKOUT_CONFIG.rangeOverAdrMax, 3)
  assert.equal(RANGE_BREAKOUT_CONFIG.recentRangeSessions, 5)
  assert.equal(RANGE_BREAKOUT_CONFIG.higherLowsBaseSessions, PRIOR_RUN_PROXY.baseLookback)
  assert.equal(RANGE_BREAKOUT_CONFIG.higherLowsBaseSessions, 15)
  assert.equal(RANGE_BREAKOUT_CONFIG.higherLowsMinRisePct, 0.1)
  assert.equal(RANGE_BREAKOUT_CONFIG.pivotRadius, 2)
  assert.equal(RANGE_BREAKOUT_CONFIG.higherLowsMinPivots, 2)
  assert.equal(RANGE_BREAKOUT_CONFIG.higherLowsPivotPad, 2)
  assert.equal(SETUP_TYPE_CONFIG.episodicRvol, 2.5)
  assert.equal(SETUP_TYPE_CONFIG.episodicDayPct, 3)
})

test('recentRangePct and rangeOverAdr use five sessions, latest close, and ADR%', () => {
  const bars: DailyBar[] = [0, 1, 2, 3, 4].map((i) =>
    bar(i, i === 1 ? 100 : 103, i === 2 ? 109 : 104, i === 4 ? 100 : 104),
  )
  const pct = recentRangePct(bars, 5)
  assert.equal(pct, ((109 - 100) / 100) * 100)
  assert.equal(rangeOverAdr(pct, 3), 3)
  assert.equal(rangeOverAdr(9, 3), 3)
  assert.equal(rangeOverAdr(9.03, 3), 9.03 / 3)
  assert.ok((rangeOverAdr(9.03, 3) ?? 0) > 3)
  assert.equal(rangeOverAdr(9, 0), null)
  assert.equal(rangeOverAdr(9, -1), null)
  assert.equal(rangeOverAdr(null, 3), null)
  assert.equal(recentRangePct([{ ...bars[0]!, c: 0 }], 1), null)
  assert.equal(recentRangePct(bars.slice(0, 4), 5), null)

  const gates = passGate()
  assert.equal(rangeBreakoutGatesPass({ ...gates, rangeOverAdr: 3 }), true)
  assert.equal(rangeBreakoutGatesPass({ ...gates, rangeOverAdr: 3.01 }), false)
  assert.equal(rangeBreakoutGatesPass({ ...gates, rangeOverAdr: rangeOverAdr(9, 3) }), true)
  assert.equal(rangeBreakoutGatesPass({ ...gates, rangeOverAdr: rangeOverAdr(9.03, 3) }), false)
  assert.equal(rangeBreakoutGatesPass({ ...gates, rangeOverAdr: null }), false)
})

test('half-window floor rises, falls, and ignores a sub-epsilon float bump', () => {
  const rising = fromLows(Array.from({ length: 15 }, (_, i) => 10 + i * 0.2))
  assert.equal(swingLowStaircase(rising), false)
  assert.equal(halfWindowFloorRise(rising), true)
  assert.deepEqual(evaluateHigherLows(rising), { hasHigherLows: true, higherLowsRule: 'half' })

  const falling = fromLows(Array.from({ length: 15 }, (_, i) => 20 - i))
  assert.equal(halfWindowFloorRise(falling), false)
  assert.equal(swingLowStaircase(falling), false)
  assert.deepEqual(evaluateHigherLows(falling), { hasHigherLows: false, higherLowsRule: null })

  const older = 10
  const threshold = older * (1 + RANGE_BREAKOUT_CONFIG.higherLowsMinRisePct / 100)
  const atFloor = fromLows(Array.from({ length: 15 }, () => threshold))
  // Older half is also `threshold`, so this is a zero rise and must fail.
  assert.equal(halfWindowFloorRise(atFloor), false)

  const equal = fromLows(Array.from({ length: 15 }, () => older))
  assert.equal(halfWindowFloorRise(equal), false)

  const tiny = fromLows([
    ...Array.from({ length: 7 }, () => older),
    ...Array.from({ length: 8 }, () => older * (1 + RANGE_BREAKOUT_CONFIG.higherLowsMinRisePct / 200)),
  ])
  assert.equal(halfWindowFloorRise(tiny), false)

  const cleared = fromLows([
    ...Array.from({ length: 7 }, () => older),
    ...Array.from({ length: 8 }, () => threshold + 1e-6),
  ])
  assert.equal(halfWindowFloorRise(cleared), true)
  assert.equal(swingLowStaircase(cleared), false)
  assert.equal(evaluateHigherLows(cleared).higherLowsRule, 'half')

  const exact = fromLows([
    ...Array.from({ length: 7 }, () => older),
    ...Array.from({ length: 8 }, () => threshold),
  ])
  assert.equal(halfWindowFloorRise(exact), false)
})

test('odd base window gives the extra bar to the newer half', () => {
  // Index 7 is the first bar of an 8-bar newer half. A low only there fails the floor.
  // Putting that same bar on the older half would make the newer floor pass.
  const lows = Array(15).fill(12)
  lows[7] = 9
  const bars = fromLows(lows)
  assert.equal(halfWindowFloorRise(bars), false)
  assert.equal(confirmedPivotLows(bars, RANGE_BREAKOUT_CONFIG.pivotRadius).length, 1)
  assert.equal(evaluateHigherLows(bars).hasHigherLows, false)
})

test('swing-low staircase passes when the floor does not, and needs a strict rise', () => {
  const swingOnly = fromLows([14, 13, 12, 11, 10, 12, 13, 12, 11, 13, 14, 13, 12, 11, 5])
  assert.equal(halfWindowFloorRise(swingOnly), false)
  assert.equal(swingLowStaircase(swingOnly), true)
  assert.deepEqual(evaluateHigherLows(swingOnly), { hasHigherLows: true, higherLowsRule: 'swing' })
  const pivots = confirmedPivotLows(swingOnly, 2)
  assert.deepEqual(
    pivots.map((p) => p.low),
    [10, 11],
  )
  assert.ok(pivots.every((p) => p.index < swingOnly.length - 2))

  const both = fromLows([14, 13, 12, 11, 10, 12, 13, 12, 11, 13, 14, 13, 12, 11, 13])
  assert.equal(halfWindowFloorRise(both), true)
  assert.equal(swingLowStaircase(both), true)
  assert.equal(evaluateHigherLows(both).higherLowsRule, 'half')

  const flatSteps = fromLows([14, 13, 12, 11, 10, 12, 13, 12, 10, 13, 14, 13, 12, 11, 5])
  assert.equal(swingLowStaircase(flatSteps), false)
  assert.equal(evaluateHigherLows(flatSteps).hasHigherLows, false)
})

test('insufficient pivots fall back to the half-window rule', () => {
  const rising = fromLows(Array.from({ length: 15 }, (_, i) => 10 + i * 0.25))
  assert.equal(confirmedPivotLows(rising, 2).length, 0)
  assert.equal(swingLowStaircase(rising), false)
  assert.equal(halfWindowFloorRise(rising), true)
  assert.equal(evaluateHigherLows(rising).higherLowsRule, 'half')
})

test('a pivot just before the base counts; one outside the pad does not', () => {
  const lows = Array(25).fill(20)
  // base starts at index 10. Pad of 2 includes index 8. Index 4 is outside the pad.
  lows[8] = 10
  lows[12] = 11
  lows[24] = 1
  const withPad = fromLows(lows)
  assert.equal(halfWindowFloorRise(withPad), false)
  assert.equal(swingLowStaircase(withPad), true)
  assert.equal(evaluateHigherLows(withPad).higherLowsRule, 'swing')

  const outside = Array(25).fill(20)
  outside[4] = 10
  outside[12] = 11
  outside[24] = 1
  const tooEarly = fromLows(outside)
  assert.equal(swingLowStaircase(tooEarly), false)
  assert.equal(evaluateHigherLows(tooEarly).hasHigherLows, false)
})

test('setupTypeHeuristic: one failed gate is Continuation, all five pass, Episodic still wins', () => {
  const pass = {
    rvol: 1,
    dayPct: 0,
    ...passGate(),
  }
  assert.equal(setupTypeHeuristic(pass), 'Range Breakout')
  assert.equal(setupTypeHeuristic({ ...pass, adrPct: RANGE_BREAKOUT_CONFIG.adrMinPct - 0.01 }), 'Continuation')
  assert.equal(setupTypeHeuristic({ ...pass, aboveSma50: false }), 'Continuation')
  assert.equal(
    setupTypeHeuristic({ ...pass, priorRunPct: RANGE_BREAKOUT_CONFIG.priorLegMinPct - 0.01 }),
    'Continuation',
  )
  assert.equal(setupTypeHeuristic({ ...pass, rangeOverAdr: null }), 'Continuation')
  assert.equal(setupTypeHeuristic({ ...pass, rangeOverAdr: 3.01 }), 'Continuation')
  assert.equal(setupTypeHeuristic({ ...pass, hasHigherLows: false }), 'Continuation')

  assert.equal(
    setupTypeHeuristic({
      ...pass,
      rvol: SETUP_TYPE_CONFIG.episodicRvol,
      dayPct: SETUP_TYPE_CONFIG.episodicDayPct,
    }),
    'Episodic Pivot',
  )
  assert.equal(
    setupTypeHeuristic({
      rvol: SETUP_TYPE_CONFIG.episodicRvol,
      dayPct: SETUP_TYPE_CONFIG.episodicDayPct,
      adrPct: 0,
      aboveSma50: false,
      priorRunPct: 0,
      rangeOverAdr: null,
      hasHigherLows: false,
    }),
    'Episodic Pivot',
  )
  assert.equal(
    setupTypeHeuristic({
      ...pass,
      rvol: SETUP_TYPE_CONFIG.episodicRvol,
      dayPct: SETUP_TYPE_CONFIG.episodicDayPct - 0.01,
    }),
    'Range Breakout',
  )

  // Retired screen was pctFrom52wHigh >= -8 and RVOL >= 1.2. Those inputs are
  // not a Range Breakout gate anymore.
  assert.equal(
    setupTypeHeuristic({
      rvol: 1.2,
      dayPct: 0,
      adrPct: 1,
      aboveSma50: false,
      priorRunPct: 5,
      rangeOverAdr: 8,
      hasHigherLows: false,
    }),
    'Continuation',
  )
})

test('priorRunPctProxy still returns at least 30 on a constructed run', () => {
  const n = PRIOR_RUN_PROXY.runLookback + PRIOR_RUN_PROXY.baseLookback + PRIOR_RUN_PROXY.minExtraBars
  const bars: DailyBar[] = []
  for (let i = 0; i < n; i++) {
    const inBase = i >= n - PRIOR_RUN_PROXY.baseLookback
    const inRun = i >= n - PRIOR_RUN_PROXY.baseLookback - PRIOR_RUN_PROXY.runLookback && !inBase
    if (inBase) bars.push(bar(i, 120, 130, 128))
    else if (inRun) bars.push(bar(i, 100, 110, 105))
    else bars.push(bar(i, 140, 160, 155))
  }
  const pct = priorRunPctProxy(bars)
  assert.equal(pct, 30)
  assert.ok(pct >= RANGE_BREAKOUT_CONFIG.priorLegMinPct)
})

function rangeBreakoutBars(): DailyBar[] {
  const n = 220
  const bars: DailyBar[] = []
  for (let i = 0; i < n; i++) {
    const inBase = i >= n - PRIOR_RUN_PROXY.baseLookback
    const inRun = i >= n - PRIOR_RUN_PROXY.baseLookback - PRIOR_RUN_PROXY.runLookback && !inBase
    let high: number
    let low: number
    let close: number
    if (inBase) {
      const k = i - (n - PRIOR_RUN_PROXY.baseLookback)
      if (k < 7) {
        close = 118
        high = k === 0 ? 120 : 119
        low = 100
      } else {
        close = 115
        high = 116
        low = 105 + (k - 7) * 0.1
      }
    } else if (inRun) {
      close = 85
      high = 90
      low = 80
    } else {
      close = 40 + 30 * (i / 141)
      high = close + 1
      low = close - 1
    }
    bars.push(bar(i, low, high, close))
  }
  return bars
}

test('computeIdeaMetrics attaches rangeBreakoutDetail and labels a passing series', () => {
  const idea = computeIdeaMetrics(
    { ticker: 'RB', name: 'Range Breakout Co', groupId: 'g', groupName: 'Group' },
    { symbol: 'RB', bars: rangeBreakoutBars(), provider: 'test' },
  )
  assert.ok(idea)
  assert.equal(idea.setupType, 'Range Breakout')
  assert.equal(idea.rangeBreakoutDetail?.passed, true)
  assert.equal(idea.rangeBreakoutDetail?.aboveSma50, true)
  assert.equal(idea.rangeBreakoutDetail?.hasHigherLows, true)
  assert.equal(idea.rangeBreakoutDetail?.higherLowsRule, 'half')
  assert.ok((idea.rangeBreakoutDetail?.adrPct ?? 0) >= RANGE_BREAKOUT_CONFIG.adrMinPct)
  assert.ok(idea.priorRunPct >= RANGE_BREAKOUT_CONFIG.priorLegMinPct)
  assert.equal(idea.rangeBreakoutDetail?.priorRunPct, idea.priorRunPct)
  assert.ok(idea.rangeBreakoutDetail?.rangeOverAdr != null)
  assert.ok((idea.rangeBreakoutDetail?.rangeOverAdr ?? 99) <= RANGE_BREAKOUT_CONFIG.rangeOverAdrMax)
})

test('a near-high elevated-RVOL series is Continuation when the new gates fail', () => {
  const bars: DailyBar[] = []
  for (let i = 0; i < 220; i++) {
    const last = i === 219
    const close = last ? 101 : 100
    bars.push(bar(i, last ? 100.6 : 99.9, last ? 101.2 : 100.4, close, last ? 1_500_000 : 1_000_000))
  }
  const idea = computeIdeaMetrics(
    { ticker: 'OLD', name: 'Old Rule Co', groupId: 'g', groupName: 'Group' },
    { symbol: 'OLD', bars, provider: 'test' },
  )
  assert.ok(idea)
  assert.ok(idea.pctFrom52wHigh >= -8)
  assert.ok(idea.rvol >= 1.2)
  assert.equal(idea.setupType, 'Continuation')
  assert.equal(idea.rangeBreakoutDetail?.passed, false)
})
